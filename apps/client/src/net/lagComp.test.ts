import { describe, expect, it } from "vitest";
import {
  INTERP_DELAY_MS,
  InputQueue,
  MS_PER_TICK,
  ObstacleGrid,
  PLAYER_RADIUS,
  WEAPON_IDS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  createGameState,
  createPlayer,
  emptyInput,
  packAim,
  packSnapshotArrays,
  step,
  unpackAim,
  weaponStats,
  type ArenaMap,
  type PlayerInput,
  type SimEvent,
  type SnapshotMsg,
} from "@wabbr/shared";
import { SnapshotBuffer } from "./interpolation.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

const SNIPER = WEAPON_IDS.indexOf("sniper");

/**
 * Hacia dónde apuntar para que una bala que sale del caño a `speed` le pegue a
 * algo que está en `p` moviéndose a `v`. Es lo que hace a ojo un buen jugador
 * con lo que ve en pantalla.
 */
function lead(
  sx: number,
  sy: number,
  p: { x: number; y: number },
  v: { x: number; y: number },
  speed: number,
): number {
  const muzzle = PLAYER_RADIUS + 8;
  const dx = p.x - sx;
  const dy = p.y - sy;
  const a = v.x * v.x + v.y * v.y - speed * speed;
  const b = 2 * (dx * v.x + dy * v.y) - 2 * muzzle * speed;
  const c = dx * dx + dy * dy - muzzle * muzzle;
  const disc = Math.sqrt(b * b - 4 * a * c);
  const tau = Math.max((-b + disc) / (2 * a), (-b - disc) / (2 * a));
  return Math.atan2(dy + v.y * tau, dx + v.x * tau);
}

/** Cada cuántos ticks el blanco cambia de sentido. */
const TURN_EVERY = 40;

/**
 * Un francotirador quieto le tira a alguien que corre de costado, apuntando a
 * donde lo ve en SU pantalla: interpolado 100 ms atrás y con el snapshot
 * llegando tarde. Devuelve qué fracción de los disparos el servidor contó como
 * impacto, y cuántos fallaron lejos de un cambio de sentido.
 */
function duel(opts: { uplink: number; downlink: number; compensate: boolean }): {
  rate: number;
  strayMisses: number;
} {
  const state = createGameState(9);
  state.phase = "playing";
  const shooter = createPlayer(1, WORLD_CENTER_X - 160, WORLD_CENTER_Y);
  const target = createPlayer(2, WORLD_CENTER_X + 160, WORLD_CENTER_Y);
  shooter.alive = true;
  target.alive = true;
  shooter.slots[0] = SNIPER;
  shooter.slotAmmo[0] = weaponStats(SNIPER, 0).magSize;
  // Que aguante todo: lo que se mide es cuántas le pegan, no cuándo muere.
  target.hp = 1e9;
  state.players.push(shooter, target);

  const speed = weaponStats(SNIPER, 0).bulletSpeed;
  const queue = new InputQueue();
  const buffer = new SnapshotBuffer();
  const toServer: { at: number; input: PlayerInput }[] = [];
  const toClient: { at: number; msg: SnapshotMsg }[] = [];
  let sent = 0;
  let received = 0;
  let previous: { x: number; y: number } | null = null;
  /** Tick en que salió cada disparo, por id de su bala, y si pegó. */
  const fired = new Map<number, { tick: number; hit: boolean }>();

  for (let t = 0; t < 1400; t++) {
    // --- cliente: dibuja a los demás como el juego y apunta a lo que ve
    while (received < toClient.length && toClient[received]!.at <= t) {
      const { at, msg } = toClient[received++]!;
      buffer.push(msg, at * MS_PER_TICK);
    }
    const frame = buffer.sample(t * MS_PER_TICK - INTERP_DELAY_MS);
    const seen = frame?.players.find((p) => p.id === 2);
    if (frame && seen) {
      const velocity = previous
        ? { x: (seen.x - previous.x) / (MS_PER_TICK / 1000), y: (seen.y - previous.y) / (MS_PER_TICK / 1000) }
        : { x: 0, y: 0 };
      previous = { x: seen.x, y: seen.y };
      const aim = unpackAim(packAim(lead(shooter.x, shooter.y, seen, velocity, speed)));
      // Igual que viaja por la red: en décimas de tick.
      const view = opts.compensate ? Math.round(frame.tick * 10) / 10 : -1;
      toServer.push({
        at: t + opts.uplink,
        input: { ...emptyInput(t + 1), aim, shoot: t > 60, view },
      });
    }

    // --- servidor
    while (sent < toServer.length && toServer[sent]!.at <= t) queue.push(toServer[sent++]!.input);
    // Corre de costado, cambiando de sentido cada dos segundos.
    const strafe: PlayerInput = {
      ...emptyInput(t + 1),
      moveY: Math.floor(t / TURN_EVERY) % 2 === 0 ? 1 : -1,
    };
    const events: SimEvent[] = [];
    step(state, new Map([[1, queue.take()], [2, [strafe]]]), events, EMPTY);
    for (const ev of events) {
      if (ev.t === "shot" && ev.byId === 1) fired.set(ev.firstBullet, { tick: t, hit: false });
      if (ev.t === "hit" && ev.byId === 1) fired.get(ev.bullet)!.hit = true;
    }

    const packed = packSnapshotArrays(state);
    toClient.push({
      at: t + opts.downlink,
      msg: {
        t: "s",
        tick: state.tick,
        now: 0,
        phase: state.phase,
        left: 0,
        players: packed.players,
        st: [],
        bullets: packed.bullets,
        gr: [],
        zone: packed.zone,
        alive: packed.alive,
        winner: -1,
      },
    });
  }

  const shots = [...fired.values()];
  expect(shots.length).toBeGreaterThan(30);

  // Un tiro que sale justo antes de que el otro dé la vuelta falla, y está
  // bien: con la bala en el aire no hay forma de adivinarlo, ni en pantalla.
  // Cuenta como "cerca" desde que el que dispara todavía no lo vio girar
  // (ping + interpolación) hasta que la bala llega (unos 6 ticks de vuelo).
  const nearTurn = (tick: number): boolean => {
    const d = tick % TURN_EVERY;
    return d <= 8 || d >= TURN_EVERY - 4;
  };
  return {
    rate: shots.filter((s) => s.hit).length / shots.length,
    strayMisses: shots.filter((s) => !s.hit && !nearTurn(s.tick)).length,
  };
}

describe("compensación de lag", () => {
  it("con 200 ms de ping, apuntándole a lo que ves le pegás", () => {
    const r = duel({ uplink: 2, downlink: 2, compensate: true });
    // Sólo fallan los que salen justo cuando el otro cambia de sentido.
    expect(r.strayMisses).toBe(0);
    expect(r.rate).toBeGreaterThan(0.75);
  });

  it("sin compensar, el mismo tiro pasa por donde el otro ya no está", () => {
    // Es lo que pasaba antes: el servidor probaba la bala contra donde el
    // blanco estaba de verdad, 300 ms más adelante de lo que veías.
    expect(duel({ uplink: 2, downlink: 2, compensate: false }).rate).toBeLessThan(0.2);
  });

  it("con un ping bajo también funciona, sin rebobinar de más", () => {
    const r = duel({ uplink: 1, downlink: 1, compensate: true });
    expect(r.strayMisses).toBe(0);
    expect(r.rate).toBeGreaterThan(0.75);
  });
});
