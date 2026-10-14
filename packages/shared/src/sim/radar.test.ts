import { describe, expect, it } from "vitest";
import { RADAR_PING_EVERY, RADAR_RANGE, RADAR_TICKS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_RADAR } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
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

/**
 * El 1 con un radar a los pies; el 2, rival a 600 px; el 3, rival a 1600 px
 * (fuera de alcance); el 4, compañero del 1.
 */
function scene(): GameState {
  const state = createGameState(4);
  state.phase = "playing";
  const at = (id: number, dx: number, team = id) => {
    const p = createPlayer(id, WORLD_CENTER_X + dx, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    p.team = team;
    state.players.push(p);
  };
  at(1, -700);
  at(2, -100);
  at(3, 900, 3);
  at(4, -650, 1);
  state.items.push({ id: 1, kind: ITEM_RADAR, ref: 0, tier: 3, x: WORLD_CENTER_X - 700, y: WORLD_CENTER_Y, count: 1 });
  return state;
}

function run(state: GameState, ticks: number, pickupFirst = true): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 1; t <= ticks; t++) {
    const act = pickupFirst && t === 1 ? ACT_PICKUP : 0;
    step(state, new Map([[1, [{ ...emptyInput(t), act }]]]), events, EMPTY);
  }
  return events;
}

const radars = (events: SimEvent[]) => events.filter((e) => e.t === "radar");

describe("el radar", () => {
  it("se prende al levantarlo y marca en seguida a los rivales a tiro, no a los compañeros ni a los lejanos", () => {
    const state = scene();
    const events = run(state, 1);
    expect(events.some((e) => e.t === "pickup" && e.byId === 1)).toBe(true);
    const first = radars(events)[0]!;
    expect(first).toMatchObject({ byId: 1, team: 1 });
    expect(first.pings).toEqual([[WORLD_CENTER_X - 100, WORLD_CENTER_Y]]);
    expect(1600).toBeGreaterThan(RADAR_RANGE);
  });

  it("también ve al que está en un arbusto", () => {
    const state = scene();
    state.players[1]!.inBush = true;
    const first = radars(run(state, 1))[0]!;
    expect(first.pings).toHaveLength(1);
  });

  it("pasa cada dos segundos durante diez, y se apaga", () => {
    const state = scene();
    const events = run(state, RADAR_TICKS + 40);
    expect(radars(events)).toHaveLength(RADAR_TICKS / RADAR_PING_EVERY);
    expect(state.players[0]!.radarTicks).toBe(0);
  });

  it("entre pasada y pasada no sigue a nadie: marca dónde estaba", () => {
    const state = scene();
    const events: SimEvent[] = [];
    step(state, new Map([[1, [{ ...emptyInput(1), act: ACT_PICKUP }]]]), events, EMPTY);
    // El rival camina; la marca siguiente sale recién a los RADAR_PING_EVERY ticks.
    for (let t = 2; t <= RADAR_PING_EVERY; t++) {
      step(state, new Map([[2, [{ ...emptyInput(t), moveY: 1 }]]]), events, EMPTY);
    }
    expect(radars(events)).toHaveLength(1);
    step(state, new Map([[2, [{ ...emptyInput(99), moveY: 1 }]]]), events, EMPTY);
    const second = radars(events)[1]!;
    expect(second.pings[0]![1]).toBeGreaterThan(WORLD_CENTER_Y + 100);
  });

  it("con uno andando, el segundo queda en el piso; al morir se apaga", () => {
    const state = scene();
    run(state, 1);
    const p = state.players[0]!;
    state.items.push({ id: 2, kind: ITEM_RADAR, ref: 0, tier: 3, x: p.x, y: p.y, count: 1 });
    const events: SimEvent[] = [];
    step(state, new Map([[1, [{ ...emptyInput(2), act: ACT_PICKUP }]]]), events, EMPTY);
    expect(state.items.some((i) => i.id === 2)).toBe(true);

    p.alive = false;
    step(state, new Map(), events, EMPTY);
    expect(p.radarTicks).toBe(0);
  });
});
