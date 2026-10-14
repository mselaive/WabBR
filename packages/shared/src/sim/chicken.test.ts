import { describe, expect, it } from "vitest";
import { CHICKEN_HP, CHICKEN_FEAR_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { WEAPON_IDS } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { applyExplosion, createGameState, createPlayer, step } from "./step.js";
import { emptyInput, type ChickenState, type GameState, type PlayerInput, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

function match(): GameState {
  const state = createGameState(3);
  state.phase = "playing";
  for (let i = 0; i < 3; i++) {
    const p = createPlayer(i + 1, WORLD_CENTER_X - 300 + i * 300, WORLD_CENTER_Y - 400);
    p.alive = true;
    p.place = 0;
    state.players.push(p);
  }
  return state;
}

/** Una gallina quieta, picoteando, en (x, y). */
function chickenAt(state: GameState, x: number, y: number): ChickenState {
  state.chickenSpawned = true;
  state.chicken = {
    x,
    y,
    vx: 0,
    vy: 0,
    hp: CHICKEN_HP,
    panic: 0,
    turnIn: 10_000,
    rng: 1,
    trail: new Array<number>(40).fill(0).map((_, i) => (i % 2 === 0 ? x : y)),
  };
  return state.chicken;
}

function run(state: GameState, ticks: number, input?: (seq: number) => Map<number, PlayerInput[]>): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 1; t <= ticks; t++) step(state, input ? input(t) : new Map(), events, EMPTY);
  return events;
}

describe("la gallina dorada", () => {
  it("aparece una vez, cuando la zona empieza a cerrarse, adentro de la zona y lejos de todos", () => {
    const state = match();
    state.zone.ticksLeft = 2;
    run(state, 1);
    expect(state.chicken).toBeNull();
    run(state, 2);
    const c = state.chicken!;
    expect(c).not.toBeNull();
    expect(Math.hypot(c.x - state.zone.targetX, c.y - state.zone.targetY)).toBeLessThan(state.zone.targetRadius);
    for (const p of state.players) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(CHICKEN_FEAR_RADIUS);

    // Cazada, no vuelve.
    state.chicken = null;
    run(state, 5);
    expect(state.chicken).toBeNull();
  });

  it("al primer tiro de lejos, sale corriendo para el otro lado", () => {
    const state = match();
    const c = chickenAt(state, WORLD_CENTER_X, WORLD_CENTER_Y);
    state.players[0]!.x = c.x + CHICKEN_FEAR_RADIUS + 20;
    state.players[0]!.y = c.y;
    run(state, 30, (seq) => new Map([[1, [{ ...emptyInput(seq), aim: Math.PI, shoot: true }]]]));
    expect(c.x).toBeLessThan(WORLD_CENTER_X - 100);
  });

  it("se escapa del que se acerca, más rápido que caminando", () => {
    const state = match();
    const c = chickenAt(state, WORLD_CENTER_X, WORLD_CENTER_Y);
    const p = state.players[0]!;
    p.x = c.x - 150;
    p.y = c.y;
    run(state, 20);
    expect(c.x).toBeGreaterThan(WORLD_CENTER_X + 150);
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(300);
  });

  it("a los tiros se la caza, y suelta botín de caja dorada", () => {
    const state = match();
    const c = chickenAt(state, WORLD_CENTER_X, WORLD_CENTER_Y);
    const hunter = state.players[0]!;
    // Lejos para que no se asuste, apuntándole: al primer tiro sale corriendo
    // para el otro lado, derecho por la línea de tiro.
    hunter.x = c.x - CHICKEN_FEAR_RADIUS - 20;
    hunter.y = c.y;
    // Con el francotirador: la pistola se abre y de lejos erra (la gallina es chica).
    hunter.slots = [WEAPON_IDS.indexOf("sniper"), -1];
    hunter.slotAmmo = [5, 0];
    const events = run(state, 60, (seq) => new Map([[1, [{ ...emptyInput(seq), aim: 0, shoot: true }]]]));

    expect(events.some((e) => e.t === "cluck" && e.byId === 1)).toBe(true);
    const caught = events.find((e) => e.t === "chicken");
    expect(caught).toMatchObject({ byId: 1 });
    expect(state.chicken).toBeNull();
    const loot = state.items.filter((i) => Math.hypot(i.x - caught!.x, i.y - caught!.y) < 40);
    expect(loot.length).toBe(3);
    // Un arma épica o legendaria, como la de la caja dorada.
    expect(loot.some((i) => i.kind === 0 && i.tier >= 3)).toBe(true);
  });

  it("una explosión también le pega", () => {
    const state = match();
    const c = chickenAt(state, WORLD_CENTER_X, WORLD_CENTER_Y);
    const events: SimEvent[] = [];
    applyExplosion(state, c.x + 30, c.y, 1, EMPTY, events);
    expect(events.some((e) => e.t === "cluck")).toBe(true);
    expect(state.chicken === null || state.chicken.hp < CHICKEN_HP).toBe(true);
  });

  it("si queda afuera de la zona, vuelve para adentro", () => {
    const state = match();
    state.zone.radius = 500;
    const c = chickenAt(state, WORLD_CENTER_X + 600, WORLD_CENTER_Y);
    run(state, 20);
    expect(Math.hypot(c.x - WORLD_CENTER_X, c.y - WORLD_CENTER_Y)).toBeLessThan(500);
  });

  it("un bot sin nadie a la vista le tira", () => {
    const state = match();
    const bot = state.players[0]!;
    const c = chickenAt(state, bot.x + 300, bot.y);
    // Los otros dos, lejos y detrás de nada: no los ve, pero tampoco están cerca.
    state.players[1]!.x = bot.x - 1400;
    state.players[2]!.alive = false;
    const input = botInput(state, bot, createBotMemory(5), EMPTY);
    expect(input.shoot).toBe(true);
    expect(Math.abs(input.aim - Math.atan2(c.y - bot.y, c.x - bot.x))).toBeLessThan(0.2);
  });

  it("un bot con el lanzacohetes no le tira de cerca: se volaría con ella", () => {
    const state = match();
    const bot = state.players[0]!;
    bot.slots = [WEAPON_IDS.indexOf("rocket"), -1];
    bot.slotTier = [4, 0];
    bot.slotAmmo = [1, 0];
    chickenAt(state, bot.x + 90, bot.y);
    state.players[1]!.x = bot.x - 1400;
    state.players[2]!.alive = false;
    expect(botInput(state, bot, createBotMemory(5), EMPTY).shoot).toBe(false);
  });

  it("un cohete de lleno estalla donde está ahora, no donde la veía el que tiró", () => {
    // Se la veía 80 px más atrás (la bala se prueba contra eso), pero el daño
    // es del presente: estallando donde estaba, apenas la rozaría.
    const state = match();
    const c = chickenAt(state, WORLD_CENTER_X, WORLD_CENTER_Y);
    for (let i = 0; i < c.trail.length; i += 2) c.trail[i] = c.x - 80;
    state.bullets.push({
      id: 1,
      ownerId: 1,
      damage: 0,
      weapon: WEAPON_IDS.indexOf("rocket"),
      x: c.x - 200,
      y: c.y,
      vx: 480,
      vy: 0,
      life: 30,
      rewind: 8,
      team: 1,
    });
    const events = run(state, 7);
    expect(events.some((e) => e.t === "chicken")).toBe(true);
  });
});
