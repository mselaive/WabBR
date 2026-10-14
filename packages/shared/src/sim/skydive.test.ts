import { describe, expect, it } from "vitest";
import { AIR_DIVE_TICKS, AIR_TICKS, DT, GLIDE_SPEED, PLAYER_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { generateArena, type ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory, type BotMemory } from "./bot.js";
import { ObstacleGrid, circleHitsBox } from "./collision.js";
import { applyExplosion, createGameState, createPlayer, startMatch, step } from "./step.js";
import { ACT_PICKUP, emptyInput, type GameState, type PlayerInput, type SimEvent } from "./types.js";

/** Una pared de 600 px de alto justo a la derecha del centro. */
const wall = { kind: "wall" as const, x: WORLD_CENTER_X + 60, y: WORLD_CENTER_Y - 300, w: 40, h: 600, variant: 0 };
const WALLED: ArenaMap = {
  obstacles: [wall],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([wall]),
};

/** Dos jugadores en el aire, con el paracaídas recién abierto. */
function falling(): GameState {
  const state = createGameState(8);
  state.phase = "playing";
  for (const [id, dx] of [[1, 0], [2, -400]] as const) {
    const p = createPlayer(id, WORLD_CENTER_X + dx, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    p.airTicks = AIR_TICKS;
    state.players.push(p);
  }
  return state;
}

const right = (seq: number): PlayerInput => ({ ...emptyInput(seq), moveX: 1 });

describe("el paracaídas", () => {
  it("con la opción, todos arrancan en el aire", () => {
    const state = createGameState(3);
    state.skydive = true;
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, 99, WALLED);
    expect(state.players.every((p) => p.airTicks === AIR_TICKS)).toBe(true);

    const ground = createGameState(3);
    ground.players.push(createPlayer(1), createPlayer(2));
    startMatch(ground, 99, WALLED);
    expect(ground.players.every((p) => p.airTicks === 0)).toBe(true);
  });

  it("planea más rápido que corriendo, por encima de la pared, y cae en un lugar libre", () => {
    const state = falling();
    const p = state.players[0]!;
    for (let t = 1; t <= 10; t++) step(state, new Map([[1, [right(t)]]]), [], WALLED);
    expect(p.x - WORLD_CENTER_X).toBeCloseTo(GLIDE_SPEED * DT * 10, 0);
    // Pasó la pared (que a pie lo frenaría en x = centro + 48).
    for (let t = 11; t <= 20; t++) step(state, new Map([[1, [right(t)]]]), [], WALLED);
    expect(p.x).toBeGreaterThan(wall.x + wall.w);

    // Termina de caer justo encima de la pared: lo corre a un lugar libre.
    p.x = wall.x + wall.w / 2;
    p.y = WORLD_CENTER_Y;
    p.airTicks = 1;
    step(state, new Map([[1, [emptyInput(30)]]]), [], WALLED);
    expect(p.airTicks).toBe(0);
    expect(circleHitsBox(p.x, p.y, PLAYER_RADIUS - 1, wall)).toBe(false);
  });

  it("caer en el medio de un bloque de cajas lo deja afuera, no adentro", () => {
    // Cuatro cajas pegadas: empujar para afuera de una lo mete en la de al lado.
    const cx = WORLD_CENTER_X + 500;
    const cy = WORLD_CENTER_Y;
    const boxes = [
      [cx - 100, cy - 100],
      [cx, cy - 100],
      [cx - 100, cy],
      [cx, cy],
    ].map(([x, y]) => ({ kind: "container" as const, x: x!, y: y!, w: 100, h: 100, variant: 0 }));
    const block: ArenaMap = { ...WALLED, obstacles: boxes, grid: new ObstacleGrid(boxes) };
    const state = falling();
    const p = state.players[0]!;
    p.x = cx + 5;
    p.y = cy + 5;
    p.airTicks = 1;
    step(state, new Map([[1, [emptyInput(1)]]]), [], block);
    expect(boxes.some((b) => circleHitsBox(p.x, p.y, PLAYER_RADIUS - 1, b))).toBe(false);
  });

  it("con E se tira en picada y cae enseguida", () => {
    const state = falling();
    const p = state.players[0]!;
    step(state, new Map([[1, [{ ...emptyInput(1), act: ACT_PICKUP }]]]), [], WALLED);
    expect(p.airTicks).toBe(AIR_DIVE_TICKS - 1);
    for (let t = 2; t <= AIR_DIVE_TICKS; t++) step(state, new Map([[1, [emptyInput(t)]]]), [], WALLED);
    expect(p.airTicks).toBe(0);
  });

  it("allá arriba no le pegan balas, ni explosiones, ni la zona; y no puede disparar", () => {
    const state = falling();
    const [p, shooter] = state.players;
    shooter!.airTicks = 0;
    const events: SimEvent[] = [];
    // El 2 le tira de frente durante un segundo.
    for (let t = 1; t <= 20; t++) {
      step(state, new Map([[2, [{ ...emptyInput(t), aim: 0, shoot: true }]], [1, [{ ...emptyInput(t), shoot: true }]]]), events, WALLED);
    }
    expect(p!.hp).toBe(100);
    expect(events.some((e) => e.t === "shot" && e.byId === 1)).toBe(false);
    applyExplosion(state, p!.x, p!.y, 2, WALLED, events);
    expect(p!.hp).toBe(100);
    state.zone.radius = 10;
    state.zone.x = WORLD_CENTER_X - 1000;
    step(state, new Map(), events, WALLED);
    expect(p!.hp).toBe(100);
  });

  it("sin inputs (se le cortó la conexión) igual termina de caer", () => {
    const state = falling();
    for (let t = 0; t < AIR_TICKS; t++) step(state, new Map(), [], WALLED);
    expect(state.players[0]!.airTicks).toBe(0);
  });

  it("los bots eligen una caja, caen cerca y la partida se juega igual", () => {
    const arena = generateArena();
    const state = createGameState(1);
    state.skydive = true;
    const memories = new Map<number, BotMemory>();
    for (let id = 1; id <= 6; id++) {
      state.players.push(createPlayer(id));
      memories.set(id, createBotMemory(id * 7919));
    }
    startMatch(state, 2024, arena);
    const start = state.players.map((p) => ({ x: p.x, y: p.y }));
    let kills = 0;
    for (let t = 0; t < 20 * 60 * 8 && state.phase === "playing"; t++) {
      const inputs = new Map<number, PlayerInput[]>();
      for (const p of state.players) if (p.alive) inputs.set(p.id, [botInput(state, p, memories.get(p.id)!, arena)]);
      const events: SimEvent[] = [];
      step(state, inputs, events, arena);
      kills += events.filter((e) => e.t === "kill" && e.byId >= 0).length;
      if (t === AIR_TICKS) {
        // Ya en el piso, y lejos de donde aparecieron: planearon hasta su caja.
        expect(state.players.every((p) => p.airTicks === 0)).toBe(true);
        const moved = state.players.filter((p, i) => Math.hypot(p.x - start[i]!.x, p.y - start[i]!.y) > 300);
        expect(moved.length).toBeGreaterThanOrEqual(4);
      }
    }
    expect(state.phase).toBe("ended");
    expect(kills).toBeGreaterThan(0);
  });
});
