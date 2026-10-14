import { describe, expect, it } from "vitest";
import { FIRE_DPS, FIRE_RADIUS, FIRE_TICKS, PLAYER_MAX_HP, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_GRENADE, itemName } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
import { ACT_MOLOTOV, CAUSE_FIRE, GRENADE_MOLOTOV, emptyInput, type GameState, type PlayerInput, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** El 1 tira; el 2 y el 3 lejos (el 3 para que la partida no termine). */
function scene(): GameState {
  const state = createGameState(5);
  state.phase = "playing";
  const a = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
  const b = createPlayer(2, WORLD_CENTER_X + 900, WORLD_CENTER_Y);
  const c = createPlayer(3, WORLD_CENTER_X, WORLD_CENTER_Y + 1200);
  for (const p of [a, b, c]) p.alive = true;
  state.players.push(a, b, c);
  return state;
}

function run(state: GameState, ticks: number, inputs: Map<number, PlayerInput[]> = new Map(), events: SimEvent[] = []): SimEvent[] {
  for (let t = 0; t < ticks; t++) step(state, t === 0 ? inputs : new Map(), events, EMPTY);
  return events;
}

/** Un charco ya prendido en (x, y), del jugador `owner`. */
function fireAt(state: GameState, x: number, y: number, owner = 1): void {
  state.fires.push({ id: 99, ownerId: owner, x, y, ticksLeft: FIRE_TICKS });
}

describe("molotov", () => {
  it("con J se tira la molotov y al romperse deja fuego, sin explosión", () => {
    const state = scene();
    const p = state.players[0]!;
    p.molotovs = 2;
    p.grenades = 1;
    const events = run(state, 50, new Map([[1, [{ ...emptyInput(1), aim: Math.PI / 2, act: ACT_MOLOTOV }]]]));
    expect(p.molotovs).toBe(1);
    expect(p.grenades).toBe(1);
    expect(events.some((e) => e.t === "throw" && e.kind === GRENADE_MOLOTOV)).toBe(true);
    expect(events.some((e) => e.t === "fire")).toBe(true);
    expect(events.some((e) => e.t === "explosion")).toBe(false);
    expect(state.fires).toHaveLength(1);
  });

  it("quema al que está adentro; al de afuera, no", () => {
    const state = scene();
    const [, inside] = state.players;
    fireAt(state, inside!.x + 20, inside!.y);
    state.players[2]!.x = inside!.x + FIRE_RADIUS + 60;
    state.players[2]!.y = inside!.y;
    run(state, 20);
    expect(inside!.hp).toBeCloseTo(PLAYER_MAX_HP - FIRE_DPS, 0);
    expect(state.players[2]!.hp).toBe(PLAYER_MAX_HP);
  });

  it("al que la tiró también; a su compañero no", () => {
    const state = scene();
    state.teamSize = 2;
    const [owner, mate] = state.players;
    owner!.team = -1;
    mate!.team = -1;
    mate!.x = owner!.x + 30;
    mate!.y = owner!.y;
    fireAt(state, owner!.x, owner!.y);
    run(state, 20);
    expect(owner!.hp).toBeLessThan(PLAYER_MAX_HP);
    expect(mate!.hp).toBe(PLAYER_MAX_HP);
  });

  it("la muerte es del que la tiró, por fuego", () => {
    const state = scene();
    const victim = state.players[1]!;
    victim.hp = 2;
    fireAt(state, victim.x, victim.y);
    const events = run(state, 20);
    const kill = events.find((e) => e.t === "kill");
    if (kill?.t !== "kill") throw new Error("no murió");
    expect(kill.cause).toBe(CAUSE_FIRE);
    expect(kill.byId).toBe(1);
    expect(state.players[0]!.kills).toBe(1);
  });

  it("se apaga solo", () => {
    const state = scene();
    fireAt(state, 100, 100);
    run(state, FIRE_TICKS + 1);
    expect(state.fires).toHaveLength(0);
  });

  it("se junta del piso con su nombre", () => {
    const state = scene();
    const p = state.players[0]!;
    state.items.push({ id: 1, kind: ITEM_GRENADE, ref: GRENADE_MOLOTOV, tier: 2, x: p.x, y: p.y, count: 1 });
    expect(itemName(state.items[0]!)).toBe("Molotov");
    run(state, 1);
    expect(p.molotovs).toBe(1);
  });

  it("los bots salen del fuego", () => {
    const state = scene();
    const bot = state.players[0]!;
    fireAt(state, bot.x - 20, bot.y, 2);
    const input = botInput(state, bot, createBotMemory(1), EMPTY);
    expect(input.moveX).toBe(1);
  });
});
