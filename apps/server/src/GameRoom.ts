import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  BTN_RELOAD,
  BTN_SHOOT,
  BTN_SPRINT,
  COUNTDOWN_TICKS,
  EMPTY_ROOM_SHUTDOWN_TICKS,
  InputQueue,
  MAX_PLAYERS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  botInput,
  createBotMemory,
  navGridFor,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  MS_PER_TICK,
  PLAYER_COLORS,
  createGameState,
  createPlayer,
  decodeClient,
  encodeServer,
  getArena,
  concealedFrom,
  hasLineOfSight,
  packBullet,
  packGrenade,
  packItem,
  packAirdrops,
  packSmokes,
  packPlayer,
  packResults,
  packSnapshotArrays,
  sanitizeName,
  sanitizeToken,
  startMatch,
  findPlayer,
  step,
  unpackAim,
  type BotMemory,
  type ClientMsg,
  type GameState,
  type PlayerInput,
  type PlayerMeta,
  type PlayerState,
  type ServerMsg,
  type SnapBullet,
  type SnapGrenade,
  type SnapPlayer,
  type SnapStanding,
  type SimEvent,
} from "@wabbr/shared";

export interface Env {
  GameRoom: DurableObjectNamespace<GameRoom>;
  ALLOWED_ORIGINS?: string;
  DO_LOCATION_HINT?: string;
}

interface ConnState {
  playerId: number;
}

/** Todo lo que el servidor sabe de un jugador sentado en la sala. */
interface Seat {
  playerId: number;
  /** Conexión actual, o null mientras se le guarda el lugar tras un corte. */
  connId: string | null;
  /** Con esto vuelve al mismo asiento si se le corta la conexión. */
  token: string | null;
  /** Cuándo se le cortó la conexión (Date.now()), o 0 si está conectado. */
  goneAt: number;
  meta: PlayerMeta;
  /** Inputs pendientes. Cada uno se procesa exactamente una vez: ver InputQueue. */
  inputs: InputQueue;
  /** Si es un bot, lo que recuerda entre ticks. Los bots no tienen conexión. */
  bot: BotMemory | null;
  /** Cuándo marcó el mapa por última vez (Date.now()), para no inundar. */
  lastMarkAt: number;
}

/** Cada cuánto se le da una oportunidad de correr al loop (no es el ritmo del tick). */
const PUMP_INTERVAL_MS = 10;
/** Techo de tiempo que se intenta recuperar de una sola vez. */
const MAX_CATCHUP_MS = 250;
const MAX_TICKS_PER_PUMP = 5;
/**
 * Ticks que se sigue viendo a alguien después de perderlo de vista. Sin este
 * margen, caminar al lado de una columna hace parpadear al otro jugador.
 */
const SIGHT_GRACE_TICKS = 6;
/** Entre una marca y la siguiente del mismo jugador. */
const MARK_INTERVAL_MS = 500;

/** Nombres para los bots: cortos, para que entren en la tabla. */
const BOT_NAMES = [
  "Bot Pancho", "Bot Lola", "Bot Toto", "Bot Chela", "Bot Nacho", "Bot Pepa",
  "Bot Lucho", "Bot Cata", "Bot Tito", "Bot Maru", "Bot Rulo", "Bot Coca",
  "Bot Beto", "Bot Juana", "Bot Fito", "Bot Nina",
];

/**
 * Una partida = un Durable Object. Mantiene el estado autoritativo y corre el
 * loop de simulación a 20 Hz mientras haya alguien conectado.
 *
 * Hibernación desactivada a propósito: la hibernación descarta los timers, y
 * acá el timer *es* el juego.
 */
export class GameRoom extends Server<Env> {
  static override options = { hibernate: false };

  private state: GameState = createGameState(1);
  private seats = new Map<number, Seat>();
  /** Token de reconexión -> id del asiento. */
  private byToken = new Map<string, number>();
  private events: SimEvent[] = [];
  private nextPlayerId = 1;
  private hostId = -1;
  /**
   * Nombres echados por el host, en minúsculas. Bloqueo blando: sin cuentas no
   * hay identidad estable, así que cambiando el nombre se puede volver a entrar.
   * Alcanza para lo que molesta, que es el que reentra de un clic.
   */
  private kicked = new Set<string>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private emptyTicks = 0;
  /** Último tick en que cada observador vio a cada objetivo, para el margen de gracia. */
  private lastSeen = new Map<number, Map<number, number>>();
  private lastPumpAt = 0;
  /** Tiempo real todavía no convertido en ticks. */
  private accumulator = 0;
  private readonly arena = getArena();

