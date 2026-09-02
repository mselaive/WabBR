import { Application } from "pixi.js";
import {
  BTN_RELOAD,
  BTN_SHOOT,
  BTN_SPRINT,
  CONSUMABLES,
  CONSUMABLE_IDS,
  INTERP_DELAY_MS,
  MS_PER_TICK,
  CRATE_REACH,
  PICKUP_RADIUS,
  TICK_RATE,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  consumableAt,
  getArena,
  itemName,
  lootCrates,
  playerColor,
  packAim,
  rarityAt,
  unpackItem,
  weaponStats,
  type ArenaMap,
  type GroundItem,
  type MatchPhase,
  type PlayerMeta,
  type ServerMsg,
  type SimEvent,
  type SnapshotMsg,
  type UnpackedPlayer,
} from "@wabbr/shared";
import { Net } from "./net/connection.js";
import { SnapshotBuffer } from "./net/interpolation.js";
import { Predictor } from "./net/prediction.js";
import { InputController } from "./input.js";
import { WorldView } from "./render/world.js";
import { Minimap } from "./render/minimap.js";
import { causeIconUrl } from "./render/textures.js";
import { UI } from "./ui.js";

/** Cuánto tira la cámara hacia el cursor (0 = centrada en el jugador). */
const CAMERA_LEAD = 0.18;

export class Game {
  private app!: Application;
  private world!: WorldView;
  private minimap!: Minimap;
  private readonly arena: ArenaMap = getArena();
  private readonly input = new InputController();
  private readonly snapshots = new SnapshotBuffer();

