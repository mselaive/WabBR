import { describe, expect, it } from "vitest";
import { AIRDROP_FALL_TICKS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_FLARE, ITEM_WEAPON } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
import { ACT_PICKUP, emptyInput, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

describe("la bengala", () => {
  it("al levantarla pide un paquete al lado, que cae con su botín", () => {
    const state = createGameState(2);
    state.phase = "playing";
    for (const [id, dx] of [[1, 0], [2, 900]] as const) {
      const p = createPlayer(id, WORLD_CENTER_X + dx, WORLD_CENTER_Y);
      p.alive = true;
      p.place = 0;
      state.players.push(p);
    }
    const p = state.players[0]!;
    state.items.push({ id: 1, kind: ITEM_FLARE, ref: 0, tier: 4, x: p.x, y: p.y, count: 1 });
    const events: SimEvent[] = [];
    step(state, new Map([[1, [{ ...emptyInput(1), act: ACT_PICKUP }]]]), events, EMPTY);

    const flare = events.find((e) => e.t === "flare");
    expect(flare).toMatchObject({ byId: 1 });
    expect(state.airdrops).toHaveLength(1);
    const drop = state.airdrops[0]!;
    expect(Math.hypot(drop.x - p.x, drop.y - p.y)).toBeLessThan(100);

    const later: SimEvent[] = [];
    for (let t = 2; t <= AIRDROP_FALL_TICKS + 2; t++) step(state, new Map(), later, EMPTY);
    expect(later.some((e) => e.t === "airdrop")).toBe(true);
    expect(state.items.some((i) => i.kind === ITEM_WEAPON && i.tier >= 3)).toBe(true);
  });
});
