import { describe, expect, it } from "vitest";
import {
  PLAYER_MAX_HP,
  STRIKE_RADIUS,
  STRIKE_TICKS,
  STRIKE_WARN_TICKS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  ZONE_PHASES,
} from "../constants.js";
import { generateArena, type ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, step } from "./step.js";
import { CAUSE_STRIKE, type GameState, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** Partida en la fase 1, a un tick de la mitad de su espera: el próximo tick anuncia. */
function aboutToStrike(): GameState {
  const state = createGameState(11);
  state.phase = "playing";
  const a = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
  const b = createPlayer(2, WORLD_CENTER_X + 900, WORLD_CENTER_Y);
  // Un tercero, para que la partida siga aunque el bombardeo mate a alguien.
  const c = createPlayer(3, WORLD_CENTER_X - 900, WORLD_CENTER_Y);
  for (const p of [a, b, c]) p.alive = true;
  state.players.push(a, b, c);
  state.zone.phase = 1;
  state.zone.radius = 900;
  state.zone.ticksLeft = Math.floor(ZONE_PHASES[1]!.waitTicks / 2) + 1;
  return state;
}

function run(state: GameState, ticks: number, arena: ArenaMap, events: SimEvent[] = []): SimEvent[] {
  for (let t = 0; t < ticks; t++) step(state, new Map(), events, arena);
  return events;
}

describe("bombardeo", () => {
  it("a mitad de la espera se anuncia uno adentro de la zona", () => {
    const state = aboutToStrike();
    const events = run(state, 1, EMPTY);
    expect(state.strikes).toHaveLength(1);
    expect(events.some((e) => e.t === "strike")).toBe(true);
    const s = state.strikes[0]!;
    expect(Math.hypot(s.x - state.zone.x, s.y - state.zone.y)).toBeLessThanOrEqual(state.zone.radius);
  });

  it("avisa, después caen las bombas, y al final se termina", () => {
    const state = aboutToStrike();
    run(state, 1, EMPTY);
    const s = state.strikes[0]!;
    // El que está en el medio del círculo, a cielo abierto.
    const victim = state.players[0]!;
    victim.x = s.x;
    victim.y = s.y;

    const warning = run(state, STRIKE_WARN_TICKS - 1, EMPTY);
    expect(warning.some((e) => e.t === "explosion")).toBe(false);
    expect(victim.hp).toBe(PLAYER_MAX_HP);

    const bombing = run(state, STRIKE_TICKS + 2, EMPTY);
    expect(bombing.filter((e) => e.t === "explosion").length).toBeGreaterThan(5);
    expect(victim.alive && victim.hp === PLAYER_MAX_HP).toBe(false);
    expect(state.strikes).toHaveLength(0);
  });

  it("la muerte es del bombardeo, no de un jugador", () => {
    const state = aboutToStrike();
    run(state, 1, EMPTY);
    const s = state.strikes[0]!;
    const victim = state.players[0]!;
    victim.x = s.x;
    victim.y = s.y;
    victim.hp = 1;
    const events = run(state, STRIKE_WARN_TICKS + STRIKE_TICKS, EMPTY);
    const kill = events.find((e) => e.t === "kill");
    if (kill?.t !== "kill") throw new Error("no murió");
    expect(kill.cause).toBe(CAUSE_STRIKE);
    expect(kill.byId).toBe(-1);
    expect(state.players.every((p) => p.kills === 0)).toBe(true);
  });

  it("ninguna bomba cae bajo techo", () => {
    const arena = generateArena();
    const state = aboutToStrike();
    // Lejos del borde, para que no termine la partida por la zona.
    state.zone.radius = 2000;
    run(state, 1, arena);
    // Encima de la primera casa, para que haya techo de sobra en el círculo.
    const b = arena.buildings[0]!;
    state.strikes[0]!.x = b.x + b.w / 2;
    state.strikes[0]!.y = b.y + b.h / 2;
    const events = run(state, STRIKE_WARN_TICKS + STRIKE_TICKS, arena);
    const blasts = events.filter((e) => e.t === "explosion");
    expect(blasts.length).toBeGreaterThan(0);
    for (const e of blasts) {
      if (e.t !== "explosion") continue;
      const inside = arena.buildings.some((h) => e.x >= h.x && e.x <= h.x + h.w && e.y >= h.y && e.y <= h.y + h.h);
      expect(inside).toBe(false);
    }
  });

  it("los bots se van del círculo", () => {
    const state = aboutToStrike();
    run(state, 1, EMPTY);
    const s = state.strikes[0]!;
    const bot = state.players[0]!;
    bot.x = s.x + 50;
    bot.y = s.y;
    // El otro, lejos y sin línea de vista posible: lo único que lo mueve es el bombardeo.
    state.players[1]!.x = s.x - 1500;
    const input = botInput(state, bot, createBotMemory(1), EMPTY);
    expect(input.moveX).toBe(1);

    // Control: lejos del círculo no huye hacia afuera de él.
    bot.x = s.x + STRIKE_RADIUS + 300;
    state.strikes = [];
    const calm = botInput(state, bot, createBotMemory(1), EMPTY);
    expect(calm.sprint && calm.moveX === 1 && calm.moveY === 0).toBe(false);
  });
});
