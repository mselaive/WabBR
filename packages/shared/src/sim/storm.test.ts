import { describe, expect, it } from "vitest";
import { WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
import type { SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** Cuántos relámpagos caen en `ticks` ticks, de noche o de día. */
function lightnings(night: boolean, ticks: number): number[] {
  const state = createGameState(1);
  state.phase = "playing";
  state.night = night;
  for (const id of [1, 2]) {
    const p = createPlayer(id, WORLD_CENTER_X + id * 300, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    state.players.push(p);
  }
  const at: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const events: SimEvent[] = [];
    step(state, new Map(), events, EMPTY);
    if (events.some((e) => e.t === "lightning")) at.push(state.tick);
  }
  return at;
}

describe("la tormenta", () => {
  it("de noche cae un relámpago cada tanto (unos cada 20 s), de día ninguno", () => {
    const night = lightnings(true, 20 * 60 * 3);
    // En tres minutos, alrededor de nueve: ni una lluvia de flashes ni ninguno.
    expect(night.length).toBeGreaterThan(3);
    expect(night.length).toBeLessThan(20);
    expect(lightnings(false, 20 * 60 * 3)).toHaveLength(0);
  });
});
