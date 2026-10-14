import { Application } from "pixi.js";
import {
  BTN_RELOAD,
  BUSH_SHOT_REVEAL_TICKS,
  BTN_SHOOT,
  BTN_SPRINT,
  CONSUMABLES,
  CONSUMABLE_IDS,
  INTERP_DELAY_MS,
  MS_PER_TICK,
  CRATE_REACH,
  PICKUP_RADIUS,
  RECONNECT_GRACE_MS,
  TICK_RATE,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  WEAPON_IDS,
  ZONE_PHASES,
  EMOTES,
  RULES,
  DOWNED_BLEED_TICKS,
  DOWNED_HP,
  REVIVE_RANGE,
  REVIVE_TICKS,
  RESPAWN_TICKS,
  RADAR_RANGE,
  ITEM_RADAR,
  bushAt,
  segmentBoxT,
  smokeRadius,
  nearCampfire,
  consumableAt,
  MAPS,
  mapArena,
  itemName,
  lootCrates,
  playerColor,
  packAim,
  rarityAt,
  unpackAim,
  unpackItem,
  unpackResult,
  weaponStats,
  weaponAt,
  CAUSE_EXPLOSION,
  CAUSE_STRIKE,
  CAUSE_FIRE,
  CAUSE_ZONE,
  type ArenaMap,
  type GroundItem,
  type MatchPhase,
  type PlayerMeta,
  type ServerMsg,
  type SimEvent,
  type SnapshotMsg,
  type UnpackedPlayer,
  type UnpackedResult,
} from "@wabbr/shared";
import { Net, diagnoseConnection } from "./net/connection.js";
import { SnapshotBuffer } from "./net/interpolation.js";
import { Predictor, type PredictedShot } from "./net/prediction.js";
import { LocalShots } from "./net/shots.js";
import { LocalGrenades } from "./net/grenades.js";
import { InputController, type SpectateIntent } from "./input.js";
import { TouchControls } from "./touch.js";
import { PX_PER_METER, addMatch, loadRecords, recordsLine } from "./records.js";
import { titlesFor } from "./titles.js";
import { selectedHat, unlock, type Achievement } from "./achievements.js";
import { WorldView } from "./render/world.js";
import { Minimap, type Mark } from "./render/minimap.js";
import { causeIconUrl } from "./render/textures.js";
import { UI, type Award, type BetChoice, type ResultRow } from "./ui.js";
import { Sound, type Spot } from "./audio.js";

/** Cuánto tira la cámara hacia el cursor (0 = centrada en el jugador). */
const CAMERA_LEAD = 0.18;
/**
 * Cuánto más se ve con el francotirador en la mano. Su bala llega a ~1400 px
 * y sin mira la pantalla mostraba ~570 hacia cada costado: tenía más alcance
 * que lo que se veía. El servidor no recorta por distancia (sólo por línea de
 * vista), así que lo que entra en la pantalla más grande ya llega.
 */
const SCOPE_ZOOM = 1.4;
/** Kills dentro de esta ventana cuentan como seguidas. */
const STREAK_WINDOW_MS = 4500;
/** Por cantidad de kills seguidas. Las de 5 o más son todas masacre. */
const MULTI_KILLS = ["", "", "¡Doble kill!", "¡Triple kill!", "¡Cuádruple kill!", "¡Masacre!"];
/** Cuánto dura una marca en pantalla. */
const MARK_MS = 5000;
/** Qué tan adelante del muñeco va la mira cuando se apunta con el stick táctil. */
const TOUCH_CURSOR_DISTANCE = 160;

export class Game {
  private app!: Application;
  private world!: WorldView;
  private minimap!: Minimap;
  /** El mapa de la sala: cambia en el lobby si el host eligió uno nuevo cada partida. */
  private arena: ArenaMap = mapArena(0);
  /** Índice en MAPS del mapa de arriba. */
  private mapIndex = 0;
  private readonly input = new InputController();
  private readonly snapshots = new SnapshotBuffer();

  private net: Net | null = null;
  /** Se cortó la conexión y PartySocket está reintentando. Pasado el plazo, se abandona. */
  private giveUpTimer: ReturnType<typeof setTimeout> | null = null;
  private predictor: Predictor | null = null;
  /** Tus balas, que se dibujan desde el click sin esperar al servidor. */
  private readonly shots = new LocalShots();
  /** Tus granadas, igual: salen de la mano al apretar G. */
  private readonly grenades = new LocalGrenades();
  private readonly sound = new Sound();
  /** Para soltar los listeners de ventana al destruir el juego. */
  private readonly listeners = new AbortController();
  /** Para sonar el aviso una vez al salir de la zona, no en cada cuadro. */
  private wasOutside = false;
  /**
   * Efectos de lo que no es tuyo, esperando a que el dibujo llegue a su momento.
   * Los demás jugadores se ven `INTERP_DELAY_MS` en el pasado: si el fogonazo
   * de un tiro ajeno se dibujara al recibirlo, saldría antes de que el que
   * dispara levantara el arma en pantalla, y la chispa antes de que la bala
   * llegara a la pared.
   */
  private deferred: { at: number; run: () => void }[] = [];
  /** Paquetes aéreos ya anunciados, para avisar una sola vez de cada uno. */
  private announcedAirdrops = new Set<number>();

  private localId = -1;
  private hostId = -1;
  private roster = new Map<number, PlayerMeta>();
  private phase: MatchPhase = "lobby";
  private phaseTicksLeft = 0;
  private seq = 1;
  private inputAccumulator = 0;
  private aliveCount = 0;
  /**
   * Kills y estado de TODOS, vengan o no en la lista de posiciones. Desde que el
   * servidor oculta lo que no ves, `frame.players` ya no sirve para el marcador:
   * alguien detrás de una pared se vería como muerto y con cero kills.
   */
  private standings = new Map<number, { kills: number; alive: boolean; place: number; team: number }>();
  /** Modo de la sala: 1 todos contra todos, 2 dúos. */
  private teamSize = 1;
  /** Reglas especiales de la sala (índice en RULES). */
  private rules = 0;
  /** 0 siempre el mismo mapa, 1 uno nuevo cada partida. */
  private mapMode = 0;
  /** Si en el input anterior ya estaba volando de un hongo (para el sonido). */
  private wasJumping = false;
  /** Si la partida es de noche (para el logro "Búho"). */
  private night = false;
  /** Kills recientes (performance.now()) y kills en esta vida, por jugador: para las rachas. */
  private streaks = new Map<number, { recent: number[]; life: number }>();
  /** Si este cliente vio empezar la partida en curso (para los récords). */
  private sawStart = false;
  /** Si los récords de esta partida ya se sumaron. */
  private recorded = false;
  /** Cómo te mataron, para mostrarlo mientras mirás el resto de la partida. */
  private deathNote = "";
  /** Cuándo volvés con la segunda oportunidad (performance.now()), o 0 si no. */
  private respawnAt = 0;
  /** Por quién apostaste en esta partida, o -1. */
  private myBet = -1;
  /** Las apuestas de la partida que terminó: [quién, por quién]. */
  private finalBets: [number, number][] = [];
  /** El campeón de la sala (el que más partidas ganó) y dónde está, o null. */
  private champion: { id: number; x: number; y: number } | null = null;
  /** De qué campeón ya se avisó en esta partida. */
  private announcedChampion = -1;
  /** Ya se avisó que anda suelta la gallina dorada. */
  private announcedChicken = false;
  /** Las marcas de la última pasada del radar de tu equipo. */
  private radarPings: { x: number; y: number; at: number }[] = [];
  /** Dónde se la oyó por última vez, para el minimapa: se refresca cada tanto. */
  private chickenHint: { x: number; y: number; at: number } | null = null;
  /** El más buscado y dónde se lo vio por última vez, o null. */
  private wanted: { id: number; x: number; y: number } | null = null;
  /** Lugares marcados por la pareja, que se muestran unos segundos. */
  private marks: Mark[] = [];
  /**
   * Todos los que pasaron por la sala, aunque ya se hayan ido. El roster sólo
   * tiene a los conectados, y en el resultado final tiene que figurar también
   * el que se fue en el medio, con su nombre.
   */
  private everyone = new Map<number, PlayerMeta>();
  private lastLocal: UnpackedPlayer | null = null;
  /** Dónde se dibujó tu muñeco en el último cuadro: de ahí salen tus disparos en pantalla. */
  private lastDrawn: { x: number; y: number } | null = null;
  /** Cuándo disparaste por última vez (performance.now()): disparar te delata en un arbusto. */
  private lastShotAt = -Infinity;
  /** Tick del servidor que se mostró en el último cuadro: viaja con cada input (compensación de lag). */
  private viewTick = -1;
  /**
   * Loot del piso. No viene en el snapshot: llega entero al empezar la ronda y
   * después se mantiene con los eventos de recogida y de suelta.
   */
  private items = new Map<number, GroundItem>();
  /** Cajas ya abiertas. Igual que el loot: llega al entrar y se mantiene por eventos. */
  private openedCrates = new Set<number>();
  /** Las cajas doradas de la partida. */
  private goldenCrates: number[] = [];
  /** Cajas del mapa, en el mismo orden que las numera el servidor. */
  private crates = lootCrates(this.arena);
  /** Ya recibimos la posición de spawn autoritativa de esta ronda. */
  private spawned = false;
  /** A quién se sigue al espectear. Al morir, a quien te mató. */
  private spectateId = -1;
  /** Cámara libre del espectador, o null si se está siguiendo a alguien. */
  private freeCam: { x: number; y: number } | null = null;
  /** Zoom actual de la cámara, que se acerca de a poco al de la mira. */
  private zoom = 1;
  /** El jugador que se está mirando: el HUD muestra su vida y su arma. */
  private watched: UnpackedPlayer | null = null;
  private detachInput: (() => void) | null = null;

  constructor(private readonly ui: UI) {}

