import { describe, expect, it } from "vitest";
import { GRENADE_MAX_STACK, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_BACKPACK, ITEM_CONSUMABLE, ITEM_GRENADE, consumableAt } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { applyExplosion, carryLimit, createGameState, createPlayer, step } from "./step.js";
import { ACT_PICKUP, emptyInput, type GameState, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

function scene(): GameState {
  const state = createGameState(5);
  state.phase = "playing";
  for (const [id, dx] of [[1, 0], [2, 900], [3, -900]] as const) {
    const p = createPlayer(id, WORLD_CENTER_X + dx, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    state.players.push(p);
  }
  return state;
}

/** Algo a los pies del 1, y el 1 apretando E. */
function pickUp(state: GameState, kind: number, ref: number, count: number, seq = 1): void {
  const p = state.players[0]!;
  state.items.push({ id: state.nextItemId++, kind, ref, tier: 2, x: p.x, y: p.y, count });
  step(state, new Map([[1, [{ ...emptyInput(seq), act: ACT_PICKUP }]]]), [], EMPTY);
}

describe("la mochila", () => {
  it("con mochila se carga la mitad más de granadas y de vendas", () => {
    const state = scene();
    const p = state.players[0]!;
    const bandages = consumableAt(0)!.maxStack;
    expect(carryLimit(p, ITEM_GRENADE, 0)).toBe(GRENADE_MAX_STACK);
    pickUp(state, ITEM_BACKPACK, 0, 1);
    expect(p.backpack).toBe(true);
    expect(carryLimit(p, ITEM_GRENADE, 0)).toBe(Math.ceil(GRENADE_MAX_STACK * 1.5));
    expect(carryLimit(p, ITEM_CONSUMABLE, 0)).toBe(Math.ceil(bandages * 1.5));

    p.grenades = GRENADE_MAX_STACK;
    pickUp(state, ITEM_GRENADE, 0, 1, 2);
    expect(p.grenades).toBe(GRENADE_MAX_STACK + 1);
  });

  it("sin mochila, lo que no entra queda en el piso", () => {
    const state = scene();
    const p = state.players[0]!;
    p.grenades = GRENADE_MAX_STACK;
    pickUp(state, ITEM_GRENADE, 0, 1);
    expect(p.grenades).toBe(GRENADE_MAX_STACK);
    expect(state.items.some((i) => i.kind === ITEM_GRENADE)).toBe(true);
  });

  it("una alcanza: la segunda queda en el piso", () => {
    const state = scene();
    pickUp(state, ITEM_BACKPACK, 0, 1);
    pickUp(state, ITEM_BACKPACK, 0, 1, 2);
    expect(state.items.filter((i) => i.kind === ITEM_BACKPACK)).toHaveLength(1);
  });

  it("al pasar, junta lo que con mochila entra", () => {
    const state = scene();
    const p = state.players[0]!;
    pickUp(state, ITEM_BACKPACK, 0, 1);
    p.grenades = GRENADE_MAX_STACK;
    state.items.push({ id: 99, kind: ITEM_GRENADE, ref: 0, tier: 2, x: p.x + 40, y: p.y, count: 1 });
    for (let t = 2; t < 12; t++) step(state, new Map([[1, [{ ...emptyInput(t), moveX: 1 }]]]), [], EMPTY);
    expect(p.grenades).toBe(GRENADE_MAX_STACK + 1);
  });

  it("al morir se suelta, como todo", () => {
    const state = scene();
    const p = state.players[0]!;
    pickUp(state, ITEM_BACKPACK, 0, 1);
    p.hp = 1;
    const events: SimEvent[] = [];
    applyExplosion(state, p.x, p.y, 2, EMPTY, events);
    expect(p.alive).toBe(false);
    expect(p.backpack).toBe(false);
    expect(state.items.some((i) => i.kind === ITEM_BACKPACK)).toBe(true);
  });
});
