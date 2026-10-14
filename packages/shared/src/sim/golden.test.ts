import { describe, expect, it } from "vitest";
import { GOLDEN_CRATES } from "../constants.js";
import { ITEM_ARMOR, ITEM_WEAPON, ARMORS } from "../items.js";
import { generateArena, lootCrates } from "../map/arena.js";
import { createGameState, createPlayer, startMatch, step } from "./step.js";
import { ACT_PICKUP, emptyInput, type GameState, type SimEvent } from "./types.js";

const arena = generateArena();
const crates = lootCrates(arena);

function begin(seed: number): GameState {
  const state = createGameState(1);
  state.players.push(createPlayer(1), createPlayer(2), createPlayer(3));
  startMatch(state, seed, arena);
  return state;
}

/** Abre la caja `id` con el jugador 1 parado al lado, y devuelve lo que salió. */
function open(state: GameState, id: number): SimEvent[] {
  const c = crates[id]!;
  const p = state.players[0]!;
  // Sin nada tirado alrededor: si hay un objeto más cerca que la caja, E lo junta a él.
  state.items = [];
  p.x = c.x + c.w / 2 + 40;
  p.y = c.y + c.h / 2;
  const events: SimEvent[] = [];
  step(state, new Map([[1, [{ ...emptyInput(1), act: ACT_PICKUP }]]]), events, arena);
  return events.filter((e) => e.t === "drop");
}

describe("cajas doradas", () => {
  it("cada partida sortea unas pocas, distintas, y cambian de una partida a otra", () => {
    const a = begin(11).goldenCrates;
    const b = begin(12).goldenCrates;
    expect(a).toHaveLength(GOLDEN_CRATES);
    expect(new Set(a).size).toBe(GOLDEN_CRATES);
    expect(a).not.toEqual(b);
  });

  it("una dorada trae arma épica o legendaria y el chaleco pesado", () => {
    for (const seed of [3, 4, 5]) {
      const state = begin(seed);
      const drops = open(state, state.goldenCrates[0]!);
      const weapon = drops.find((e) => e.t === "drop" && e.item.kind === ITEM_WEAPON);
      const vest = drops.find((e) => e.t === "drop" && e.item.kind === ITEM_ARMOR);
      if (weapon?.t !== "drop" || vest?.t !== "drop") throw new Error("faltó algo");
      expect(weapon.item.tier).toBeGreaterThanOrEqual(3);
      expect(vest.item.ref).toBe(ARMORS.length - 1);
    }
  });

  it("una común no siempre (control): de diez, alguna trae menos que épico", () => {
    const tiers: number[] = [];
    for (let seed = 20; seed < 30; seed++) {
      const state = begin(seed);
      const normal = crates.findIndex((_, i) => !state.goldenCrates.includes(i));
      for (const e of open(state, normal)) if (e.t === "drop" && e.item.kind === ITEM_WEAPON) tiers.push(e.item.tier);
    }
    expect(tiers.some((t) => t < 3)).toBe(true);
  });
});