  private net: Net | null = null;
  private predictor: Predictor | null = null;

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
  private standings = new Map<number, { kills: number; alive: boolean }>();
  private lastLocal: UnpackedPlayer | null = null;
  /**
   * Loot del piso. No viene en el snapshot: llega entero al empezar la ronda y
   * después se mantiene con los eventos de recogida y de suelta.
   */
  private items = new Map<number, GroundItem>();
  /** Cajas ya abiertas. Igual que el loot: llega al entrar y se mantiene por eventos. */
  private openedCrates = new Set<number>();
  /** Cajas del mapa, en el mismo orden que las numera el servidor. */
  private readonly crates = lootCrates(getArena());
  /** Ya recibimos la posición de spawn autoritativa de esta ronda. */
  private spawned = false;
  private spectateId = -1;
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
      roundPixels: true,
    });

    document.getElementById("stage")!.appendChild(this.app.canvas);

    this.world = new WorldView(this.app, this.arena);
    this.minimap = new Minimap(
      document.getElementById("minimap") as HTMLCanvasElement,
      this.arena,
    );

    this.detachInput = this.input.attach(this.app.canvas);
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
        enFrame: () => {
          const frame = this.snapshots.sample(performance.now() - INTERP_DELAY_MS);
          const mine = frame?.players.find((p) => p.id === this.localId);
          return mine ? { alive: mine.alive, x: Math.round(mine.x), y: Math.round(mine.y) } : null;
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
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => {
        if (this.localId === -1) return;
        this.ui.showScreen("menu");
        this.ui.showError("Se cortó la conexión con la sala.");
        this.reset();
      },
      onError: () => {
        this.ui.showScreen("menu");
        this.ui.showError("No se pudo conectar. ¿El servidor está andando?");
      },
    });
  }

  disconnect(): void {
    this.net?.close();
    this.net = null;
    this.reset();
  }

  private reset(): void {
    this.localId = -1;
    this.hostId = -1;
    // Sin esto, reconectar durante una partida en curso no dispara el cambio de
    // fase y el jugador se queda mirando el lobby con el juego corriendo detrás.
    this.phase = "lobby";
    this.predictor = null;
    this.snapshots.clear();
    this.roster.clear();
    this.world.reset();
    this.input.enabled = false;
    this.input.releaseAll();
    this.spectateId = -1;
    this.spawned = false;
    this.lastLocal = null;
    this.items.clear();
    this.standings.clear();
    this.openedCrates.clear();
    this.world.resetCrates();
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.localId = msg.you;
        this.hostId = msg.hostId;
        this.setRoster(msg.roster);
        this.ui.setRoom(msg.room);
        this.ui.resetReady();
        this.ui.showScreen("lobby");
        return;

      case "roster":
        this.hostId = msg.hostId;
        this.setRoster(msg.roster);
        return;

      case "start":
        // Arranca la ronda: el predictor se re-sincroniza con el primer snapshot.
        this.predictor = new Predictor(this.localId);
        this.spawned = false;
        this.seq = 1;
        this.snapshots.clear();
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
        for (const id of this.openedCrates) this.world.setCrateOpen(id);
        return;

      case "s":
        this.onSnapshot(msg);
        return;

      case "err":
        this.ui.showScreen("menu");
        this.ui.showError(msg.message);
        this.reset();
        return;
    }
  }

  private setRoster(roster: PlayerMeta[]): void {
    this.roster = new Map(roster.map((p) => [p.id, p]));
    this.ui.setRoster(roster, this.hostId, this.localId);
  }

  // ------------------------------------------------------------ snapshots

  private onSnapshot(msg: SnapshotMsg): void {
    this.snapshots.push(msg, performance.now());
    this.aliveCount = msg.alive;
    this.standings = new Map(msg.st.map((r) => [r[0], { kills: r[1], alive: r[2] === 1 }]));

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
      this.predictor = null;
      this.spawned = false;
      this.spectateId = -1;
    }
  }

  private showResult(msg: SnapshotMsg): void {
    const rows = [...this.roster.values()]
      .map((meta) => {
        const row = msg.st.find((r) => r[0] === meta.id);
        return { name: meta.name, kills: row?.[1] ?? 0, colorIndex: meta.colorIndex };
      })
      .sort((a, b) => b.kills - a.kills);

    const winner = msg.winner >= 0 ? this.roster.get(msg.winner) : undefined;
    const title = msg.winner === this.localId ? "¡Ganaste!" : "Fin de la partida";
    const subtitle = winner
      ? `${winner.name} quedó último en pie.`
      : "Nadie sobrevivió a la zona.";
    this.ui.showResult(title, subtitle, rows);
  }

  private handleEvents(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.t) {
        case "shot": {
          this.world.spawnMuzzleFlash(ev.x, ev.y, ev.aim);
          // Retroceso propio, proporcional al arma: el francotirador patea, el
          // subfusil apenas cosquillea.
          if (ev.byId === this.localId) {
            const me = this.lastLocal;
            const held = me ? (me.slots[me.activeSlot] ?? -1) : -1;
            if (held >= 0) {
              this.world.addShake(weaponStats(held, me!.slotTiers[me!.activeSlot] ?? 0).damage * 0.055);
            }
          }
          break;
        }
        case "impact":
          this.world.spawnImpact(ev.x, ev.y);
          break;
        case "explosion": {
          this.world.spawnExplosion(ev.x, ev.y);
          // El sacudón cae con la distancia: una explosión lejos se ve, no se siente.
          const me = this.lastLocal;
          if (me?.alive) {
            const dist = Math.hypot(me.x - ev.x, me.y - ev.y);
            this.world.addShake(Math.max(0, 18 * (1 - dist / 340)));
          }
          break;
        }
        case "hit":
          this.world.spawnBlood(ev.x, ev.y);
          // El número y la marca son sólo de tus propios impactos: con los de
          // todos, la pantalla se llena de información que no es tuya.
          if (ev.byId === this.localId && ev.targetId !== this.localId) {
            this.world.spawnDamageNumber(ev.x, ev.y, ev.amount);
            this.world.showHitMarker();
          }
          if (ev.targetId === this.localId) {
            this.world.addShake(4 + ev.amount * 0.12);
            // La flecha apunta al origen, o sea al revés de por donde venía.
            this.world.addDamageArc(ev.dir + Math.PI);
          }
          break;
        case "pickup":
          this.items.delete(ev.itemId);
          break;
        case "drop":
          this.items.set(ev.item.id, ev.item);
          break;
        case "crate":
          this.openedCrates.add(ev.crateId);
          this.world.setCrateOpen(ev.crateId);
          this.world.spawnImpact(ev.x, ev.y);
          break;
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
          if (ev.targetId === this.localId) this.spectateId = ev.byId;
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
    }

    const frame = this.snapshots.sample(performance.now() - INTERP_DELAY_MS);
    if (!frame) return;

    const localPredicted =
      this.predictor && this.lastLocal?.alive ? this.predictor.renderPosition(dt) : null;

    const aim = this.currentAim();
    this.world.update(
      frame,
      this.roster,
      this.localId,
      localPredicted ? { ...localPredicted, aim } : null,
      dt,
    );

    this.world.updateItems(this.items.values(), performance.now());
    // Muerto o espectando se ve todo, así que no se dibuja ninguna sombra.
    this.world.updateShadows(
      localPredicted ? localPredicted.x : null,
      localPredicted ? localPredicted.y : 0,
    );
    this.updateCamera(frame, localPredicted);
    this.minimap.draw(frame, this.roster, this.localId);
    this.updateHud(frame, localPredicted);

    this.world.setCrosshair(this.input.mouseX, this.input.mouseY, this.phase === "playing");
    this.input.enabled = this.phase === "playing" && (this.lastLocal?.alive ?? false);
  }

  private tickInput(): void {
    if (!this.net || !this.predictor) return;
    if (this.phase !== "playing" || !this.lastLocal?.alive) return;

    const aim = this.currentAim();
    const input = this.input.sample(this.seq++, aim);
    this.predictor.apply(input, this.arena);

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
    });
  }

  /** Ángulo del jugador hacia el cursor, en coordenadas del mundo. */
  private currentAim(): number {
    if (!this.predictor) return 0;
    const target = this.world.screenToWorld(this.input.mouseX, this.input.mouseY);
    return Math.atan2(target.y - this.predictor.state.y, target.x - this.predictor.state.x);
  }

  private updateCamera(
    frame: ReturnType<SnapshotBuffer["sample"]>,
    localPredicted: { x: number; y: number } | null,
  ): void {
    if (localPredicted) {
      const cursor = this.world.screenToWorld(this.input.mouseX, this.input.mouseY);
      this.world.setCamera(
        localPredicted.x + (cursor.x - localPredicted.x) * CAMERA_LEAD,
        localPredicted.y + (cursor.y - localPredicted.y) * CAMERA_LEAD,
      );
      this.ui.setSpectating(null);
      return;
    }

    // Muerto o todavía sin spawnear: seguir a quien te mató, o a cualquiera que siga vivo.
    const alive = frame?.players.filter((p) => p.alive) ?? [];
    const target =
      alive.find((p) => p.id === this.spectateId) ?? alive[0] ?? null;

    if (target) {
      this.world.setCamera(target.x, target.y);
      const name = this.roster.get(target.id)?.name ?? "";
      this.ui.setSpectating(this.phase === "playing" ? `Mirando a ${name}` : null);
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
    const held = me && me.slots[me.activeSlot] !== undefined ? me.slots[me.activeSlot]! : -1;
    const heldTier = me?.slotTiers[me.activeSlot] ?? 0;
    // Las estadísticas ya vienen escaladas por rareza: el cargador de un rifle
    // legendario es más grande, y el HUD tiene que mostrar ese número.
    const weapon = held >= 0 ? weaponStats(held, heldTier) : null;
    const rarity = rarityAt(heldTier);

    this.ui.setHud({
      alive: this.aliveCount,
      kills: this.standings.get(this.localId)?.kills ?? 0,
      hp: me?.alive ? me.hp : 0,
      shield: me?.alive ? me.shield : 0,
      stamina: me?.alive ? me.stamina : 0,
      ammo: me?.ammo ?? 0,
      magSize: weapon?.magSize ?? 0,
      reloading: me?.reloading ?? false,
      weaponName: weapon ? `${weapon.name} · ${rarity.name}` : "Con las manos",
      weaponColor: weapon ? cssColor(rarity.color) : "#e8eef5",
      slots: [0, 1].map((slot) => {
        const index = me?.slots[slot] ?? -1;
        const tier = me?.slotTiers[slot] ?? 0;
        return {
          key: String(slot + 1),
          name: index >= 0 ? weaponStats(index, tier).name : "vacía",
          color: index >= 0 ? cssColor(rarityAt(tier).color) : "",
          active: (me?.activeSlot ?? 0) === slot,
        };
      }),
    });

    this.ui.setConsumables([
      ...CONSUMABLE_IDS.map((id, index) => ({
        key: String(index + 3),
        name: CONSUMABLES[id].name,
        count: me?.consumables[index] ?? 0,
      })),
      // Las granadas no ocupan ranura: van en la misma columna, con su tecla.
      { key: "G", name: "Granadas", count: me?.grenades ?? 0 },
    ]);

    this.updatePickupPrompt(me, localPredicted);
    this.updateChannel(me);

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

    const rows = [...this.roster.values()]
      .map((meta) => {
        const p = this.standings.get(meta.id);
        return {
          name: meta.name,
          kills: p?.kills ?? 0,
          alive: p?.alive ?? false,
          colorIndex: meta.colorIndex,
          isLocal: meta.id === this.localId,
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
  ): void {
    if (!me?.alive || !localPredicted || this.phase !== "playing") {
      this.ui.setPickup(null);
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

  private updateChannel(me: UnpackedPlayer | null): void {
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

  destroy(): void {
    this.detachInput?.();
    this.disconnect();
    this.app.destroy(true);
  }
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
