import { describe, expect, it } from "vitest";
import { WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_CONSUMABLE, ITEM_GRENADE, ITEM_WEAPON, consumableAt } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
import { emptyInput, type GameState, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** Uno caminando hacia la derecha, con objetos 40 px más adelante. */
function scene(): GameState {
  const state = createGameState(2);
  state.phase = "playing";
  const p = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
  const other = createPlayer(2, WORLD_CENTER_X, WORLD_CENTER_Y + 1200);
  p.alive = true;
  other.alive = true;
  state.players.push(p, other);
  return state;
}

function walk(state: GameState, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    step(state, new Map([[1, [{ ...emptyInput(t + 1), moveX: 1 }]]]), events, EMPTY);
  }
  return events;
}

describe("recoger al pasar", () => {
  it("las vendas y las granadas se juntan solas; el arma no", () => {
    const state = scene();
    const x = WORLD_CENTER_X + 40;
    state.items.push(
      { id: 1, kind: ITEM_CONSUMABLE, ref: 0, tier: 0, x, y: WORLD_CENTER_Y, count: 2 },
      { id: 2, kind: ITEM_GRENADE, ref: 0, tier: 2, x: x + 10, y: WORLD_CENTER_Y, count: 1 },
      { id: 3, kind: ITEM_WEAPON, ref: 2, tier: 0, x: x + 20, y: WORLD_CENTER_Y, count: 1 },
    );
    const events = walk(state, 10);
    const p = state.players[0]!;
    expect(p.consumables[0]).toBe(2);
    expect(p.grenades).toBe(1);
    expect(p.slots[1]).toBe(-1);
    expect(state.items.map((i) => i.id)).toEqual([3]);
    expect(events.filter((e) => e.t === "pickup")).toHaveLength(2);
  });

  it("si no entra entero, se queda en el piso (E lo junta igual)", () => {
    const state = scene();
    const p = state.players[0]!;
    const max = consumableAt(0)!.maxStack;
    p.consumables[0] = max - 1;
    state.items.push({ id: 1, kind: ITEM_CONSUMABLE, ref: 0, tier: 0, x: WORLD_CENTER_X + 40, y: WORLD_CENTER_Y, count: 2 });
    walk(state, 10);
    expect(p.consumables[0]).toBe(max - 1);
    expect(state.items).toHaveLength(1);
  });

  it("de lejos no: hay que pisarlo", () => {
    const state = scene();
    state.items.push({ id: 1, kind: ITEM_CONSUMABLE, ref: 0, tier: 0, x: WORLD_CENTER_X + 40, y: WORLD_CENTER_Y + 60, count: 1 });
    walk(state, 10);
    expect(state.items).toHaveLength(1);
  });
});
