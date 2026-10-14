import { describe, expect, it } from "vitest";
import { CAMPFIRE_CALM_TICKS, CAMPFIRE_HEAL_PER_S, CAMPFIRE_RADIUS, PLAYER_MAX_HP } from "../constants.js";
import { generateArena, type ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { botInput, createBotMemory } from "./bot.js";
import { applyExplosion, createGameState, createPlayer, step } from "./step.js";
import type { GameState } from "./types.js";

const arena = generateArena();
/** Para la mecánica, un mapa vacío con una sola fogata: nada que tape ni que rodear. */
const fire = { x: 1500, y: 1500 };
const open: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
  campfires: [fire],
};

/** El 1 al lado de la primera fogata con poca vida; los otros dos lejos. */
function scene(): GameState {
  const state = createGameState(8);
  state.phase = "playing";
  const p = createPlayer(1, fire.x + 30, fire.y);
  p.hp = 40;
  const a = createPlayer(2, fire.x + 2000, fire.y + 2000);
  const b = createPlayer(3, fire.x - 2000, fire.y - 2000);
  for (const q of [p, a, b]) q.alive = true;
  state.players.push(p, a, b);
  state.zone.radius = 5000;
  state.zone.ticksLeft = 100_000;
  return state;
}

const run = (state: GameState, ticks: number): void => {
  for (let t = 0; t < ticks; t++) step(state, new Map(), [], open);
};

describe("fogatas", () => {
  it("hay seis, al aire libre y sin nada encima", () => {
    expect(arena.campfires!.length).toBe(6);
    for (const f of arena.campfires!) {
      expect(arena.buildings.some((b) => f.x > b.x && f.x < b.x + b.w && f.y > b.y && f.y < b.y + b.h)).toBe(false);
      expect(arena.obstacles.some((o) => f.x > o.x - 30 && f.x < o.x + o.w + 30 && f.y > o.y - 30 && f.y < o.y + o.h + 30)).toBe(false);
    }
  });

  it("al lado, tranquilo, se recupera vida de a poco hasta llenarse", () => {
    const state = scene();
    run(state, 20);
    expect(state.players[0]!.hp).toBeCloseTo(40 + CAMPFIRE_HEAL_PER_S, 1);
    run(state, 20 * 60);
    expect(state.players[0]!.hp).toBe(PLAYER_MAX_HP);
  });

  it("si te acaban de pegar, no cura; lejos, tampoco", () => {
    const state = scene();
    const p = state.players[0]!;
    applyExplosion(state, p.x + 120, p.y, 2, open, []);
    const hurt = p.hp;
    run(state, CAMPFIRE_CALM_TICKS - 2);
    expect(p.hp).toBe(hurt);
    run(state, 20);
    expect(p.hp).toBeGreaterThan(hurt);

    const far = scene();
    far.players[0]!.x = fire.x + CAMPFIRE_RADIUS + 40;
    run(far, 40);
    expect(far.players[0]!.hp).toBe(40);
  });

  it("un bot herido y sin curaciones va a la fogata; con vendas, no", () => {
    const state = scene();
    const bot = state.players[0]!;
    bot.x = fire.x + 300;
    bot.y = fire.y;
    const without = botInput(state, bot, createBotMemory(3), open);
    bot.consumables[0] = 2;
    const withMeds = botInput(state, bot, createBotMemory(3), open);
    // Sin curaciones camina hacia la fogata (a la izquierda); con vendas se venda ahí mismo.
    expect(without.moveX).toBe(-1);
    expect(withMeds.act).toBe(4);
  });
});