  async init(): Promise<void> {
    this.app = new Application();
    await this.app.init({
      backgroundColor: 0x0d1014,
      // El mundo es pixel art: el antialiasing solo lo ensuciaría.
      antialias: false,
      resizeTo: window,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      // Sin redondear los sprites, por lo mismo que la cámara (ver applyCamera):
      // la escala de la vista es fraccionaria, así que el redondeo no alinea la
      // grilla del pixel art con la de la pantalla. Lo único que hacía era que
      // cada sprite saltara de a un píxel entero por su cuenta mientras el suelo
      // se desplaza suave, y eso se ve como si todo vibrara.
      roundPixels: false,
    });

    document.getElementById("stage")!.appendChild(this.app.canvas);

    this.world = new WorldView(this.app, this.arena);
    const minimapCanvas = this.minimapCanvas;
    this.minimap = new Minimap(minimapCanvas, this.arena);
    // Tocar o clickear el minimapa marca ese lugar para el compañero.
    minimapCanvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.markAt(this.minimap.toWorld(e.clientX, e.clientY));
      },
      { signal: this.listeners.signal },
    );

    const detachKeys = this.input.attach(this.app.canvas);
    const detachTouch = new TouchControls(this.input).attach(this.app.canvas, {
      root: document.getElementById("hud")!,
      slots: document.getElementById("slots")!,
      consumables: document.getElementById("consumables")!,
      pickup: document.getElementById("pickupPrompt")!,
    });
    this.detachInput = () => {
      detachKeys();
      detachTouch();
    };

    // El navegador no deja sonar nada hasta el primer gesto: el audio arranca ahí.
    const unlock = () => this.sound.unlock();
    const signal = this.listeners.signal;
    window.addEventListener("pointerdown", unlock, { signal });
    // Safari en el teléfono sólo deja arrancar el audio al levantar el dedo.
    window.addEventListener("touchend", unlock, { signal });
    window.addEventListener("keydown", unlock, { signal });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyM" || e.repeat) return;
      // Escribiendo el nombre o el código, la M es una letra.
      if (e.target instanceof HTMLInputElement) return;
      const muted = this.sound.toggleMute();
      this.ui.addNotice(muted ? "Sonido apagado (M)" : "Sonido prendido (M)");
    }, { signal });
    window.addEventListener("resize", () => this.world.resize());

    this.app.ticker.add((ticker) => this.frame(ticker.deltaMS));

    // Solo en dev: los scripts de captura necesitan saber dónde está el jugador
    // para caminar hacia algún lado en vez de dar vueltas al azar.
    if (import.meta.env.DEV) {
      (window as unknown as { wabbr?: unknown }).wabbr = {
        pos: () => (this.lastLocal ? { x: this.lastLocal.x, y: this.lastLocal.y } : null),
        centro: { x: WORLD_CENTER_X, y: WORLD_CENTER_Y },
        radio: WORLD_RADIUS,
        sprite: () => this.world.debugPlayer(this.localId),
        camara: () => this.world.debugCamera(),
        cortar: () => this.net?.simulateDrop(),
        paquetes: () => [...(this.snapshots.latest?.airdrops.values() ?? [])],
        gallina: () => this.snapshots.latest?.chicken ?? null,
        // Una pasada de radar de mentira, para ver cómo se dibuja.
        radar: (pings: [number, number][]) => {
          this.radarPings = pings.map(([x, y]) => ({ x, y, at: performance.now() }));
        },
        // El centro del follaje del arbusto más cercano, para probar el escondite.
        arbusto: () => {
          const me = this.lastLocal;
          if (!me) return null;
          let best: { x: number; y: number } | null = null;
          let bestD = Infinity;
          for (const d of this.arena.decor) {
            if (d.kind !== "bush") continue;
            const c = { x: d.x, y: d.y - 14 * d.scale };
            const dist = Math.hypot(c.x - me.x, c.y - me.y);
            if (dist < bestD) {
              bestD = dist;
              best = c;
            }
          }
          return best;
        },
        escondido: () => !document.getElementById("hiddenTag")!.hidden,
        // El barril más cercano con tiro limpio, y apuntarle con el mouse: para
        // probar que estallen.
        barril: () => {
          const me = this.lastLocal;
          if (!me) return null;
          const obstacles = this.arena.obstacles;
          const clear = (index: number, x: number, y: number) =>
            obstacles.every(
              (o, i) => i === index || segmentBoxT(me.x, me.y, x - me.x, y - me.y, 3, o) < 0,
            );
          return (
            obstacles
              .map((o, index) => ({ o, index, x: o.x + o.w / 2, y: o.y + o.h / 2 }))
              .filter((b) => b.o.kind === "barrel" && Math.hypot(b.x - me.x, b.y - me.y) < 700)
              .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))
              .find((b) => clear(b.index, b.x, b.y)) ?? null
          );
        },
        // Los compañeros en dúos, para probar que se ven y que no se lastiman.
        equipo: () => [...this.mates()],
        apuntar: (x: number, y: number) => {
          const s = this.world.worldToScreen(x, y);
          this.input.mouseX = s.x;
          this.input.mouseY = s.y;
        },
        // Espectando: lleva la cámara libre a un punto, para mirar algo de cerca.
        mirar: (x: number, y: number) => {
          this.freeCam = { x, y };
        },
        enFrame: () => {
          const frame = this.snapshots.sample(performance.now() - INTERP_DELAY_MS);
          const mine = frame?.players.find((p) => p.id === this.localId);
          return mine ? { alive: mine.alive, downed: mine.downed, x: Math.round(mine.x), y: Math.round(mine.y) } : null;
        },
      };
    }
  }

  // ------------------------------------------------------------ conexión

  connect(room: string, name: string): void {
    this.disconnect();
    this.ui.showScreen("connecting");

    this.net = new Net({
      room,
      name,
      hat: selectedHat(),
      onMessage: (msg) => this.onMessage(msg),
      onClose: (code) => {
        if (this.localId === -1) return;
        if (code === 4001) {
          // Otra pestaña con el mismo token (por ejemplo, "duplicar pestaña")
          // se quedó con el asiento. Reintentar sería sacársela de vuelta, y
          // las dos se lo pasarían para siempre: ésta se retira.
          this.disconnect();
          this.ui.showScreen("menu");
          this.ui.showError("Abriste WabBR en otra pestaña: seguís jugando allá.");
          return;
        }
        this.startReconnecting();
      },
      onError: () => {
        // Ya estábamos adentro: es un reintento fallido y PartySocket sigue probando.
        if (this.localId !== -1) return;
        this.ui.showScreen("menu");
        this.ui.showError("No se pudo conectar…");
        // El motivo real se averigua por HTTP, porque el navegador no deja leer
        // el estado de un upgrade de WebSocket fallido. Llega un instante
        // después, pero dice dónde mirar en vez de mandar a revisar el servidor.
        void diagnoseConnection(room).then((motivo) => this.ui.showError(motivo));
      },
    });
  }

  disconnect(): void {
    this.stopReconnecting();
    this.net?.close();
    this.net = null;
    this.reset();
  }

  /**
   * Se cortó la conexión. Antes te mandaba al menú con un error; ahora el
   * servidor te guarda el lugar un rato (RECONNECT_GRACE_MS) y PartySocket
   * reintenta solo, así que se avisa y se espera. Si no vuelve a tiempo, el
   * lugar ya se perdió y recién ahí se va al menú.
   */
  private startReconnecting(): void {
    this.ui.setReconnecting(true);
    if (this.giveUpTimer) return;
    this.giveUpTimer = setTimeout(() => {
      this.giveUpTimer = null;
      this.ui.setReconnecting(false);
      this.disconnect();
      this.ui.showScreen("menu");
      this.ui.showError("Se cortó la conexión con la sala.");
    }, RECONNECT_GRACE_MS + 5000);
  }

  private stopReconnecting(): void {
    if (this.giveUpTimer) clearTimeout(this.giveUpTimer);
    this.giveUpTimer = null;
    this.ui.setReconnecting(false);
  }

  private reset(): void {
    this.localId = -1;
    this.hostId = -1;
    // Récords y rachas son de una partida que este cliente vio empezar: al
    // reconectar o cambiar de sala, nada de lo anterior sigue valiendo.
    this.sawStart = false;
    this.recorded = false;
    this.streaks.clear();
    // Sin esto, reconectar durante una partida en curso no dispara el cambio de
    // fase y el jugador se queda mirando el lobby con el juego corriendo detrás.
    this.phase = "lobby";
    this.predictor = null;
    this.snapshots.clear();
    this.shots.clear();
    this.grenades.clear();
    this.deferred = [];
    this.announcedAirdrops.clear();
    this.marks = [];
    this.roster.clear();
    this.world.reset();
    this.input.enabled = false;
    this.input.releaseAll();
    this.spectateId = -1;
    this.respawnAt = 0;
    this.myBet = -1;
    this.freeCam = null;
    this.watched = null;
    this.spawned = false;
    this.lastLocal = null;
    this.lastDrawn = null;
    this.viewTick = -1;
    this.items.clear();
    this.standings.clear();
    this.everyone.clear();
    this.openedCrates.clear();
    this.world.resetCrates();
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome": {
        this.stopReconnecting();
        const inMatch = msg.phase === "playing" || msg.phase === "countdown";
        if (msg.you === this.localId && inMatch) {
          // Volvimos a nuestro asiento en la misma partida: se sigue jugando.
          // Lo que se mandó durante el corte no llegó, así que la predicción
          // se replanta en la posición del servidor con el próximo snapshot.
          this.hostId = msg.hostId;
          this.setRoster(msg.roster);
          this.spawned = false;
          return;
        }
        // Un asiento nuevo (el lugar ya se había perdido, o es la primera vez):
        // de lo de antes no sirve nada.
        if (this.localId !== -1 && msg.you !== this.localId) this.reset();
        this.localId = msg.you;
        this.hostId = msg.hostId;
        this.setRoster(msg.roster);
        this.ui.setRoom(msg.room);
        this.ui.resetReady();
        this.ui.showScreen("lobby");
        return;
      }

      case "roster":
        if ((msg.map ?? 0) !== this.mapIndex) this.changeMap(msg.map ?? 0);
        this.ui.setMap(msg.mapMode ?? 0, MAPS[this.mapIndex]?.name ?? "", msg.hostId === this.localId);
        this.mapMode = msg.mapMode ?? 0;
        this.hostId = msg.hostId;
        this.teamSize = msg.teamSize ?? 1;
        this.setRoster(msg.roster);
        this.ui.setMode(this.teamSize, this.hostId === this.localId);
        this.ui.setBotSkill(msg.botSkill ?? 1, this.hostId === this.localId, msg.roster.some((p) => p.bot));
        this.ui.setNight(msg.night === true, this.hostId === this.localId);
        this.ui.setSecondChance(msg.secondChance === true, this.hostId === this.localId);
        this.ui.setRules(msg.rules ?? 0, this.hostId === this.localId);
        this.rules = msg.rules ?? 0;
        this.night = msg.night === true;
        this.world.setNight(msg.night === true);
        return;

      case "start":
        // Arranca la ronda: el predictor se re-sincroniza con el primer snapshot.
        this.sawStart = true;
        this.recorded = false;
        this.respawnAt = 0;
        this.myBet = -1;
        this.finalBets = [];
        this.streaks.clear();
        if (this.rules !== 0) this.ui.addNotice(`Reglas de esta partida: ${RULES[this.rules] ?? ""}`);
        if (this.mapMode === 1) this.ui.addNotice(`Mapa: ${MAPS[this.mapIndex]?.name ?? ""}`);
        this.predictor = new Predictor(this.localId);
        this.spawned = false;
        this.seq = 1;
        // El tick del servidor vuelve a cero con la ronda.
        this.viewTick = -1;
        this.snapshots.clear();
        this.shots.clear();
        this.grenades.clear();
        this.deferred = [];
        this.announcedAirdrops.clear();
        this.world.reset();
        this.openedCrates.clear();
        this.world.resetCrates();
        this.ui.resetReady();
        this.input.enabled = true;
        return;

      case "items":
        this.items = new Map(msg.items.map(unpackItem).map((item) => [item.id, item]));
        this.openedCrates = new Set(msg.crates);
        this.world.resetCrates();
        this.goldenCrates = msg.golden ?? [];
        this.world.setGoldenCrates(this.goldenCrates);
        for (const id of this.openedCrates) this.world.setCrateOpen(id);
        for (const index of msg.barrels ?? []) this.world.setBarrelExploded(index);
        return;

      case "s":
        this.onSnapshot(msg);
        return;

      case "emote":
        this.world.showEmote(msg.by, EMOTES[msg.id] ?? "");
        this.sound.pickup();
        return;

      case "bet": {
        const by = this.everyone.get(msg.by)?.name ?? "Alguien";
        const on = this.everyone.get(msg.on)?.name ?? "alguien";
        if (msg.by === this.localId) this.myBet = msg.on;
        this.ui.addNotice(msg.by === this.localId ? `Apostaste por ${on}` : `${by} apuesta por ${on}`);
        return;
      }

      case "mark": {
        const now = performance.now();
        const color = playerColor(this.everyone.get(msg.by)?.colorIndex ?? 0);
        // Una por persona: la nueva reemplaza a la anterior del mismo.
        this.marks = this.marks.filter((m) => m.by !== msg.by);
        this.marks.push({ by: msg.by, x: msg.x, y: msg.y, color, at: now, until: now + MARK_MS });
        this.sound.mark();
        return;
      }

      case "err":
        // Cerrar de verdad: si no, PartySocket seguía reintentando por detrás
        // y el servidor lo rechazaba una y otra vez (sala llena, echado...).
        this.disconnect();
        this.ui.showScreen("menu");
        this.ui.showError(msg.message);
        return;
    }
  }

  private setRoster(roster: PlayerMeta[]): void {
    this.roster = new Map(roster.map((p) => [p.id, p]));
    for (const p of roster) this.everyone.set(p.id, p);
    this.ui.setRoster(roster, this.hostId, this.localId, this.teamSize);
  }

  // ------------------------------------------------------------ snapshots

  private onSnapshot(msg: SnapshotMsg): void {
    this.snapshots.push(msg, performance.now());
    if (msg.bt) this.finalBets = msg.bt;
    this.aliveCount = msg.alive;
    this.wanted = msg.mw ? { id: msg.mw[0], x: msg.mw[1], y: msg.mw[2] } : null;
    this.champion = msg.ch ? { id: msg.ch[0], x: msg.ch[1], y: msg.ch[2] } : null;
    if (this.champion && this.champion.id !== this.announcedChampion && msg.phase === "playing") {
      this.announcedChampion = this.champion.id;
      const name = this.everyone.get(this.champion.id)?.name ?? "Alguien";
      this.ui.addNotice(
        this.champion.id === this.localId
          ? "Ganaste más partidas que nadie: hoy todos te ven en el mapa"
          : `${name} ganó más partidas: todos lo ven en el mapa (corona roja)`,
      );
    }
    if (msg.gc && !this.announcedChicken && msg.phase === "playing") {
      this.announcedChicken = true;
      this.ui.addNotice("¡Anda suelta una gallina dorada! Cazala a los tiros: suelta botín legendario");
      this.sound.cluck();
    }
    // La pista del minimapa: dónde se la oyó, cada 8 segundos. Encontrarla es
    // parte del juego, pero el mapa es grande para ir a ciegas.
    const now = performance.now();
    if (!msg.gc) this.chickenHint = null;
    else if (!this.chickenHint || now - this.chickenHint.at > 8000) this.chickenHint = { x: msg.gc[0], y: msg.gc[1], at: now };
    for (const [id] of msg.ad ?? []) {
      if (this.announcedAirdrops.has(id)) continue;
      this.announcedAirdrops.add(id);
      this.ui.addNotice("Cae un paquete aéreo");
      this.sound.airdrop();
    }
    this.standings = new Map(
      msg.st.map((r) => [r[0], { kills: r[1], alive: r[2] === 1, place: r[3] ?? 0, team: r[4] ?? r[0] }]),
    );

    const previousPhase = this.phase;
    this.phase = msg.phase;
    this.phaseTicksLeft = msg.left;

    const me = this.snapshots.latest?.players.get(this.localId) ?? null;

    if (me) {
      this.lastLocal = me;
      if (this.predictor && me.alive) {
        if (!this.spawned) {
          // Primer snapshot de la ronda: plantarse donde dice el servidor.
          this.predictor.reset(me.x, me.y);
          this.spawned = true;
        }
        this.predictor.reconcile(me, this.arena);
      }
    }

    if (msg.ev) this.handleEvents(msg.ev);
    // Después de los eventos: un tiro predicho cuyo input ya se procesó y no
    // trajo su "shot" en este mismo snapshot no salió nunca.
    if (me) {
      this.shots.settle(me.lastSeq);
      this.grenades.settle(me.lastSeq);
    }
    if (previousPhase !== this.phase) this.onPhaseChange(this.phase, msg);
  }

  private onPhaseChange(to: MatchPhase, msg: SnapshotMsg): void {
    if (to === "countdown" || to === "playing") {
      this.ui.showScreen(null);
      this.input.enabled = to === "playing";
      if (to === "playing" && !this.predictor) this.predictor = new Predictor(this.localId);
      return;
    }

    if (to === "ended") {
      this.input.enabled = false;
      this.input.releaseAll();
      this.showResult(msg);
      return;
    }

    if (to === "lobby") {
      this.ui.resetReady();
      this.ui.showScreen("lobby");
      this.world.reset();
      this.snapshots.clear();
      this.shots.clear();
      this.grenades.clear();
      this.deferred = [];
      this.predictor = null;
      this.spawned = false;
      this.spectateId = -1;
      this.deathNote = "";
      this.respawnAt = 0;
      this.myBet = -1;
      this.recorded = false;
      this.announcedChampion = -1;
      this.announcedChicken = false;
      this.chickenHint = null;
      this.radarPings = [];
      this.streaks.clear();
      this.freeCam = null;
      this.watched = null;
    }
  }

  /**
   * El resultado se ordena por puesto —cuánto aguantaste—, que es lo que
   * decide un battle royale; las kills desempatan y se muestran al lado.
   */
  private showResult(msg: SnapshotMsg): void {
    const results = new Map((msg.res ?? []).map(unpackResult).map((r) => [r.id, r]));
    // En dúos gana la pareja: el equipo del ganador (para los nombres y las apuestas).
    const winnerTeam = msg.winner >= 0 ? this.standings.get(msg.winner)?.team : undefined;
    const rows: (ResultRow & { id: number })[] = [];
    for (const [id, kills, , place = 0] of msg.st) {
      // Sin puesto es que no jugó esta partida: entró a mirar.
      if (place <= 0) continue;
      const meta = this.everyone.get(id);
      rows.push({
        id,
        hat: meta?.hat ?? 0,
        name: meta?.name ?? "Alguien",
        kills,
        colorIndex: meta?.colorIndex ?? 0,
        place,
        isLocal: id === this.localId,
        left: !this.roster.has(id),
        damage: results.get(id)?.damageDealt ?? 0,
        accuracy: shotAccuracy(results.get(id)),
        shots: results.get(id)?.shotsFired ?? 0,
        survived: (results.get(id)?.survivedTicks ?? 0) / TICK_RATE,
        longestKill: Math.round((results.get(id)?.longestKill ?? 0) / PX_PER_METER),
      });
    }
    rows.sort((a, b) => a.place - b.place || b.kills - a.kills);

    // Un título para cada uno, con los números del resultado.
    const titles = titlesFor(
      rows.map((r) => {
        const res = results.get(r.id);
        return {
          id: r.id,
          place: r.place,
          kills: r.kills,
          damage: r.damage,
          damageTaken: res?.damageTaken ?? 0,
          shots: res?.shotsFired ?? 0,
          hits: res?.shotsHit ?? 0,
          survived: r.survived,
          longestKill: r.longestKill,
          healed: res?.healed ?? 0,
          selfDamage: res?.selfDamage ?? 0,
          traveled: Math.round((res?.traveled ?? 0) / PX_PER_METER),
          thrown: res?.thrown ?? 0,
          cameBack: res?.cameBack ?? false,
          guessed: this.finalBets.some(
            ([by, on]) => by === r.id && winnerTeam !== undefined && this.standings.get(on)?.team === winnerTeam,
          ),
        };
      }),
    );
    for (const r of rows) r.title = titles.get(r.id);

    const mine = rows.find((r) => r.isLocal);
    // En pareja se habla en plural: el puesto es de los dos.
    const paired = this.mates().size > 0;
    const title = !mine
      ? "Fin de la partida"
      : mine.place === 1
        ? paired
          ? "¡Ganaron!"
          : "¡Ganaste!"
        : `${paired ? "Quedaron" : "Quedaste"} en el puesto ${mine.place}`;
    // Los dos nombres de la pareja, también el que cayó antes.
    const winners =
      msg.winner < 0
        ? []
        : [...this.standings]
            .filter(([id, s]) => id === msg.winner || s.team === winnerTeam)
            .map(([id]) => this.everyone.get(id)?.name ?? "")
            .filter(Boolean);
    const subtitle =
      winners.length === 0
        ? "Nadie sobrevivió a la zona."
        : winners.length === 1
          ? `${winners[0]} quedó último en pie.`
          : `Ganaron ${winners.join(" y ")}.`;
    // Los récords se cuentan una vez por partida, aunque el resultado se muestre de nuevo.
    let records: string[] = [];
    // Sólo si la viste empezar: entrar a mitad (o recargar en la pantalla
    // final) no es haberla jugado, y contaría la misma partida dos veces.
    if (mine && this.sawStart && !this.recorded) {
      this.recorded = true;
      const won = mine.place === 1 && msg.winner >= 0;
      records = addMatch({ won, kills: mine.kills, damage: mine.damage, longestKill: mine.longestKill });
      this.ui.setMyStats(recordsLine());
      if (won) this.achieve("win");
      if (won && this.night) this.achieve("nightWin");
      if (mine.kills >= 5) this.achieve("fiveKills");
      if (mine.longestKill >= 40) this.achieve("longShot");
      if (loadRecords().played >= 10) this.achieve("veteran");
    }
    // Las apuestas: quién apostó por quién, con un ✓ si acertó.
    const bets = this.finalBets.map(([by, on]) => {
      const right = winnerTeam !== undefined && this.standings.get(on)?.team === winnerTeam;
      return `${this.everyone.get(by)?.name ?? "?"} → ${this.everyone.get(on)?.name ?? "?"} ${right ? "✓" : "✗"}`;
    });
    this.ui.showResult(title, subtitle, rows, awardsFor(rows), records, bets);
  }

  private handleEvents(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.t) {
        case "shot":
          // El tuyo ya salió cuando apretaste el gatillo: acá sólo se confirma.
          // Si no estaba predicho, sus balas se dibujan atrasadas como las de
          // cualquiera, y el fogonazo con ellas.
          if (ev.byId === this.localId && this.shots.confirm(ev.seq, ev.firstBullet, ev.pellets)) break;
          // La ballesta no tiene fogonazo ni ruido: se ve venir la flecha, no de dónde salió.
          if (ev.silent) break;
          // Un tick antes que el resto: es cuando la bala está en el caño (ver
          // SnapshotBuffer.sample).
          this.defer(() => {
            this.world.spawnMuzzleFlash(ev.x, ev.y, ev.aim);
            this.sound.shot(ev.weapon ?? 0, this.spot(ev.x, ev.y));
          }, -MS_PER_TICK);
          break;
        case "impact":
          if (this.shots.covers(ev.bullet)) {
            if (this.shots.serverImpact(ev.bullet)) this.world.spawnImpact(ev.x, ev.y);
          } else {
            this.defer(() => {
              this.world.spawnImpact(ev.x, ev.y);
              this.sound.impact(this.spot(ev.x, ev.y));
            });
          }
          break;
        case "airdrop": {
          // En el reloj atrasado, que es en el que se lo ve bajar.
          this.defer(() => {
            this.world.spawnLanding(ev.x, ev.y);
            this.sound.landing(this.spot(ev.x, ev.y));
            const me = this.lastLocal;
            if (me?.alive) {
              const dist = Math.hypot(me.x - ev.x, me.y - ev.y);
              this.world.addShake(Math.max(0, 8 * (1 - dist / 400)));
            }
          });
          break;
        }
        case "barrel":
          // En el reloj atrasado, junto con la explosión que lo acompaña.
          this.defer(() => this.world.setBarrelExploded(ev.index));
          break;
        case "throw":
          if (ev.byId === this.localId) this.grenades.confirm(ev.seq, ev.grenade);
          break;
        case "wanted": {
          const name = this.everyone.get(ev.id)?.name ?? "Alguien";
          this.ui.addNotice(
            ev.id === this.localId
              ? "¡Sos el más buscado! Todos te ven en el mapa"
              : `${name} es el más buscado: el que lo mate se cura entero`,
          );
          break;
        }
        case "bounty": {
          const by = this.everyone.get(ev.byId)?.name ?? "Alguien";
          const target = this.everyone.get(ev.targetId)?.name ?? "alguien";
          this.ui.addNotice(
            ev.byId === this.localId ? `Cobraste la recompensa por ${target}: vida llena` : `${by} cobró la recompensa por ${target}`,
          );
          if (ev.byId === this.localId) this.sound.pickup();
          break;
        }
        case "cluck":
          this.defer(() => {
            this.world.spawnFeathers(ev.x, ev.y);
            this.sound.cluck(this.spot(ev.x, ev.y));
          });
          if (ev.byId === this.localId) this.world.showHitMarker();
          break;
        case "chicken": {
          const by = this.everyone.get(ev.byId)?.name ?? "Alguien";
          this.ui.addNotice(ev.byId === this.localId ? "¡Cazaste la gallina dorada! Agarrá el botín" : `${by} cazó la gallina dorada`);
          this.defer(() => {
            this.world.spawnFeathers(ev.x, ev.y, 18);
            this.sound.cluck(this.spot(ev.x, ev.y), true);
          });
          break;
        }
        case "respawn": {
          if (ev.id === this.localId) {
            // De vuelta: a jugar. El predictor se planta donde apareció con el
            // próximo snapshot, como al empezar.
            this.respawnAt = 0;
            this.deathNote = "";
            this.spectateId = -1;
            this.freeCam = null;
            this.ui.setSpectating(null);
            this.ui.addNotice("¡Segunda oportunidad! Volviste con lo de arranque");
            this.sound.airdrop();
          } else {
            this.ui.addNotice(`${this.everyone.get(ev.id)?.name ?? "Alguien"} volvió con su segunda oportunidad`);
          }
          break;
        }
        case "strike":
          this.ui.addNotice("¡Bombardeo! Salí de la zona roja o metete en una casa");
          this.sound.siren();
          break;
        case "fire":
          this.defer(() => this.sound.fire(this.spot(ev.x, ev.y)));
          break;
        case "smoke":
          // Junto con la nube, que se dibuja en el reloj atrasado.
          this.defer(() => this.sound.smoke(this.spot(ev.x, ev.y)));
          break;
        case "explosion": {
          // La tuya ya estalló en pantalla cuando se le acabó la mecha acá.
          if (this.grenades.covers(ev.grenade)) break;
          this.world.spawnExplosion(ev.x, ev.y);
          this.sound.explosion(this.spot(ev.x, ev.y));
          // El sacudón cae con la distancia: una explosión lejos se ve, no se siente.
          const me = this.lastLocal;
          if (me?.alive) {
            const dist = Math.hypot(me.x - ev.x, me.y - ev.y);
            this.world.addShake(Math.max(0, 18 * (1 - dist / 340)));
          }
          break;
        }
        case "hit":
          this.shots.serverHit(ev.bullet);
          // Si te toca, es de ahora: tu vida ya bajó en el HUD. Si no, pasó en
          // el mismo pasado en que se dibuja a los demás.
          if (ev.byId === this.localId || ev.targetId === this.localId) {
            this.world.spawnBlood(ev.x, ev.y);
          } else {
            this.defer(() => this.world.spawnBlood(ev.x, ev.y));
          }
          // El número y la marca son sólo de tus propios impactos: con los de
          // todos, la pantalla se llena de información que no es tuya.
          if (ev.byId === this.localId && ev.targetId !== this.localId) {
            this.world.spawnDamageNumber(ev.x, ev.y, ev.amount);
            this.world.showHitMarker();
            this.sound.hitConfirm();
          }
          if (ev.targetId === this.localId) this.sound.hurt();
          if (ev.targetId === this.localId) {
            this.world.addShake(4 + ev.amount * 0.12);
            // La flecha apunta al origen, o sea al revés de por donde venía.
            this.world.addDamageArc(ev.dir + Math.PI);
          }
          break;
        case "reload":
          if (ev.byId === this.localId) this.sound.reload();
          break;
        case "pickup": {
          const item = this.items.get(ev.itemId);
          this.items.delete(ev.itemId);
          if (ev.byId === this.localId) this.sound.pickup();
          if (item?.kind === ITEM_RADAR) this.onRadarTaken(ev.byId, item);
          break;
        }
        case "radar":
          // Sólo llegan las de tu equipo: el servidor filtra las de los demás.
          this.radarPings = ev.pings.map(([x, y]) => ({ x, y, at: performance.now() }));
          this.sound.radar();
          break;
        case "drop":
          this.items.set(ev.item.id, ev.item);
          break;
        case "crate":
          this.openedCrates.add(ev.crateId);
          this.world.setCrateOpen(ev.crateId);
          this.world.spawnImpact(ev.x, ev.y);
          break;
        case "down": {
          // Cayó, no murió: en el registro, con el arma, y "(caído)".
          const victim = this.roster.get(ev.targetId);
          const by = ev.byId >= 0 ? this.roster.get(ev.byId) : undefined;
          this.ui.addKill({
            killerName: by?.name ?? null,
            killerColor: cssColor(playerColor(by?.colorIndex ?? 0)),
            victimName: `${victim?.name ?? "Alguien"} (caído)`,
            victimColor: cssColor(playerColor(victim?.colorIndex ?? 0)),
            iconUrl: causeIconUrl(ev.cause),
            involvesMe: ev.targetId === this.localId || ev.byId === this.localId,
          });
          if (ev.targetId === this.localId) {
            this.sound.death();
            this.ui.addNotice("Caíste: tu compañero te puede levantar con E");
          } else if (this.mates().has(ev.targetId)) {
            this.ui.addNotice(`${victim?.name ?? "Tu compañero"} cayó: andá a levantarlo con E`);
          }
          break;
        }
        case "revive": {
          if (ev.byId === this.localId) this.achieve("revive");
          if (ev.targetId === this.localId || ev.byId === this.localId) {
            this.sound.pickup();
            const other = this.roster.get(ev.targetId === this.localId ? ev.byId : ev.targetId)?.name ?? "";
            this.ui.addNotice(ev.targetId === this.localId ? `${other} te levantó` : `Levantaste a ${other}`);
          }
          break;
        }
        case "kill": {
          const victim = this.roster.get(ev.targetId);
          const killer = ev.byId >= 0 ? this.roster.get(ev.byId) : undefined;
          this.ui.addKill({
            killerName: killer?.name ?? null,
            killerColor: cssColor(playerColor(killer?.colorIndex ?? 0)),
            victimName: victim?.name ?? "Alguien",
            victimColor: cssColor(playerColor(victim?.colorIndex ?? 0)),
            iconUrl: causeIconUrl(ev.cause),
            involvesMe: ev.targetId === this.localId || ev.byId === this.localId,
          });
          this.countStreak(ev.byId, ev.targetId, killer?.name);
          if (ev.byId === this.localId && ev.targetId !== this.localId) {
            this.achieve("firstKill");
            if (ev.cause === WEAPON_IDS.indexOf("rocket")) this.achieve("rocketKill");
            if (ev.cause === CAUSE_FIRE) this.achieve("fireKill");
          }
          if (ev.targetId === this.localId) {
            this.deathNote = deathNote(ev, killer?.name);
            this.respawnAt = ev.respawn ? performance.now() + RESPAWN_TICKS * MS_PER_TICK : 0;
            // Si vuelve, el predictor se planta donde aparezca, sin arrastrar
            // inputs de antes de morir (ver onSnapshot).
            this.spawned = false;
            // En dúos se sigue mirando al compañero, que sigue jugando por los dos.
            const mate = [...this.mates()].find((id) => this.standings.get(id)?.alive);
            this.spectateId = mate ?? ev.byId;
            this.sound.death();
          } else if (ev.byId === this.localId) {
            this.sound.kill();
          }
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- loop

  private frame(deltaMS: number): void {
    const dt = deltaMS / 1000;

    // Los inputs salen a ritmo fijo (20 Hz), independiente de los FPS de la pantalla.
    this.inputAccumulator = Math.min(this.inputAccumulator + deltaMS, MS_PER_TICK * 3);
    while (this.inputAccumulator >= MS_PER_TICK) {
      this.inputAccumulator -= MS_PER_TICK;
      this.tickInput();
      this.tickGrenades();
    }

    const now = performance.now();
    this.runDeferred(now);
    // Se leen siempre, aunque no se esté mirando: si no, lo apretado en otro
    // momento se aplicaría de golpe al morir.
    const intents = this.input.takeSpectateIntents();
    const emote = this.input.takeEmote();
    if (emote >= 0 && this.phase === "playing") this.net?.send({ t: "emote", id: emote });
    if (this.input.takeMark()) {
      this.markAt(this.world.screenToWorld(this.input.mouseX, this.input.mouseY));
    }

    const frame = this.snapshots.sample(now - INTERP_DELAY_MS);
    if (!frame) return;
    this.viewTick = frame.tick;

    // Tus balas chocan contra los demás tal como los ves, que es contra lo que
    // apuntaste. A tu compañero lo atraviesan, igual que en el servidor.
    const mates = this.mates();
    const targets: { id: number; x: number; y: number }[] = frame.players.filter(
      (p) => p.alive && p.id !== this.localId && !mates.has(p.id),
    );
    // La gallina también frena las balas propias, como en el servidor.
    if (frame.chicken) targets.push({ id: -1, x: frame.chicken.x, y: frame.chicken.y });
    this.shots.update(now, this.arena, targets, (x, y) => this.world.spawnImpact(x, y));
    // Las del servidor que ya dibujamos nosotros no se dibujan dos veces.
    const bullets = frame.bullets.filter((b) => !this.shots.covers(b.id));
    bullets.push(...this.shots.bullets());
    const grenades = frame.grenades.filter((g) => !this.grenades.covers(g.id));
    grenades.push(...this.grenades.grenades(this.inputAccumulator / MS_PER_TICK));

    // Cuánto se avanzó del tick en curso: con esto el muñeco se dibuja entre dos
    // pasos de simulación en vez de saltar de uno al otro.
    const alpha = this.inputAccumulator / MS_PER_TICK;
    const localPredicted =
      this.predictor && this.lastLocal?.alive ? this.predictor.renderPosition(dt, alpha) : null;
    this.lastDrawn = localPredicted;

    const aim = this.currentAim();
    // La misma regla que aplica el servidor (concealedFrom): en un arbusto y
    // sin haber disparado hace poco, o adentro del humo (ahí disparar no te
    // delata). Que alguien muy cerca te vea igual no se puede saber desde acá,
    // y no hace falta: lo vas a tener encima.
    const inBush =
      localPredicted !== null &&
      bushAt(this.arena, localPredicted.x, localPredicted.y) &&
      now - this.lastShotAt > BUSH_SHOT_REVEAL_TICKS * MS_PER_TICK;
    const inSmoke =
      localPredicted !== null &&
      frame.smokes.some((s) => Math.hypot(localPredicted.x - s.x, localPredicted.y - s.y) < smokeRadius(s) * 0.9);
    const hidden = inBush || inSmoke;
    this.ui.setHidden(inSmoke ? "en el humo" : inBush ? "en el arbusto" : null);
    this.ui.setNearFire(
      localPredicted !== null &&
        (this.lastLocal?.hp ?? 100) < 100 &&
        !this.lastLocal?.downed &&
        nearCampfire(this.arena, localPredicted.x, localPredicted.y),
    );
    this.world.update(
      { ...frame, bullets, grenades },
      this.roster,
      this.localId,
      localPredicted ? { ...localPredicted, aim, hidden, jump: this.predictor?.state.jumpTicks ?? 0 } : null,
      dt,
      mates,
      this.wanted?.id ?? -1,
      this.champion?.id ?? -1,
    );

    this.world.updateItems(this.items.values(), performance.now());
    // Muerto o espectando se ve todo, así que no se dibuja ninguna sombra.
    this.world.updateShadows(
      localPredicted ? localPredicted.x : null,
      localPredicted ? localPredicted.y : 0,
    );
    this.updateCamera(frame, localPredicted, intents, dt);
    // El minimapa sólo recibe clicks si hay a quién marcarle: si no, la esquina
    // de la pantalla se tragaba los tiros.
    document.body.classList.toggle("paired", mates.size > 0 && this.phase === "playing");
    this.marks = this.marks.filter((m) => m.until > now);
    this.world.drawMarks(this.marks);
    // Al espectear, el punto destacado del minimapa es el que estás mirando.
    const playing = this.lastLocal?.alive === true;
    // Esperando para volver se ve lo mismo que vivo: si no, volverías sabiendo
    // dónde está cada uno.
    const showAll = !playing && this.respawnAt === 0;
    this.minimap.draw(
      frame,
      this.roster,
      this.watched?.id ?? this.localId,
      mates,
      this.marks,
      this.wanted,
      showAll,
      this.champion,
      this.chickenHint,
      this.radarPings,
    );
    this.updateHud(frame, localPredicted);

    this.world.setCrosshair(this.input.mouseX, this.input.mouseY, this.phase === "playing");
    this.input.enabled = this.phase === "playing" && (this.lastLocal?.alive ?? false);
    this.input.watching = this.phase === "playing" && this.localId >= 0 && !this.input.enabled;
  }

  private tickInput(): void {
    if (!this.net || !this.predictor) return;
    if (this.phase !== "playing" || !this.lastLocal?.alive) return;

    // El ángulo viaja redondeado a milésimas de radián. La predicción usa el
    // mismo redondeo: si no, tu bala dibujada y la real saldrían separadas.
    const aim = unpackAim(packAim(this.currentAim()));
    // Lo que viste en el último cuadro, que es a lo que apuntaste.
    const input = this.input.sample(this.seq++, aim, this.viewTick);
    const shot = this.predictor.apply(input, this.arena);
    if (shot) this.onLocalShot(shot);
    // Pisó un hongo: el "boing" sale con el salto predicho, no un ping después.
    const jumping = this.predictor.state.jumpTicks > 0;
    if (jumping && !this.wasJumping) this.sound.jump();
    this.wasJumping = jumping;
    const thrown = this.predictor.takeThrow();
    if (thrown) this.grenades.throw(thrown.seq, thrown.kind, thrown.launch);

    this.net.send({
      t: "in",
      seq: input.seq,
      mx: input.moveX,
      my: input.moveY,
      aim: packAim(aim),
      btn:
        (input.shoot ? BTN_SHOOT : 0) |
        (input.reload ? BTN_RELOAD : 0) |
        (input.sprint ? BTN_SPRINT : 0),
      act: input.act,
      ...(input.view >= 0 ? { vt: Math.round(input.view * 10) } : {}),
    });
  }

  /**
   * Un tick de tus granadas, después del input como stepGrenades en el
   * servidor: la recién tirada ya avanza en este mismo tick. Va aparte del
   * input porque sigue aunque mueras con una en el aire.
   */
  private tickGrenades(): void {
    for (const blast of this.grenades.tick(this.arena)) {
      this.world.spawnExplosion(blast.x, blast.y);
      this.sound.explosion(this.spot(blast.x, blast.y));
      const me = this.lastDrawn;
      if (me) this.world.addShake(Math.max(0, 18 * (1 - Math.hypot(me.x - blast.x, me.y - blast.y) / 340)));
    }
  }

  /** Disparaste: la bala, el fogonazo y el retroceso salen ya, sin esperar al servidor. */
  private onLocalShot(shot: PredictedShot): void {
    const stats = weaponStats(shot.weapon, shot.tier);
    // La ballesta no te saca del arbusto (ver concealedFrom).
    if (!stats.silent) this.lastShotAt = performance.now();
    const me = this.predictor!.state;
    // La bala sale de la posición simulada, que es por donde va la real, pero
    // en pantalla arranca del arma tal como se ve.
    // Más lejos que esto no es el suavizado sino un salto (un respawn, una
    // corrección grande): ahí la bala sale de donde está de verdad.
    let drawn: { x: number; y: number } = this.lastDrawn ?? me;
    if (Math.hypot(drawn.x - me.x, drawn.y - me.y) > 40) drawn = me;
    this.shots.fire(shot, performance.now(), drawn.x - me.x, drawn.y - me.y);
    if (!stats.silent) this.world.spawnMuzzleFlash(drawn.x, drawn.y, me.aim);
    // Retroceso proporcional al arma: el francotirador patea, el subfusil apenas cosquillea.
    this.world.addShake(stats.damage * 0.055);
    this.sound.shot(shot.weapon);
  }

  /** Programa un efecto para cuando el dibujo atrasado llegue a su momento. */
  private defer(run: () => void, offsetMs = 0): void {
    this.deferred.push({ at: performance.now() + INTERP_DELAY_MS + offsetMs, run });
  }

  private runDeferred(now: number): void {
    if (this.deferred.length === 0) return;
    const due = this.deferred.filter((d) => d.at <= now);
    if (due.length === 0) return;
    this.deferred = this.deferred.filter((d) => d.at > now);
    for (const d of due) d.run();
  }

  /** Dónde pasó algo y desde dónde se escucha: desde donde mira la cámara. */
  private spot(x: number, y: number): Spot {
    const ear = this.world.cameraCenter();
    return { x, y, listenerX: ear.x, listenerY: ear.y };
  }

  /** Ángulo del jugador hacia el cursor, en coordenadas del mundo. */
  private currentAim(): number {
    if (!this.predictor) return 0;
    const touchAim = this.input.touch.aim;
    if (touchAim !== null) {
      // Con el stick, el cursor es virtual y va adelante del muñeco: la mira y
      // el adelanto de la cámara lo siguen igual que al mouse.
      const me = this.lastDrawn ?? this.predictor.state;
      const at = this.world.worldToScreen(me.x, me.y);
      this.input.mouseX = at.x + Math.cos(touchAim) * TOUCH_CURSOR_DISTANCE;
      this.input.mouseY = at.y + Math.sin(touchAim) * TOUCH_CURSOR_DISTANCE;
      return touchAim;
    }
    const target = this.world.screenToWorld(this.input.mouseX, this.input.mouseY);
    return Math.atan2(target.y - this.predictor.state.y, target.x - this.predictor.state.x);
  }

  private updateCamera(
    frame: ReturnType<SnapshotBuffer["sample"]>,
    localPredicted: { x: number; y: number } | null,
    intents: SpectateIntent[],
    dt: number,
  ): void {
    // La mira entra y sale suave, en ~0,3 s: un salto de zoom marea.
    const me = localPredicted ? this.predictor?.state : null;
    const scoped = me ? me.slots[me.activeSlot] === WEAPON_IDS.indexOf("sniper") : false;
    this.zoom += ((scoped ? SCOPE_ZOOM : 1) - this.zoom) * (1 - Math.exp(-dt * 10));
    if (Math.abs(this.zoom - 1) < 0.001) this.zoom = 1;
    this.world.setZoom(this.zoom);

    if (localPredicted) {
      const cursor = this.world.screenToWorld(this.input.mouseX, this.input.mouseY);
      this.world.setCamera(
        localPredicted.x + (cursor.x - localPredicted.x) * CAMERA_LEAD,
        localPredicted.y + (cursor.y - localPredicted.y) * CAMERA_LEAD,
      );
      this.ui.setSpectating(null);
      this.watched = null;
      this.freeCam = null;
      return;
    }

    // Esperando la segunda oportunidad, sin compañero en pie: la cámara se
    // queda donde caíste. El servidor sólo te manda lo que se ve desde ahí
    // (vas a volver a jugar), así que no hay a quién seguir.
    const mateUp = [...this.mates()].some((id) => this.standings.get(id)?.alive);
    if (this.respawnAt > 0 && this.phase === "playing" && this.lastLocal && !mateUp) {
      this.world.setCamera(this.lastLocal.x, this.lastLocal.y);
      this.watched = null;
      this.freeCam = null;
      this.ui.setSpectating({ title: "Esperando para volver", hint: "", note: this.spectateNote() });
      return;
    }

    // Muerto o mirando. Se sigue a alguien —al principio, a quien te mató— y
    // se puede cambiar de jugador o soltar la cámara. El orden es por id para
    // que "siguiente" no salte al azar cuando cambia quién está a la vista.
    const alive = (frame?.players.filter((p) => p.alive) ?? []).sort((a, b) => a.id - b.id);
    let index = alive.findIndex((p) => p.id === this.spectateId);
    if (index < 0 && alive.length > 0) {
      // El que mirabas murió (o te mató la zona): se pasa al compañero si
      // sigue en pie, y si no al primero que quede.
      const mates = this.mates();
      index = Math.max(0, alive.findIndex((p) => mates.has(p.id)));
      this.spectateId = alive[index]!.id;
    }

    for (const intent of intents) {
      if (intent === "toggle") {
        this.freeCam = this.freeCam ? null : this.world.cameraCenter();
        continue;
      }
      if (this.freeCam) {
        // En cámara libre izquierda y derecha la mueven; un click vuelve a
        // seguir al que estabas mirando.
        if (intent === "next" || intent === "prev") this.freeCam = null;
        continue;
      }
      if (alive.length === 0) continue;
      const step = intent === "right" || intent === "next" ? 1 : -1;
      index = (index + step + alive.length) % alive.length;
      this.spectateId = alive[index]!.id;
    }

    const playing = this.phase === "playing";

    if (this.freeCam && playing) {
      const axes = this.input.moveAxes();
      const len = Math.hypot(axes.x, axes.y);
      if (len > 0) {
        const speed = (axes.fast ? 1100 : 600) * dt;
        this.freeCam.x += (axes.x / len) * speed;
        this.freeCam.y += (axes.y / len) * speed;
        // Que no se vaya al vacío de afuera del mapa.
        const dx = this.freeCam.x - WORLD_CENTER_X;
        const dy = this.freeCam.y - WORLD_CENTER_Y;
        const d = Math.hypot(dx, dy);
        if (d > WORLD_RADIUS) {
          this.freeCam.x = WORLD_CENTER_X + (dx / d) * WORLD_RADIUS;
          this.freeCam.y = WORLD_CENTER_Y + (dy / d) * WORLD_RADIUS;
        }
      }
      this.world.setCamera(this.freeCam.x, this.freeCam.y);
      this.watched = null;
      this.ui.setSpectating({
        title: "Cámara libre",
        hint: "WASD para moverte · Shift más rápido · Espacio o click para volver",
        note: this.spectateNote(),
        bet: this.betChoice(),
      });
      return;
    }

    const target = alive[index] ?? null;
    this.watched = target;
    if (target) {
      this.world.setCamera(target.x, target.y);
      const name = this.roster.get(target.id)?.name ?? "";
      this.ui.setSpectating(
        playing
          ? {
              title: `Mirando a ${name}`,
              hint: document.body.classList.contains("touch")
                ? alive.length > 1
                  ? "Tocá a un costado para cambiar"
                  : ""
                : alive.length > 1
                  ? "Click o ← → para cambiar · Espacio: cámara libre"
                  : "Espacio: cámara libre",
              note: this.spectateNote(),
              bet: this.betChoice(),
            }
          : null,
      );
    } else {
      this.world.setCamera(WORLD_CENTER_X, WORLD_CENTER_Y);
      this.ui.setSpectating(null);
    }
  }

  private updateHud(
    frame: NonNullable<ReturnType<SnapshotBuffer["sample"]>>,
    localPredicted: { x: number; y: number } | null,
  ): void {
    const me = this.lastLocal;
    // Espectando, la vida, el arma y la mochila son las del que estás mirando.
    const shown = this.watched ?? me;
    this.ui.setLoadoutVisible(this.phase !== "playing" || (shown?.alive ?? false));
    // El arma propia sale de la predicción, no del snapshot: así la munición
    // baja con el click, y el cambio de arma y la recarga se ven al toque, no
    // un ping después. Espectando, del que estás mirando.
    const predicted = !this.watched && me?.alive && this.predictor ? this.predictor.state : null;
    const gear = predicted
      ? {
          slots: predicted.slots,
          slotTiers: predicted.slotTier,
          activeSlot: predicted.activeSlot,
          ammo: predicted.slotAmmo[predicted.activeSlot] ?? 0,
          reloading: predicted.reloadCd > 0,
        }
      : shown;
    const held = gear && gear.slots[gear.activeSlot] !== undefined ? gear.slots[gear.activeSlot]! : -1;
    const heldTier = gear?.slotTiers[gear.activeSlot] ?? 0;
    // Las estadísticas ya vienen escaladas por rareza: el cargador de un rifle
    // legendario es más grande, y el HUD tiene que mostrar ese número.
    const weapon = held >= 0 ? weaponStats(held, heldTier) : null;
    const rarity = rarityAt(heldTier);

    this.ui.setHud({
      alive: this.aliveCount,
      kills: this.standings.get(this.localId)?.kills ?? 0,
      ping: this.net && this.net.rtt > 0 ? Math.round(this.net.rtt) : null,
      // Caído no tiene vida: lo que le queda antes de desangrarse va en la barra de abajo.
      hp: shown?.alive && !shown.downed ? shown.hp : 0,
      shield: shown?.alive ? shown.shield : 0,
      stamina: shown?.alive ? shown.stamina : 0,
      ammo: gear?.ammo ?? 0,
      magSize: weapon?.magSize ?? 0,
      reloading: gear?.reloading ?? false,
      weaponName: weapon ? `${weapon.name} · ${rarity.name}` : "Con las manos",
      weaponColor: weapon ? cssColor(rarity.color) : "#e8eef5",
      slots: [0, 1].map((slot) => {
        const index = gear?.slots[slot] ?? -1;
        const tier = gear?.slotTiers[slot] ?? 0;
        return {
          key: String(slot + 1),
          name: index >= 0 ? weaponStats(index, tier).name : "vacía",
          color: index >= 0 ? cssColor(rarityAt(tier).color) : "",
          active: (gear?.activeSlot ?? 0) === slot,
        };
      }),
    });

    this.ui.setConsumables([
      ...CONSUMABLE_IDS.map((id, index) => ({
        key: String(index + 3),
        name: CONSUMABLES[id].name,
        count: shown?.consumables[index] ?? 0,
      })),
      // Las granadas no ocupan ranura: van en la misma columna, con su tecla.
      { key: "G", name: "Granadas", count: shown?.grenades ?? 0 },
      { key: "H", name: "Humo", count: shown?.smokes ?? 0 },
      { key: "J", name: "Molotov", count: shown?.molotovs ?? 0 },
    ]);

    this.updatePickupPrompt(me, localPredicted, frame.players);
    this.updateChannel(me, frame.players);
    this.updateZoneAlert(frame, me, localPredicted);

    if (this.phase === "countdown") {
      this.ui.setZoneBanner("EMPIEZA EN", String(Math.ceil(this.phaseTicksLeft / TICK_RATE)), false);
    } else if (this.phase === "playing") {
      const z = frame.zone;
      const seconds = Math.ceil(z.ticksLeft / TICK_RATE);
      this.ui.setZoneBanner(
        z.shrinking ? "ZONA CERRÁNDOSE" : "CIERRA EN",
        formatTime(seconds),
        z.shrinking || seconds <= 10,
      );
    } else {
      this.ui.setZoneBanner(null, "", false);
    }

    const mates = this.mates();
    const rows = [...this.roster.values()]
      .map((meta) => {
        const p = this.standings.get(meta.id);
        return {
          mate: mates.has(meta.id),
          name: meta.name,
          kills: p?.kills ?? 0,
          alive: p?.alive ?? false,
          colorIndex: meta.colorIndex,
          isLocal: meta.id === this.localId,
          away: meta.away === true,
        };
      })
      .sort((a, b) => Number(b.alive) - Number(a.alive) || b.kills - a.kills);

    this.ui.setScoreboard(this.input.scoreboardOpen, rows);
  }

  /**
   * Busca el objeto más cercano dentro del radio de recogida y lo anuncia.
   * Usa la posición predicha, no la del snapshot: si usara la del servidor, el
   * cartel aparecería con el retraso del ping.
   */
  private updatePickupPrompt(
    me: UnpackedPlayer | null,
    localPredicted: { x: number; y: number } | null,
    players: readonly UnpackedPlayer[],
  ): void {
    if (!me?.alive || me.downed || !localPredicted || this.phase !== "playing") {
      this.ui.setPickup(null);
      return;
    }

    // Lo mismo que el servidor: un compañero caído al lado va antes que todo.
    const mates = this.mates();
    const fallen = players.find(
      (p) =>
        p.alive &&
        p.downed &&
        mates.has(p.id) &&
        Math.hypot(p.x - localPredicted.x, p.y - localPredicted.y) <= REVIVE_RANGE,
    );
    if (fallen) {
      this.ui.setPickup(me.reviving === fallen.id ? null : `Levantar a ${this.everyone.get(fallen.id)?.name ?? ""}`);
      return;
    }

    let closest: GroundItem | null = null;
    let bestDist = PICKUP_RADIUS * PICKUP_RADIUS;
    for (const item of this.items.values()) {
      const dx = item.x - localPredicted.x;
      const dy = item.y - localPredicted.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        closest = item;
      }
    }

    // La misma prioridad que aplica el servidor al procesar la acción, para que
    // el cartel nunca prometa algo distinto de lo que va a pasar al apretar E.
    let crateDist = CRATE_REACH * CRATE_REACH;
    let hasCrate = false;
    for (let i = 0; i < this.crates.length; i++) {
      if (this.openedCrates.has(i)) continue;
      const c = this.crates[i]!;
      const dx = c.x + c.w / 2 - localPredicted.x;
      const dy = c.y + c.h / 2 - localPredicted.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= crateDist) {
        crateDist = d2;
        hasCrate = true;
      }
    }

    if (hasCrate && (!closest || crateDist <= bestDist)) {
      this.ui.setPickup("Abrir caja");
      return;
    }

    this.ui.setPickup(closest ? itemName(closest) : null);
  }

  /**
   * Afuera de la zona: aviso, borde rojo y una flecha para volver. Se mide con
   * tu posición predicha contra la zona tal como se dibuja, así el aviso salta
   * justo cuando ves que cruzás la línea.
   */
  private updateZoneAlert(
    frame: NonNullable<ReturnType<SnapshotBuffer["sample"]>>,
    me: UnpackedPlayer | null,
    localPredicted: { x: number; y: number } | null,
  ): void {
    const z = frame.zone;
    const outside =
      this.phase === "playing" &&
      me?.alive &&
      localPredicted !== null &&
      Math.hypot(localPredicted.x - z.x, localPredicted.y - z.y) > z.radius;

    if (!outside || !me || !localPredicted) {
      this.ui.setZoneAlert(null);
      this.world.setZoneArrow(null);
      this.wasOutside = false;
      return;
    }
    if (!this.wasOutside) this.sound.zoneWarning();
    this.wasOutside = true;

    // El mismo daño que aplica stepZone: pasada la última fase, el de la última.
    const dps = (ZONE_PHASES[z.phase] ?? ZONE_PHASES[ZONE_PHASES.length - 1]!).dps;
    // La zona no mira el chaleco, así que lo que aguantás sale sólo de la vida.
    // Caído, además de la zona corre el desangrado.
    const drain = me.downed ? dps + (DOWNED_HP * TICK_RATE) / DOWNED_BLEED_TICKS : dps;
    this.ui.setZoneAlert({ dps, seconds: Math.floor(me.hp / drain) });
    this.world.setZoneArrow(
      { x: localPredicted.x, y: localPredicted.y, dir: Math.atan2(z.y - localPredicted.y, z.x - localPredicted.x) },
      performance.now(),
    );
  }

  private updateChannel(me: UnpackedPlayer | null, players: readonly UnpackedPlayer[]): void {
    // Caído: o te están levantando, o te desangrás.
    if (me?.alive && me.downed) {
      const helper = players.find((p) => p.reviving === me.id);
      if (helper) this.ui.setChannel(1 - helper.reviveTicks / REVIVE_TICKS, "TE ESTÁN LEVANTANDO");
      else this.ui.setChannel(me.hp / DOWNED_HP, "TE DESANGRÁS");
      return;
    }
    if (me?.alive && me.reviving >= 0) {
      this.ui.setChannel(1 - me.reviveTicks / REVIVE_TICKS, "LEVANTANDO");
      return;
    }
    if (!me?.alive || me.useCd <= 0) {
      this.ui.setChannel(null, "");
      return;
    }
    // El snapshot manda cuál es y cuántos ticks faltan; el total sale de la tabla.
    const def = consumableAt(me.useIndex);
    const total = def?.useTicks ?? me.useCd;
    this.ui.setChannel(1 - me.useCd / total, def ? def.name.toUpperCase() : "USANDO");
  }

  // ------------------------------------------------------------ acciones

  setReady(ready: boolean): void {
    this.net?.send({ t: "ready", ready });
  }

  requestStart(): void {
    this.net?.send({ t: "start" });
  }

  /** Agregar un bot a la sala. El servidor comprueba que seas el host. */
  addBot(): void {
    this.net?.send({ t: "bot" });
  }

  /** Desbloquea un logro y, si es nuevo, lo avisa con el gorro que gana. */
  private achieve(id: string): void {
    const a: Achievement | null = unlock(id);
    if (!a) return;
    this.ui.addNotice(`¡Logro: ${a.name}! Desbloqueaste: ${a.hatName}`);
    this.ui.refreshHats();
    this.sound.streak(3);
  }

  /**
   * Las rachas, como en los shooters: varias kills seguidas ("¡Doble kill!")
   * o muchas sin morir ("¡Imparable!"). La tuya sale en grande y con sonido; la
   * de los demás, en el registro, para que se sepa a quién hay que frenar.
   */
  private countStreak(byId: number, targetId: number, killerName: string | undefined): void {
    this.streaks.delete(targetId);
    if (byId < 0 || byId === targetId) return;
    const now = performance.now();
    const s = this.streaks.get(byId) ?? { recent: [], life: 0 };
    s.recent = s.recent.filter((t) => now - t < STREAK_WINDOW_MS);
    s.recent.push(now);
    s.life++;
    this.streaks.set(byId, s);

    const multi = MULTI_KILLS[Math.min(s.recent.length, MULTI_KILLS.length - 1)] ?? "";
    const life = s.life === 5 ? "¡Imparable!" : s.life === 8 ? "¡Leyenda!" : "";
    const text = multi || life;
    if (!text) return;
    if (byId === this.localId) {
      this.ui.showStreak(text);
      this.sound.streak(Math.max(s.recent.length - 1, s.life >= 5 ? 3 : 0));
    } else {
      this.ui.addNotice(`${killerName ?? "Alguien"}: ${text}`);
    }
  }

  /**
   * Marcar un lugar para el compañero: con F donde apunta el cursor, o tocando
   * el minimapa. Sin compañero no tiene a quién avisarle.
   */
  private markAt(at: { x: number; y: number }): void {
    if (this.phase !== "playing" || this.localId < 0) return;
    if (this.mates().size === 0) {
      this.ui.addNotice("Las marcas son para tu compañero, en dúos");
      return;
    }
    this.net?.send({ t: "mark", x: Math.round(at.x), y: Math.round(at.y) });
  }

  /** Tus compañeros de equipo (en dúos, uno; en todos contra todos, nadie). */
  private mates(): Set<number> {
    const mine = this.standings.get(this.localId)?.team;
    const mates = new Set<number>();
    if (mine === undefined) return mates;
    for (const [id, s] of this.standings) if (id !== this.localId && s.team === mine) mates.add(id);
    return mates;
  }

  /** Las reglas especiales. El servidor comprueba que seas el host. */
  setRules(rules: number): void {
    this.net?.send({ t: "rules", rules });
  }

  /** Segunda oportunidad para el que muere temprano. El servidor comprueba que seas el host. */
  setSecondChance(on: boolean): void {
    this.net?.send({ t: "secondChance", on });
  }

  /** Siempre el mismo mapa (0) o uno nuevo cada partida (1). El servidor comprueba que seas el host. */
  setMapMode(mode: number): void {
    this.net?.send({ t: "mapMode", mode });
  }

  /**
   * Alguien levantó un radar. Si fuiste vos (o tu pareja), se avisa; si fue un
   * rival y estás a tiro, también: saber que te están viendo es la mitad de la
   * gracia, y te da para moverte antes de la próxima pasada.
   */
  private onRadarTaken(byId: number, item: GroundItem): void {
    const mine = byId === this.localId || this.mates().has(byId);
    if (mine) {
      const who = byId === this.localId ? "Radar prendido" : `${this.everyone.get(byId)?.name ?? "Tu pareja"} prendió un radar`;
      this.ui.addNotice(`${who}: 10 s viendo a los rivales cercanos en el minimapa`);
      return;
    }
    const me = this.lastLocal;
    if (me?.alive && Math.hypot(me.x - item.x, me.y - item.y) <= RADAR_RANGE) {
      this.ui.addNotice("¡Un rival prendió un radar cerca! Te ve en su minimapa");
      this.sound.zoneWarning();
    }
  }

  /**
   * La apuesta del espectador: muerto (y sin segunda oportunidad por delante),
   * elegís quién gana entre los que siguen en pie. Una sola vez. Los primeros
   * ocho por kills (con dieciséis en pie, una fila de botones no entra), pero
   * en orden fijo: si se reordenaran con cada kill, el botón se movería justo
   * cuando lo vas a tocar.
   */
  private betChoice(): BetChoice | undefined {
    if (this.phase !== "playing" || this.lastLocal?.alive || this.respawnAt > 0) return undefined;
    if (this.myBet >= 0) return { chosen: this.everyone.get(this.myBet)?.name ?? "?" };
    const alive = [...this.standings]
      .filter(([, s]) => s.alive)
      .sort((a, b) => b[1].kills - a[1].kills || a[0] - b[0])
      .slice(0, 8)
      .sort((a, b) => a[0] - b[0]);
    if (alive.length < 2) return undefined;
    return {
      options: alive.map(([id]) => ({
        id,
        name: this.everyone.get(id)?.name ?? "?",
        color: cssColor(playerColor(this.everyone.get(id)?.colorIndex ?? 0)),
      })),
    };
  }

  /** Apostar por alguien. El servidor comprueba que puedas. */
  bet(id: number): void {
    this.net?.send({ t: "bet", id });
  }

  /** Lo que se lee abajo al espectear: cómo te mataron y, si volvés, en cuánto. */
  private spectateNote(): string {
    if (this.respawnAt === 0) return this.deathNote;
    const seconds = Math.max(1, Math.ceil((this.respawnAt - performance.now()) / 1000));
    return `${this.deathNote} · Segunda oportunidad: volvés en ${seconds} s`;
  }

  /**
   * Cambia de mapa: llega en el lobby, cuando el host eligió uno nuevo cada
   * partida (o al entrar a una sala que ya juega en otro). El escenario y el
   * minimapa se arman de nuevo; todo lo demás recibe el mapa en cada llamada.
   */
  private changeMap(index: number): void {
    this.mapIndex = index;
    this.arena = mapArena(index);
    this.crates = lootCrates(this.arena);
    this.world.destroy();
    this.world = new WorldView(this.app, this.arena);
    this.world.setNight(this.night);
    this.minimap = new Minimap(this.minimapCanvas, this.arena);
  }

  private get minimapCanvas(): HTMLCanvasElement {
    return document.getElementById("minimap") as HTMLCanvasElement;
  }

  /** De día o de noche. El servidor comprueba que seas el host. */
  setNight(on: boolean): void {
    this.net?.send({ t: "night", on });
  }

  /** Dificultad de los bots. El servidor comprueba que seas el host. */
  setBotSkill(skill: number): void {
    this.net?.send({ t: "botSkill", skill });
  }

  /** Elegir pareja para dúos (-1 para no elegir). */
  setPartner(id: number): void {
    this.net?.send({ t: "partner", id });
  }

  /** Todos contra todos (1) o dúos (2). El servidor comprueba que seas el host. */
  setMode(teamSize: number): void {
    this.net?.send({ t: "mode", teamSize });
  }

  /** Echar a alguien del lobby. El servidor comprueba que seas el host. */
  kick(id: number): void {
    this.net?.send({ t: "kick", id });
  }

  destroy(): void {
    this.detachInput?.();
    this.listeners.abort();
    this.disconnect();
    this.app.destroy(true);
  }
}

