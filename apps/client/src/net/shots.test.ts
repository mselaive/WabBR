import { describe, expect, it } from "vitest";
import {
  ACT_SLOT_0,
  ACT_SLOT_1,
  DT,
  InputQueue,
  MS_PER_TICK,
  ObstacleGrid,
  WEAPON_IDS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  createGameState,
  createPlayer,
  emptyInput,
  packAim,
  packPlayer,
  shotPellets,
  step,
  unpackAim,
  unpackPlayer,
  weaponStats,
  type ArenaMap,
  type Pellet,
  type PlayerInput,
  type SimEvent,
  type SnapBullet,
  type SnapshotMsg,
  type UnpackedPlayer,
} from "@wabbr/shared";
import { SnapshotBuffer } from "./interpolation.js";
import { Predictor, type PredictedShot } from "./prediction.js";
import { LocalShots } from "./shots.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

const SHOTGUN = WEAPON_IDS.indexOf("shotgun");

/**
 * Un poco de todo lo que decide si un disparo sale: una ráfaga que vacía el
 * cargador y recarga sola, cambio a la escopeta, recarga a mano, vuelta a la
 * pistola y clicks sueltos. Moviéndose y girando el arma todo el tiempo.
 */
function script(t: number, seq: number): PlayerInput {
  const input: PlayerInput = {
    ...emptyInput(seq),
    // Igual que el juego: el ángulo ya va redondeado como viaja por la red.
    aim: unpackAim(packAim(t * 0.07)),
    moveX: t % 40 < 20 ? 1 : -1,
    moveY: t % 30 < 15 ? 1 : -1,
  };
  if (t >= 12 && t < 90) input.shoot = true;
  if (t === 95) input.act = ACT_SLOT_1;
  if (t >= 100 && t < 140 && t % 7 < 2) input.shoot = true;
  if (t === 145) input.reload = true;
  if (t === 175) input.act = ACT_SLOT_0;
  if (t >= 180 && t < 230 && t % 3 === 0) input.shoot = true;
  return input;
}

interface DuelResult {
  predicted: number;
  serverShots: number;
  matched: number;
  /** La mayor diferencia entre una bala dibujada y la real, en posición o velocidad. */
  maxError: number;
}

/**
 * Cliente y servidor en memoria, con las piezas de verdad: la predicción, la
 * cola de inputs del servidor, `step`, y el snapshot pasando por el codec.
 * `uplink(t)` es cuántos ticks tarda en llegar el input mandado en el tick t.
 */