  // ------------------------------------------------------------ conexiones

  override onConnect(conn: Connection<ConnState>, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url);

    // Un cliente de otra versión no puede jugar con este servidor. Sin versión
    // es uno de antes de que existiera el número: se lo deja pasar.
    const version = url.searchParams.get("v");
    if (version !== null && version !== String(PROTOCOL_VERSION)) {
      this.sendTo(conn, {
        t: "err",
        code: "version",
        message: "Hay una versión nueva del juego: recargá la página.",
      });
      conn.close(4002, "version");
      return;
    }

    const token = sanitizeToken(url.searchParams.get("token"));

    // Vuelve alguien a quien se le cortó la conexión: recupera su asiento, y si
    // está en partida, su muñeco. Va antes del chequeo de sala llena porque su
    // lugar nunca se liberó.
    const known = token === null ? undefined : this.byToken.get(token);
    const back = known === undefined ? undefined : this.seats.get(known);
    if (back) {
      this.reattach(conn, back);
      return;
    }

    if (this.seats.size >= MAX_PLAYERS) {
      this.sendTo(conn, {
        t: "err",
        code: "room_full",
        message: `La sala está llena (${MAX_PLAYERS} jugadores).`,
      });
      conn.close(4000, "room full");
      return;
    }

    const name = sanitizeName(url.searchParams.get("name"));

    if (this.kicked.has(name.trim().toLowerCase())) {
      this.sendTo(conn, {
        t: "err",
        code: "kicked",
        message: "El host te sacó de esta sala.",
      });
      conn.close(4000, "kicked");
      return;
    }

    const playerId = this.nextPlayerId++;
    const seat: Seat = {
      playerId,
      connId: conn.id,
      token,
      goneAt: 0,
      meta: { id: playerId, name, colorIndex: this.freeColorIndex(), ready: false },
      inputs: new InputQueue(),
      lastMarkAt: 0,
      bot: null,
    };
    this.seats.set(playerId, seat);
    if (token !== null) this.byToken.set(token, playerId);
    conn.setState({ playerId });

    // Un jugador que entra en plena partida mira como espectador y juega la próxima.
    this.state.players.push(createPlayer(playerId));

    if (this.hostId === -1) this.hostId = playerId;