/**
 * Para la puntería hace falta haber tirado bastante: con dos tiros y uno
 * adentro, cualquiera tendría 50 % y le ganaría al que se pasó la partida
 * peleando. 20 proyectiles son 20 tiros de pistola o tres escopetazos.
 */
const MIN_SHOTS_FOR_ACCURACY = 20;

/**
 * Lo primero que uno quiere saber al morir: quién, con qué y cómo lo dejó.
 * "Le quedaban 12 de vida" es la diferencia entre "me ganó" y "casi lo tengo".
 */
function deathNote(ev: Extract<SimEvent, { t: "kill" }>, killerName: string | undefined): string {
  if (ev.cause === CAUSE_ZONE) return "Te terminó la zona.";
  if (ev.cause === CAUSE_STRIKE) return "Te alcanzó el bombardeo.";
  if (ev.cause === CAUSE_FIRE) return ev.byId === ev.targetId ? "Te quemaste con tu propia molotov." : `Te quemó la molotov de ${killerName ?? "alguien"}.`;
  if (ev.byId === ev.targetId) return "Te mataste solo.";
  const how = ev.cause === CAUSE_EXPLOSION ? "con una explosión" : `con ${weaponArticle(ev.cause)}`;
  const who = killerName ?? "alguien";
  if (ev.killerHp === undefined) return `Te mató ${who} ${how}.`;
  const shield = ev.killerShield ? ` y ${ev.killerShield} de chaleco` : "";
  return `Te mató ${who} ${how}. Le quedaban ${ev.killerHp} de vida${shield}.`;
}

