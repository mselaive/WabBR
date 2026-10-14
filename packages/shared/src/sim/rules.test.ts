import { describe, expect, it } from "vitest";
import { RULES_BLITZ, RULES_CHAOS, RULES_LEGENDARY, RULES_SNIPERS, ZONE_PHASES } from "../constants.js";
import { ITEM_WEAPON, WEAPON_IDS, weaponAt } from "../items.js";
import { generateArena, lootCrates } from "../map/arena.js";
import { createGameState, createPlayer, startMatch, step } from "./step.js";
import { ACT_PICKUP, emptyInput, type GameState, type SimEvent } from "./types.js";

const arena = generateArena();

function begin(rules: number, players = 8): GameState {
  const state = createGameState(1);
  state.rules = rules;
  for (let i = 1; i <= players; i++) state.players.push(createPlayer(i));
  startMatch(state, 31, arena);
  return state;
}

const precision = ["sniper", "crossbow", "revolver"].map((id) => WEAPON_IDS.indexOf(id as (typeof WEAPON_IDS)[number]));

describe("reglas especiales", () => {
  it("todo legendario: cada arma en el piso y la de arranque, en su máxima rareza", () => {
    const state = begin(RULES_LEGENDARY);
    const weapons = state.items.filter((i) => i.kind === ITEM_WEAPON);
    expect(weapons.length).toBeGreaterThan(0);
    for (const w of weapons) expect(w.tier).toBe(weaponAt(w.ref).maxTier);
    const p = state.players[0]!;
    expect(p.slotTier[0]).toBe(weaponAt(p.slots[0]!).maxTier);
  });

  it("francotiradores: arrancan con uno, y en el piso y en las cajas sólo hay de precisión", () => {
    const state = begin(RULES_SNIPERS);
    expect(state.players.every((p) => p.slots[0] === WEAPON_IDS.indexOf("sniper"))).toBe(true);
    expect(state.players[0]!.slotAmmo[0]).toBe(weaponAt(WEAPON_IDS.indexOf("sniper")).magSize);
    for (const w of state.items.filter((i) => i.kind === ITEM_WEAPON)) expect(precision).toContain(w.ref);

    // Abrir unas cuantas cajas: tampoco.
    const crates = lootCrates(arena);
    const p = state.players[0]!;
    const drops: SimEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const c = crates[i]!;
      state.items = [];
      p.x = c.x + c.w / 2 + 40;
      p.y = c.y + c.h / 2;
      step(state, new Map([[1, [{ ...emptyInput(i + 1), act: ACT_PICKUP }]]]), drops, arena);
    }
    const crateWeapons = drops.filter((e) => e.t === "drop" && e.item.kind === ITEM_WEAPON);
    expect(crateWeapons.length).toBeGreaterThan(0);
    for (const e of crateWeapons) if (e.t === "drop") expect(precision).toContain(e.item.ref);
  });

  it("relámpago: la zona espera un tercio y todos arrancan con subfusil y chaleco", () => {
    const normal = begin(0);
    const blitz = begin(RULES_BLITZ);
    expect(blitz.zone.ticksLeft).toBe(Math.round(normal.zone.ticksLeft / 3));
    expect(normal.zone.ticksLeft).toBe(ZONE_PHASES[0]!.waitTicks);
    const p = blitz.players[0]!;
    expect(p.slots[0]).toBe(WEAPON_IDS.indexOf("smg"));
    expect(p.shield).toBeGreaterThan(0);
  });

  it("caos: todos con lanzacohetes legendario, dos granadas y dos molotovs", () => {
    const state = begin(RULES_CHAOS);
    for (const p of state.players) {
      expect(p.slots[0]).toBe(WEAPON_IDS.indexOf("rocket"));
      expect(p.slotTier[0]).toBe(4);
      expect(p.grenades).toBe(2);
      expect(p.molotovs).toBe(2);
    }
  });
});
