import { describe, expect, it } from "vitest";
import { GRENADE_FUSE_TICKS, MINE_ARM_TICKS, MINE_TICKS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_ARMOR, ITEM_GRENADE } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { canThrow, carryLimit, createGameState, createPlayer, step } from "./step.js";
import { ACT_MINE, GRENADE_MINE, emptyInput, type GameState, type PlayerInput, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** El 1 con dos minas; el 2 rival lejos; el 3 compañero del 1. */
function scene(): GameState {
  const state = createGameState(4);
  state.phase = "playing";
  for (const [id, dx, team] of [[1, 0, 1], [2, 1000, 2], [3, -600, 1]] as const) {
    const p = createPlayer(id, WORLD_CENTER_X + dx, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    p.team = team;
    state.players.push(p);
  }
  state.players[0]!.mines = 2;
  return state;
}

function run(state: GameState, ticks: number, input: (t: number) => Map<number, PlayerInput[]> = () => new Map()): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 1; t <= ticks; t++) step(state, input(t), events, EMPTY);
  return events;
}

/** Tira una mina y espera a que se frene. */
function plant(state: GameState): SimEvent[] {
  const events = run(state, 1, (t) => new Map([[1, [{ ...emptyInput(t), aim: 0, act: ACT_MINE }]]]));
  events.push(...run(state, GRENADE_FUSE_TICKS + 2));
  return events;
}

describe("las minas", () => {
  it("se tira como una granada y donde se frena queda en el piso", () => {
    const state = scene();
    const events = plant(state);
    expect(state.players[0]!.mines).toBe(1);
    expect(state.grenades).toHaveLength(0);
    expect(state.mines).toHaveLength(1);
    expect(events.some((e) => e.t === "mine" && e.byId === 1)).toBe(true);
    // No explota sola.
    expect(events.some((e) => e.t === "explosion")).toBe(false);
  });

  it("armada, explota cuando pasa un rival, a cuenta del que la puso", () => {
    const state = scene();
    plant(state);
    const mine = state.mines[0]!;
    run(state, MINE_ARM_TICKS);
    const rival = state.players[1]!;
    rival.x = mine.x + 15;
    rival.y = mine.y;
    const events = run(state, 1);
    expect(events.some((e) => e.t === "explosion")).toBe(true);
    expect(rival.hp).toBeLessThan(50);
    expect(state.mines).toHaveLength(0);
    expect(events.find((e) => e.t === "hit" && e.targetId === 2)).toMatchObject({ byId: 1 });
  });

  it("recién puesta no está armada, y a los del equipo no les explota", () => {
    const state = scene();
    const events = run(state, 1, (t) => new Map([[1, [{ ...emptyInput(t), aim: 0, act: ACT_MINE }]]]));
    // Se frena y, enseguida, pasa el rival: todavía no se armó.
    events.push(...run(state, GRENADE_FUSE_TICKS + 1));
    const mine = state.mines[0]!;
    const rival = state.players[1]!;
    rival.x = mine.x;
    rival.y = mine.y;
    events.push(...run(state, 1));
    expect(state.mines).toHaveLength(1);
    rival.x += 1000;

    run(state, MINE_ARM_TICKS);
    const mate = state.players[2]!;
    mate.x = mine.x;
    mate.y = mine.y;
    run(state, 5);
    expect(state.mines).toHaveLength(1);
    expect(mate.hp).toBe(100);
  });

  it("al rato se apaga sola", () => {
    const state = scene();
    plant(state);
    run(state, MINE_TICKS);
    expect(state.mines).toHaveLength(0);
  });

  it("se llevan dos (tres con mochila), y sin minas no se tira", () => {
    const state = scene();
    const p = state.players[0]!;
    expect(carryLimit(p, ITEM_GRENADE, GRENADE_MINE)).toBe(2);
    p.backpack = true;
    expect(carryLimit(p, ITEM_GRENADE, GRENADE_MINE)).toBe(3);
    p.mines = 0;
    expect(canThrow(p, GRENADE_MINE)).toBe(false);
  });
});

describe("los bots y las minas", () => {
  it("un bot que va derecho hacia una mina rival que ve, la esquiva", () => {
    const state = scene();
    const bot = state.players[1]!;
    // Un chaleco pesado que el bot quiere, con la mina del 1 justo en el medio.
    state.items.push({ id: 50, kind: ITEM_ARMOR, ref: 1, tier: 3, x: bot.x - 130, y: bot.y, count: 1 });
    state.mines.push({ id: 99, ownerId: 1, team: 1, x: bot.x - 65, y: bot.y, armedAt: 0, ticksLeft: 1000 });
    state.players[0]!.x = bot.x - 1300;
    state.players[2]!.alive = false;
    const memory = createBotMemory(4);
    for (let t = 1; t <= 60 && state.mines.length > 0; t++) {
      step(state, new Map([[2, [botInput(state, bot, memory, EMPTY)]]]), [], EMPTY);
    }
    expect(state.mines).toHaveLength(1);
    expect(bot.hp).toBe(100);
    // Y el chaleco lo agarró igual, por el costado.
    expect(bot.shield).toBeGreaterThan(0);
  });
});