/** "el rifle", "la escopeta": el nombre del arma con su artículo. */
function weaponArticle(index: number): string {
  const name = weaponAt(index).name.toLowerCase();
  return `${/a$/.test(name) ? "la" : "el"} ${name}`;
}

function shotAccuracy(r: UnpackedResult | undefined): number | null {
  return r && r.shotsFired > 0 ? r.shotsHit / r.shotsFired : null;
}

/**
 * Los premios del resultado. Sólo si valen algo: nadie es "el de más daño"
 * con cero, y la puntería pide un mínimo de tiros.
 */
function awardsFor(rows: ResultRow[]): Award[] {
  const best = <T>(list: T[], score: (x: T) => number): T | undefined =>
    list.reduce<T | undefined>((top, x) => (top === undefined || score(x) > score(top) ? x : top), undefined);

  const awards: Award[] = [];
  const damage = best(rows, (r) => r.damage);
  if (damage && damage.damage > 0) {
    awards.push({ label: "MÁS DAÑO", name: damage.name, colorIndex: damage.colorIndex, value: String(Math.round(damage.damage)) });
  }
  const kills = best(rows, (r) => r.kills);
  if (kills && kills.kills > 0) {
    awards.push({ label: "MÁS KILLS", name: kills.name, colorIndex: kills.colorIndex, value: String(kills.kills) });
  }
  const aim = best(
    rows.filter((r) => r.shots >= MIN_SHOTS_FOR_ACCURACY && (r.accuracy ?? 0) > 0),
    (r) => r.accuracy ?? 0,
  );
  if (aim) {
    awards.push({ label: "MEJOR PUNTERÍA", name: aim.name, colorIndex: aim.colorIndex, value: `${Math.round((aim.accuracy ?? 0) * 100)}%` });
  }
  const far = best(rows, (r) => r.longestKill);
  if (far && far.longestKill > 0) {
    awards.push({ label: "TIRO MÁS LARGO", name: far.name, colorIndex: far.colorIndex, value: `${far.longestKill} m` });
  }
  return awards;
}

/** 0x4aa3ff -> "#4aa3ff". La paleta vive en shared como número. */
function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