function duel(uplink: (t: number) => number, ticks = 260): DuelResult {
  const state = createGameState(5);
  state.phase = "playing";
  const me = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
  // Lejos, para que la partida no termine y ninguna bala le llegue.
  const other = createPlayer(2, WORLD_CENTER_X, WORLD_CENTER_Y + 1200);
  me.alive = true;
  other.alive = true;
  me.slots[1] = SHOTGUN;
  me.slotAmmo[1] = weaponStats(SHOTGUN, 0).magSize;
  state.players.push(me, other);

  const queue = new InputQueue();
  const client = new Predictor(1);
  client.reset(me.x, me.y);
  const shots = new LocalShots();
  const predicted = new Map<number, PredictedShot>();
  /** Cada bala del servidor tal como quedó en el tick en que salió. */
  const born = new Map<number, Pellet>();

  const toServer: { at: number; input: PlayerInput }[] = [];
  const toClient: { at: number; me: UnpackedPlayer; events: SimEvent[] }[] = [];
  let sent = 0;
  let received = 0;
  let lastArrival = 0;
  const result: DuelResult = { predicted: 0, serverShots: 0, matched: 0, maxError: 0 };

  for (let t = 0; t < ticks; t++) {
    // --- cliente
    const input = script(t, t + 1);
    const shot = client.apply(input, EMPTY);
    if (shot) {
      shots.fire(shot, t * MS_PER_TICK);
      predicted.set(shot.seq, shot);
      result.predicted++;
    }
    // TCP: llegan atrasados pero nunca desordenados.
    lastArrival = Math.max(lastArrival, t + uplink(t));
    toServer.push({ at: lastArrival, input });

    // --- servidor
    while (sent < toServer.length && toServer[sent]!.at <= t) queue.push(toServer[sent++]!.input);
    const events: SimEvent[] = [];
    const firstNew = state.nextBulletId;
    step(state, new Map([[1, queue.take()], [2, []]]), events, EMPTY);
    for (const b of state.bullets) {
      if (b.id >= firstNew) born.set(b.id, { x: b.x, y: b.y, vx: b.vx, vy: b.vy });
    }
    toClient.push({ at: t + 2, me: unpackPlayer(packPlayer(me, true)), events });

    // --- cliente recibe
    while (received < toClient.length && toClient[received]!.at <= t) {
      const snap = toClient[received++]!;
      client.reconcile(snap.me, EMPTY);
      for (const ev of snap.events) {
        if (ev.t !== "shot" || ev.byId !== 1) continue;
        result.serverShots++;
        if (!shots.confirm(ev.seq, ev.firstBullet, ev.pellets)) continue;
        result.matched++;
        predicted.get(ev.seq)!.pellets.forEach((p, i) => {
          const real = born.get(ev.firstBullet + i)!;
          // La real ya avanzó un tick dentro del mismo step en que salió.
          const dPos = Math.hypot(real.x - (p.x + p.vx * DT), real.y - (p.y + p.vy * DT));
          const dVel = Math.hypot(real.vx - p.vx, real.vy - p.vy);
          result.maxError = Math.max(result.maxError, dPos, dVel);
        });
      }
      shots.settle(snap.me.lastSeq);
    }
  }

  return result;
}

describe("disparos propios", () => {
  it("con 200 ms de ida y vuelta, cada bala del servidor ya estaba dibujada y por el mismo camino", () => {
    const r = duel(() => 2);
    // Que la prueba no pase por no disparar nada.
    expect(r.predicted).toBeGreaterThan(15);
    expect(r.serverShots).toBe(r.predicted);
    expect(r.matched).toBe(r.serverShots);
    // Lo único que las separa es el redondeo de la posición en el snapshot.
    expect(r.maxError).toBeLessThan(0.1);
  });

  it("con jitter también coinciden: el servidor no inventa ni se saltea disparos", () => {
    // Picos de 150 ms cada tanto. Con el servidor repitiendo el último input
    // cuando no llegaba nada, disparaba en inputs que el cliente no había
    // disparado, y la bala dibujada y la real salían separadas.
    let seed = 3;
    const jitter = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return 2 + (seed % 11 === 0 ? 3 : seed % 2);
    };
    const r = duel(jitter);
    expect(r.predicted).toBeGreaterThan(15);
    expect(r.matched).toBe(r.predicted);
    expect(r.serverShots).toBe(r.predicted);
    expect(r.maxError).toBeLessThan(0.1);
  });

  it("un disparo que el servidor no hizo se borra cuando confirma ese input", () => {
    const shots = new LocalShots();
    const pellets = [{ x: WORLD_CENTER_X, y: WORLD_CENTER_Y, vx: 500, vy: 0 }];
    shots.fire({ seq: 5, weapon: 0, tier: 0, pellets }, 0);
    expect(shots.bullets()).toHaveLength(1);

    // Todavía no procesó ese input: puede que dispare.
    shots.settle(4);
    expect(shots.bullets()).toHaveLength(1);

    // Ya lo procesó y no llegó ningún "shot" con ese seq: nunca existió.
    shots.settle(5);
    expect(shots.bullets()).toHaveLength(0);
  });

  it("uno confirmado sigue volando y tapa a su copia del servidor", () => {
    const shots = new LocalShots();
    const pellets = [{ x: WORLD_CENTER_X, y: WORLD_CENTER_Y, vx: 500, vy: 0 }];
    shots.fire({ seq: 5, weapon: 0, tier: 0, pellets }, 0);
    expect(shots.confirm(5, 40, 1)).toBe(true);
    shots.settle(5);

    expect(shots.bullets()).toHaveLength(1);
    expect(shots.covers(40)).toBe(true);
    expect(shots.covers(41)).toBe(false);
  });

  it("tu bala choca contra la pared en el mismo lugar que la del servidor", () => {
    const wall = { kind: "wall" as const, x: WORLD_CENTER_X + 150, y: WORLD_CENTER_Y - 100, w: 30, h: 200, variant: 0 };
    const arena: ArenaMap = { ...EMPTY, obstacles: [wall], grid: new ObstacleGrid([wall]) };

    // Servidor.
    const state = createGameState(5);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const other = createPlayer(2, WORLD_CENTER_X - 600, WORLD_CENTER_Y);
    shooter.alive = true;
    other.alive = true;
    state.players.push(shooter, other);
    const events: SimEvent[] = [];
    step(state, new Map([[1, { ...emptyInput(1), aim: 0.03, shoot: true }]]), events, arena);
    for (let i = 0; i < 10; i++) step(state, new Map(), events, arena);
    const impact = events.find((e) => e.t === "impact");
    if (impact?.t !== "impact") throw new Error("la bala del servidor no chocó");

    // Cliente, a 60 cuadros por segundo.
    const twin = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    twin.aim = 0.03;
    const shots = new LocalShots();
    shots.fire({ seq: 1, weapon: 0, tier: 0, pellets: shotPellets(twin, 0, 1) }, 0);
    let spark: { x: number; y: number } | null = null;
    for (let f = 0; f < 60 && !spark; f++) {
      shots.update((f + 1) * (1000 / 60), arena, [], (x, y) => (spark = { x, y }));
    }

    expect(spark).not.toBeNull();
    expect(Math.hypot(spark!.x - impact.x, spark!.y - impact.y)).toBeLessThan(0.01);
  });
});

