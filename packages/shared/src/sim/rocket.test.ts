import { describe, expect, it } from "vitest";
import { PLAYER_MAX_HP, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_WEAPON, WEAPON_IDS, clampTier, weaponStats } from "../items.js";
import { rollCrateContents } from "../map/loot.js";
import type { ArenaMap, ObstacleKind } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
import { emptyInput, type GameState, type SimEvent } from "./types.js";

const ROCKET = WEAPON_IDS.indexOf("rocket");

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

function arenaWith(kind: ObstacleKind, x: number, y: number, w: number, h: number): ArenaMap {
  const obstacles = [{ kind, x, y, w, h, variant: 0 }];
  return { ...EMPTY, obstacles, grid: new ObstacleGrid(obstacles) };
}

/** El 1 con el lanzacohetes en la mano, el 2 a `dist` px a la derecha, y un tercero lejos. */
function duel(dist: number): GameState {
  const state = createGameState(4);
  state.phase = "playing";
  const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
  const target = createPlayer(2, WORLD_CENTER_X + dist, WORLD_CENTER_Y);
  const other = createPlayer(3, WORLD_CENTER_X, WORLD_CENTER_Y + 1200);
  for (const p of [shooter, target, other]) p.alive = true;
  shooter.slots = [ROCKET, -1];
  shooter.slotTier = [0, 0];
  shooter.slotAmmo = [1, 0];
  state.players.push(shooter, target, other);
  return state;
}

function fire(state: GameState, arena: ArenaMap, ticks = 40): SimEvent[] {
  const events: SimEvent[] = [];
  step(state, new Map([[1, [{ ...emptyInput(1), aim: 0, shoot: true }]]]), events, arena);
  for (let t = 0; t < ticks; t++) step(state, new Map(), events, arena);
  return events;
}

describe("lanzacohetes", () => {
  it("de lleno deja muy mal al otro, pero no lo mata de un tiro", () => {
    const state = duel(300);
    const events = fire(state, EMPTY);
    const target = state.players[1]!;
    expect(events.filter((e) => e.t === "explosion")).toHaveLength(1);
    expect(target.alive).toBe(true);
    expect(target.hp).toBeLessThan(25);
    // El que tiró, lejos, ni se entera.
    expect(state.players[0]!.hp).toBe(PLAYER_MAX_HP);
  });

  it("la muerte se anota al lanzacohetes", () => {
    const state = duel(300);
    state.players[1]!.hp = 30;
    const events = fire(state, EMPTY);
    const kill = events.find((e) => e.t === "kill");
    if (kill?.t !== "kill") throw new Error("no murió");
    expect(kill.cause).toBe(ROCKET);
    expect(kill.byId).toBe(1);
  });

  it("contra una pared estalla antes de la pared, y el de atrás no recibe nada", () => {
    const state = duel(300);
    const wall = arenaWith("wall", WORLD_CENTER_X + 150, WORLD_CENTER_Y - 100, 30, 200);
    const events = fire(state, wall);
    const blast = events.find((e) => e.t === "explosion");
    if (blast?.t !== "explosion") throw new Error("no estalló");
    expect(blast.x).toBeLessThan(WORLD_CENTER_X + 150);
    expect(state.players[1]!.hp).toBe(PLAYER_MAX_HP);
  });

  it("si no toca nada, estalla al final de su alcance", () => {
    const state = duel(300);
    state.players[1]!.y += 600;
    const events = fire(state, EMPTY);
    const blast = events.find((e) => e.t === "explosion");
    if (blast?.t !== "explosion") throw new Error("no estalló");
    const def = weaponStats(ROCKET, 0);
    const range = (def.bulletSpeed * def.lifeTicks) / 20;
    expect(Math.abs(blast.x - WORLD_CENTER_X - range)).toBeLessThan(def.bulletSpeed / 20 + 30);
  });

  it("tirarlo pegado al otro también te lastima a vos", () => {
    const state = duel(60);
    fire(state, EMPTY);
    expect(state.players[0]!.hp).toBeLessThan(PLAYER_MAX_HP);
  });

  it("los bots no lo disparan contra alguien que tienen encima; de lejos sí", () => {
    const shotsAt = (dist: number): boolean => {
      const state = duel(dist);
      const mem = createBotMemory(2);
      let any = false;
      for (let t = 0; t < 30; t++) any ||= botInput(state, state.players[0]!, mem, EMPTY).shoot;
      return any;
    };
    expect(shotsAt(90)).toBe(false);
    expect(shotsAt(350)).toBe(true);
  });

  it("sólo existe legendario y nunca sale de una caja", () => {
    for (const tier of [0, 1, 2, 3, 4]) expect(clampTier(ROCKET, tier)).toBe(4);
    for (let seed = 1; seed <= 400; seed++) {
      const { items } = rollCrateContents(seed * 7919);
      expect(items.some((i) => i.kind === ITEM_WEAPON && i.ref === ROCKET)).toBe(false);
    }
  });
});