    this.sendTo(conn, {
      t: "welcome",
      you: playerId,
      room: this.name,
      hostId: this.hostId,
      roster: this.roster(),
      phase: this.state.phase,
    });
    this.broadcastRoster();
    // Quien entra en plena partida necesita saber qué hay tirado en el piso.
    if (this.state.phase === "playing") this.sendTo(conn, this.itemsMessage());
    this.ensureLoop();
  }

  override onMessage(conn: Connection<ConnState>, raw: WSMessage): void {
    if (typeof raw !== "string") return;
    const msg = decodeClient(raw);
    if (!msg) return;

    const playerId = conn.state?.playerId;
    if (playerId === undefined) return;
    const seat = this.seats.get(playerId);
    if (!seat) return;

    this.handle(conn, seat, msg);
  }

  override onClose(conn: Connection<ConnState>): void {
    this.dropConnection(conn);
  }

  override onError(conn: Connection<ConnState>): void {
    this.dropConnection(conn);
  }

  /**
   * Se cortó una conexión. En partida no se echa al jugador de una: se le
   * guarda el lugar `RECONNECT_GRACE_MS` con el muñeco quieto. Antes un corte de
   * un segundo te mataba ahí mismo, y al reconectarte volvías como espectador.
   */
  private dropConnection(conn: Connection<ConnState>): void {
    const playerId = conn.state?.playerId;
    if (playerId === undefined) return;
    const seat = this.seats.get(playerId);
    // Una conexión vieja que se cierra cuando el jugador ya volvió por otra.
    if (!seat || seat.connId !== conn.id) return;

    const inMatch = this.state.phase === "playing" || this.state.phase === "countdown";
    if (!inMatch || seat.token === null) {
      this.removeSeat(playerId);
      return;
    }
    seat.connId = null;
    seat.goneAt = Date.now();
    seat.meta.away = true;
    // El host pasa a otra persona conectada: si no, mientras le guardamos el
    // lugar nadie puede forzar el arranque ni agregar bots en el lobby.
    if (this.hostId === playerId) {
      const next = [...this.seats.values()].find((s) => !s.bot && s.connId !== null);
      if (next) this.hostId = next.playerId;
    }
    this.broadcastRoster();
  }

  /** Vuelve al asiento el que se había desconectado (o abrió de nuevo la pestaña). */
  private reattach(conn: Connection<ConnState>, seat: Seat): void {
    const previous = seat.connId;
    seat.connId = conn.id;
    seat.goneAt = 0;
    seat.meta.away = false;
    // Si recargó la página, el cliente vuelve a numerar sus inputs desde 1: con
    // la cola recordando el último seq, los rechazaría todos y el muñeco
    // quedaría congelado. Lo que hubiera en la cola se perdió con el corte.
    seat.inputs.clear();
    conn.setState({ playerId: seat.playerId });

    // Si la conexión vieja sigue abierta —el navegador se reconectó antes de que
    // el servidor notara el corte— se cierra: un asiento, una conexión.
    if (previous !== null) {
      for (const c of this.getConnections<ConnState>()) {
        if (c.id === previous) c.close(4001, "replaced");
      }
    }

    this.sendTo(conn, {
      t: "welcome",
      you: seat.playerId,
      room: this.name,
      hostId: this.hostId,
      roster: this.roster(),
      phase: this.state.phase,
    });
    this.broadcastRoster();
    // Lo que se recogió y se tiró mientras no estaba.
    if (this.state.phase === "playing") this.sendTo(conn, this.itemsMessage());
    this.ensureLoop();
  }

  /** A los que no volvieron a tiempo se los da por ido, como antes. */
  private expireAbsent(now: number): void {
    for (const seat of [...this.seats.values()]) {
      if (seat.goneAt > 0 && now - seat.goneAt > RECONNECT_GRACE_MS) this.removeSeat(seat.playerId);
    }
  }

  /** Chequeo de salud / existencia de sala, útil para el lobby del cliente. */
  override onRequest(): Response {
    return Response.json({
      room: this.name,
      phase: this.state.phase,
      players: this.seats.size,
      max: MAX_PLAYERS,
    });
  }

  // ------------------------------------------------------------ mensajes

  private handle(conn: Connection<ConnState>, seat: Seat, msg: ClientMsg): void {
    switch (msg.t) {
      case "in": {
        if (typeof msg.seq !== "number") return;
        seat.inputs.push({
          seq: msg.seq,
          // Clamp a -1/0/1: el cliente no decide su propia velocidad.
          moveX: clampAxis(msg.mx),
          moveY: clampAxis(msg.my),
          aim: unpackAim(typeof msg.aim === "number" ? msg.aim : 0),
          shoot: (msg.btn & BTN_SHOOT) !== 0,
          reload: (msg.btn & BTN_RELOAD) !== 0,
          sprint: (msg.btn & BTN_SPRINT) !== 0,
          // Lo que diga se acota al rebobinar (LAG_COMP_MAX_TICKS): mentir acá
          // no da más que eso.
          view: typeof msg.vt === "number" && Number.isFinite(msg.vt) && msg.vt >= 0 ? msg.vt / 10 : -1,
          // Acción puntual (recoger, cambiar de arma, curarse). Se valida en la
          // simulación: acá sólo nos aseguramos de que sea un número sano.
          act: typeof msg.act === "number" && msg.act >= 0 && msg.act < 32 ? msg.act | 0 : 0,
        });
        return;
      }

      case "ready": {
        seat.meta.ready = msg.ready === true;
        this.broadcastRoster();
        return;
      }

      case "start": {
        // Solo el host, solo desde el lobby y con gente suficiente.
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (this.seats.size < MIN_PLAYERS) return;
        this.state.phase = "countdown";
        this.state.phaseTicksLeft = COUNTDOWN_TICKS;
        return;
      }

      case "mode": {
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (msg.teamSize !== 1 && msg.teamSize !== 2) return;
        this.state.teamSize = msg.teamSize;
        this.broadcastRoster();
        return;
      }

      case "bot": {
        // Sólo el host, sólo en el lobby y si hay lugar.
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (this.seats.size >= MAX_PLAYERS) return;
        this.addBot();
        return;
      }

      case "kick": {
        // Sólo el host, sólo en el lobby y no contra sí mismo. En partida echar
        // a alguien sería un arma más: se decide antes de empezar.
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (typeof msg.id !== "number" || msg.id === this.hostId) return;

        const target = this.seats.get(msg.id);
        if (!target) return;

        // Bloqueo blando por nombre, para que no vuelva a entrar de un clic.
        // Cambiando el nombre entra igual: sin cuentas no hay identidad real, y
        // esto alcanza para el caso que molesta.
        // A un bot no hace falta bloquearlo: no vuelve solo.
        if (!target.bot) this.kicked.add(target.meta.name.trim().toLowerCase());

        for (const c of this.getConnections<ConnState>()) {
          if (c.state?.playerId !== msg.id) continue;
          // Primero el aviso y después el cierre: si no, el otro ve caerse la
          // conexión y cree que se rompió algo.
          this.sendTo(c, {
            t: "err",
            code: "kicked",
            message: "El host te sacó de la sala.",
          });
          c.close(4000, "kicked");
        }

        // onClose va a llamar a removeSeat igual, pero no dependemos de que el
        // cierre llegue: el asiento se libera acá.
        this.removeSeat(msg.id);
        return;
      }

      case "ping": {
        this.sendTo(conn, { t: "pong", c: msg.c, s: Date.now() });
        return;
      }

      case "mark": {
        // Sólo en partida y a lo sumo dos por segundo: una marca es un aviso,
        // no un dibujo.
        if (this.state.phase !== "playing") return;
        if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
        const now = Date.now();
        if (now - seat.lastMarkAt < MARK_INTERVAL_MS) return;
        seat.lastMarkAt = now;
        const from = findPlayer(this.state, seat.playerId);
        if (!from) return;
        const x = Math.round(Math.max(0, Math.min(WORLD_CENTER_X * 2, msg.x)));
        const y = Math.round(Math.max(0, Math.min(WORLD_CENTER_Y * 2, msg.y)));
        // Al equipo nada más: a los rivales les diría dónde estás mirando.
        const out = encodeServer({ t: "mark", by: from.id, x, y });
        for (const c of this.getConnections<ConnState>()) {
          const viewer = c.state ? findPlayer(this.state, c.state.playerId) : undefined;
          if (viewer && viewer.team === from.team) c.send(out);
        }
        return;
      }

      case "join":
        // El nombre ya viene en la query de conexión; se acepta para compatibilidad.
        seat.meta.name = sanitizeName(msg.name);
        this.broadcastRoster();
        return;
    }
  }

  // ------------------------------------------------------------ loop

  private ensureLoop(): void {
    if (this.loop) return;
    this.emptyTicks = 0;
    this.lastPumpAt = Date.now();
    this.accumulator = 0;
    // El timer se dispara más seguido que el tick a propósito: los timers del
    // runtime no son precisos (medido: setInterval(50) dispara cada ~62 ms), así
    // que el ritmo real lo marca el reloj y el timer sólo da oportunidades de correr.
    this.loop = setInterval(() => {
      try {
        this.pump();
      } catch (err) {
        console.error("tick error", err);
      }
    }, PUMP_INTERVAL_MS);
  }

  private stopLoop(): void {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  /**
   * Corre los ticks que hagan falta para alcanzar el reloj y manda UN snapshot.
   * Simular contra el reloj (y no contra el timer) es lo que mantiene la partida
   * a 20 Hz reales: si no, todo el juego correría en cámara lenta.
   */
  private pump(): void {
    const now = Date.now();
    let delta = now - this.lastPumpAt;
    this.lastPumpAt = now;
    this.expireAbsent(now);

    // Si el runtime nos dejó dormidos, no intentamos recuperar todo el tiempo
    // perdido de golpe: preferimos perder simulación antes que trabar la sala.
    if (delta > MAX_CATCHUP_MS) delta = MAX_CATCHUP_MS;
    this.accumulator += delta;
    if (this.accumulator < MS_PER_TICK) return;

    let ran = 0;
    while (this.accumulator >= MS_PER_TICK && ran < MAX_TICKS_PER_PUMP) {
      this.accumulator -= MS_PER_TICK;
      ran++;
      if (!this.tick()) return;
    }
    if (this.accumulator > MS_PER_TICK) this.accumulator = 0;

    this.broadcastSnapshot();
  }

  /** Un tick de simulación. Devuelve false si la sala se apagó. */
  private tick(): boolean {
    const s = this.state;

    if (!this.hasHumans()) {
      // Sala vacía —o con bots solos, que no miran nadie—: apagar el loop para
      // no seguir gastando duration en Cloudflare.
      if (++this.emptyTicks > EMPTY_ROOM_SHUTDOWN_TICKS) {
        for (const seat of [...this.seats.values()]) if (seat.bot) this.removeSeat(seat.playerId);
        this.stopLoop();
        this.resetToLobby();
        return false;
      }
      return true;
    }
    this.emptyTicks = 0;

    // Arranque automático cuando todos marcaron "listo".
    if (s.phase === "lobby" && this.seats.size >= MIN_PLAYERS) {
      let allReady = true;
      for (const seat of this.seats.values()) if (!seat.meta.ready) allReady = false;
      if (allReady) {
        s.phase = "countdown";
        s.phaseTicksLeft = COUNTDOWN_TICKS;
      }
    }

    // Normalmente un input por jugador, pero pueden ser cero o dos: cada uno
    // se procesa una sola vez y en orden, igual que en la predicción.
    const inputs = new Map<number, PlayerInput[]>();
    for (const seat of this.seats.values()) {
      if (seat.bot) {
        // Los bots deciden con el estado de este mismo tick, como si su input
        // acabara de llegar.
        const me = findPlayer(s, seat.playerId);
        inputs.set(seat.playerId, me?.alive && s.phase === "playing" ? [botInput(s, me, seat.bot, this.arena)] : []);
        continue;
      }
      inputs.set(seat.playerId, seat.inputs.take());
    }

    const wasPlaying = s.phase === "playing";
    step(s, inputs, this.events, this.arena);
    if (wasPlaying && s.phase === "ended") this.addToTally();

    // Transiciones que dependen del contador que acaba de decrementar step().
    if (s.phase === "countdown" && s.phaseTicksLeft <= 0) {
      startMatch(s, (Date.now() ^ (this.seats.size << 16)) | 1, this.arena);
      this.broadcast(encodeServer({ t: "start", seed: s.rng }));
      this.broadcastItems();
    } else if (s.phase === "ended" && s.phaseTicksLeft <= 0) {
      this.resetToLobby();
    }

    return true;
  }

  /**
   * ¿El observador ve al objetivo? Con margen de gracia: si lo perdió de vista
   * hace menos de `SIGHT_GRACE_TICKS`, se lo sigue mandando. Sin eso, caminar
   * al lado de una columna hace que el otro parpadee.
   */
  private canSee(viewer: PlayerState | undefined, target: PlayerState): boolean {
    // Sin observador vivo (espectador, lobby) se ve todo: ya está muerto y así
    // mirar la partida sigue teniendo sentido.
    if (!viewer || !viewer.alive) return true;
    if (viewer.id === target.id) return true;
    // Al compañero se lo ve siempre, detrás de una pared o en un arbusto.
    if (viewer.team === target.team) return true;
    // Los muertos no se dibujan igual, y mandarlos no filtra nada.
    if (!target.alive) return true;

    let seen = this.lastSeen.get(viewer.id);
    if (!seen) {
      seen = new Map();
      this.lastSeen.set(viewer.id, seen);
    }

    // Visto: sin pared en el medio y sin estar escondido en un arbusto o en el humo.
    if (
      !concealedFrom(this.state, target, viewer.x, viewer.y) &&
      hasLineOfSight(viewer.x, viewer.y, target.x, target.y, this.arena)
    ) {
      seen.set(target.id, this.state.tick);
      return true;
    }

    const last = seen.get(target.id);
    return last !== undefined && this.state.tick - last <= SIGHT_GRACE_TICKS;
  }

  /**
   * Un snapshot por jugador, con lo que cada uno puede ver. Es lo que hace que
   * un wallhack deje de existir: la información no sale del servidor, así que
   * no alcanza con abrir la consola del navegador.
   */
  private broadcastSnapshot(): void {
    const s = this.state;
    const packed = packSnapshotArrays(s);
    // El marcador es público y va igual para todos.
    const standings: SnapStanding[] = s.players.map((p) => [p.id, p.kills, p.alive ? 1 : 0, p.place, p.team]);

    const base = {
      t: "s" as const,
      tick: s.tick,
      now: Date.now(),
      phase: s.phase,
      left: s.phaseTicksLeft,
      st: standings,
      zone: packed.zone,
      alive: packed.alive,
      winner: s.winnerId,
      ...(s.airdrops.length > 0 ? { ad: packAirdrops(s) } : {}),
      ...(s.smokes.length > 0 ? { sm: packSmokes(s) } : {}),
    };

    // Fuera de la partida no hay nada que ocultar: un solo mensaje para todos.
    if (s.phase !== "playing") {
      this.broadcast(
        encodeServer({
          ...base,
          players: packed.players,
          bullets: packed.bullets,
          gr: s.grenades.map(packGrenade),
          ...(this.events.length > 0 ? { ev: this.events } : {}),
          // El resultado completo, mientras se muestra la pantalla final.
          ...(s.phase === "ended" ? { res: packResults(s) } : {}),
        }),
      );
      this.events = [];
      return;
    }

    for (const conn of this.getConnections<ConnState>()) {
      const viewerId = conn.state?.playerId;
      const viewer = viewerId === undefined ? undefined : findPlayer(s, viewerId);

      const players: SnapPlayer[] = [];
      for (const p of s.players) {
        if (this.canSee(viewer, p)) players.push(packPlayer(p, p.id === viewerId));
      }

      const bullets: SnapBullet[] = [];
      for (const b of s.bullets) {
        if (!viewer?.alive || hasLineOfSight(viewer.x, viewer.y, b.x, b.y, this.arena)) {
          bullets.push(packBullet(b));
        }
      }

      const grenades: SnapGrenade[] = [];
      for (const gr of s.grenades) {
        if (!viewer?.alive || hasLineOfSight(viewer.x, viewer.y, gr.x, gr.y, this.arena)) {
          grenades.push(packGrenade(gr));
        }
      }

      const ev = this.visibleEvents(viewer);

      conn.send(
        encodeServer({
          ...base,
          players,
          bullets,
          gr: grenades,
          ...(ev.length > 0 ? { ev } : {}),
        }),
      );
    }

    this.events = [];
  }

  /**
   * Los efectos con posición (fogonazo, impacto, sangre) delatan dónde hay
   * alguien, así que se filtran. Los de inventario NO: si a un cliente le
   * faltara un "se cayó esto", su lista de objetos quedaría desincronizada.
   */
  private visibleEvents(viewer: PlayerState | undefined): SimEvent[] {
    if (!viewer?.alive) return this.events;
    return this.events.filter((e) => {
      // El disparo silencioso sólo le sirve al que tiró (para emparejar su
      // bala): a los demás les diría dónde está, y la ballesta no delata.
      if (e.t === "shot" && e.silent && e.byId !== viewer.id) return false;
      if (e.t !== "shot" && e.t !== "hit" && e.t !== "impact" && e.t !== "explosion") return true;
      return hasLineOfSight(viewer.x, viewer.y, e.x, e.y, this.arena);
    });
  }

  // ------------------------------------------------------------ sala

  /**
   * Suma la partida que acaba de terminar al marcador de la sala de cada uno
   * que la jugó. El que entró a mirar con la partida empezada no tiene puesto
   * y no suma una partida jugada.
   */
  private addToTally(): void {
    const s = this.state;
    for (const seat of this.seats.values()) {
      const p = findPlayer(s, seat.playerId);
      if (!p || p.place <= 0) continue;
      const m = seat.meta;
      m.played = (m.played ?? 0) + 1;
      m.totalKills = (m.totalKills ?? 0) + p.kills;
      // En dúos ganan los dos de la pareja. Si no quedó nadie en pie, nadie
      // ganó aunque los últimos compartan el primer puesto.
      if (s.winnerId >= 0 && p.place === 1) m.wins = (m.wins ?? 0) + 1;
    }
    this.broadcastRoster();
  }

  private resetToLobby(): void {
    const s = this.state;
    this.lastSeen.clear();
    s.phase = "lobby";
    s.phaseTicksLeft = 0;
    s.bullets = [];
    s.grenades = [];
    s.smokes = [];
    s.winnerId = -1;
    s.tick = 0;
    for (const p of s.players) {
      p.alive = false;
      p.diedAtTick = -1;
      p.killerId = -1;
    }
    for (const seat of this.seats.values()) {
      // Los bots siguen listos: si no, la próxima partida los esperaría para siempre.
      seat.meta.ready = seat.bot !== null;
      seat.inputs.clear();
    }
    this.broadcastRoster();
  }

  private removeSeat(playerId: number): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.seats.delete(playerId);
    if (seat.token !== null) this.byToken.delete(seat.token);

    const player = this.state.players.find((p) => p.id === playerId);
    if (player) {
      player.connected = false;
      // En partida el cuerpo desaparece; en lobby se saca de la lista.
      player.alive = false;
    }
    if (this.state.phase === "lobby" || this.state.phase === "ended") {
      this.state.players = this.state.players.filter((p) => p.id !== playerId);
    }

    if (this.hostId === playerId) {
      // El puesto pasa a otra persona, nunca a un bot.
      const next = [...this.seats.values()].find((s) => !s.bot);
      this.hostId = next ? next.playerId : -1;
    }
    this.broadcastRoster();
  }

  private hasHumans(): boolean {
    for (const seat of this.seats.values()) if (!seat.bot) return true;
    return false;
  }

  /** Un bot más en la sala, ya listo: espera a que estén listos los demás. */
  private addBot(): void {
    // La grilla de caminos tarda unos 20 ms en armarse: mejor ahora, en el
    // lobby, que en el primer tick de la partida.
    navGridFor(this.arena);
    const used = new Set([...this.seats.values()].map((s) => s.meta.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextPlayerId}`;
    const playerId = this.nextPlayerId++;
    this.seats.set(playerId, {
      playerId,
      connId: null,
      token: null,
      goneAt: 0,
      meta: { id: playerId, name, colorIndex: this.freeColorIndex(), ready: true, bot: true },
      inputs: new InputQueue(),
      lastMarkAt: 0,
      bot: createBotMemory((Date.now() ^ (playerId * 7919)) | 0),
    });
    this.state.players.push(createPlayer(playerId));
    this.broadcastRoster();
    this.ensureLoop();
  }

  private freeColorIndex(): number {
    const used = new Set<number>();
    for (const seat of this.seats.values()) used.add(seat.meta.colorIndex);
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
    return this.seats.size % PLAYER_COLORS.length;
  }

  private roster(): PlayerMeta[] {
    return [...this.seats.values()].map((s) => ({ ...s.meta }));
  }

  private itemsMessage(): ServerMsg {
    return {
      t: "items",
      items: this.state.items.map(packItem),
      crates: [...this.state.openedCrates],
      barrels: [...this.state.explodedBarrels],
    };
  }

  private broadcastItems(): void {
    this.broadcast(encodeServer(this.itemsMessage()));
  }

  private broadcastRoster(): void {
    this.broadcast(
      encodeServer({ t: "roster", roster: this.roster(), hostId: this.hostId, teamSize: this.state.teamSize }),
    );
  }

  private sendTo(conn: Connection<ConnState>, msg: ServerMsg): void {
    conn.send(encodeServer(msg));
  }
}

function clampAxis(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