describe("balas de los demás", () => {
  const snapshot = (tick: number, bullets: SnapBullet[]): SnapshotMsg => ({
    t: "s",
    tick,
    now: 0,
    phase: "playing",
    left: 0,
    players: [],
    st: [],
    bullets,
    gr: [],
    zone: [WORLD_CENTER_X, WORLD_CENTER_Y, 1500, WORLD_CENTER_X, WORLD_CENTER_Y, 1500, 0, 0, 0],
    alive: 2,
    winner: -1,
  });

  it("aparecen en el caño cuando el que dispara dispara en pantalla, y se van al chocar", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, []), 0);
    // Salió en el tick 2 desde x = 100 y en ese mismo tick avanzó 25 px.
    buffer.push(snapshot(2, [[9, 125, 0, 500, 0]]), 50);
    buffer.push(snapshot(3, [[9, 150, 0, 500, 0]]), 100);
    // En el 4 ya chocó.
    buffer.push(snapshot(4, []), 150);

    // Antes de salir no existe. Antes se dibujaba corrida para atrás, metida
    // dentro del que disparaba.
    expect(buffer.sample(-10)!.bullets).toHaveLength(0);

    // Un tick antes del snapshot que la trajo estaba en el caño.
    const muzzle = buffer.sample(0)!.bullets;
    expect(muzzle).toHaveLength(1);
    expect(muzzle[0]!.x).toBeCloseTo(100, 5);

    expect(buffer.sample(120)!.bullets[0]!.x).toBeCloseTo(160, 5);

    // Se va cuando el dibujo llega al snapshot en que ya no estaba, no antes:
    // antes desaparecía 100 ms antes de llegar a la pared.
    expect(buffer.sample(149)!.bullets).toHaveLength(1);
    expect(buffer.sample(150)!.bullets).toHaveLength(0);
  });
});
