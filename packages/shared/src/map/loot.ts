import { makeRng, nextRandom } from "../math.js";
import { PLAYER_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y, WORLD_RADIUS } from "../constants.js";
import {
  ITEM_ARMOR,
  ITEM_CONSUMABLE,
  ITEM_GRENADE,
  ITEM_WEAPON,
  RARITIES,
  clampTier,
  type GroundItem,
} from "../items.js";
import { circleHitsBox } from "../sim/collision.js";
import { buildingInterior, type ArenaMap } from "./arena.js";

/**
 * Reparto del loot. Igual que el mapa, se genera con una semilla: cliente y
 * servidor llegan a la misma lista por su cuenta, así que la partida no tiene
 * que transmitir dónde está cada cosa.
 *
 * Hay DOS tablas a propósito:
 *
 * - La del suelo son sobras: poco y flojo. Es lo que se ve tirado por el mapa,
 *   así que cuanto menos haya, más limpio se lee.
 * - La de las cajas concentra armas, chalecos y la curación de verdad. Así la
 *   decisión pasa a ser "¿me meto a abrir esa caja?" en vez de juntar del piso.
 */
interface Entry {
  kind: number;
  ref: number;
  weight: number;
  min: number;
  max: number;
  /** Rareza fija. Las armas la sortean aparte y este valor se ignora. */
  tier: number;
}

/**
 * Lo que queda tirado a la vista. Son sobras: alcanza para no quedar indefenso
 * si no encontraste una caja, pero no para equiparte. La curación de verdad
 * está adentro de las cajas, que es lo que le da sentido a entrar a buscarlas.
 */
const GROUND_TABLE: readonly Entry[] = [
  { kind: ITEM_CONSUMABLE, ref: 0, weight: 22, min: 1, max: 2, tier: 0 }, // vendas
  { kind: ITEM_CONSUMABLE, ref: 2, weight: 6, min: 1, max: 1, tier: 2 }, // adrenalina
  { kind: ITEM_CONSUMABLE, ref: 1, weight: 2, min: 1, max: 1, tier: 1 }, // botiquín
  { kind: ITEM_ARMOR, ref: 0, weight: 6, min: 1, max: 1, tier: 1 }, // chaleco ligero
  { kind: ITEM_WEAPON, ref: 0, weight: 7, min: 1, max: 1, tier: 0 }, // pistola
  { kind: ITEM_WEAPON, ref: 1, weight: 4, min: 1, max: 1, tier: 0 }, // subfusil
  { kind: ITEM_WEAPON, ref: 3, weight: 2, min: 1, max: 1, tier: 0 }, // escopeta
  { kind: ITEM_GRENADE, ref: 0, weight: 6, min: 1, max: 1, tier: 2 }, // granadas
  { kind: ITEM_GRENADE, ref: 1, weight: 4, min: 1, max: 1, tier: 1 }, // humo
  { kind: ITEM_GRENADE, ref: 2, weight: 3, min: 1, max: 1, tier: 2 }, // molotov
];

/** Lo que sale de abrir una caja: armas, chalecos y curación buena. */
const CRATE_TABLE: readonly Entry[] = [
  { kind: ITEM_WEAPON, ref: 1, weight: 13, min: 1, max: 1, tier: 0 }, // subfusil
  { kind: ITEM_WEAPON, ref: 2, weight: 13, min: 1, max: 1, tier: 0 }, // rifle
  { kind: ITEM_WEAPON, ref: 3, weight: 11, min: 1, max: 1, tier: 0 }, // escopeta
  { kind: ITEM_WEAPON, ref: 4, weight: 6, min: 1, max: 1, tier: 0 }, // francotirador
  { kind: ITEM_WEAPON, ref: 5, weight: 7, min: 1, max: 1, tier: 0 }, // ballesta
  { kind: ITEM_ARMOR, ref: 0, weight: 11, min: 1, max: 1, tier: 1 }, // chaleco ligero
  { kind: ITEM_ARMOR, ref: 1, weight: 7, min: 1, max: 1, tier: 3 }, // chaleco pesado
  { kind: ITEM_CONSUMABLE, ref: 1, weight: 14, min: 1, max: 1, tier: 1 }, // botiquín
  { kind: ITEM_CONSUMABLE, ref: 2, weight: 13, min: 1, max: 2, tier: 2 }, // adrenalina
  { kind: ITEM_CONSUMABLE, ref: 0, weight: 17, min: 2, max: 4, tier: 0 }, // vendas
  { kind: ITEM_GRENADE, ref: 0, weight: 11, min: 1, max: 2, tier: 2 }, // granadas
  { kind: ITEM_GRENADE, ref: 1, weight: 7, min: 1, max: 2, tier: 1 }, // humo
  { kind: ITEM_GRENADE, ref: 2, weight: 5, min: 1, max: 1, tier: 2 }, // molotov
];

/** Sólo armas: garantiza que abrir una caja siempre valga la pena. */
const CRATE_WEAPONS: readonly Entry[] = CRATE_TABLE.filter((e) => e.kind === ITEM_WEAPON);

const RARITY_WEIGHT = RARITIES.reduce((sum, r) => sum + r.weight, 0);

/**
 * Objetos tirados a la vista. Bastantes menos que antes: el mapa se lee mejor
 * con poco en el piso y el resto guardado adentro de las cajas.
 */
export const LOOT_COUNT = 42;
/** De esos, cuántos caen adentro de las casas. */
const IN_BUILDINGS = 12;
/** Y cuántos alrededor de cajas y contenedores sueltos. */
const CLUSTERED = 6;

function totalWeight(table: readonly Entry[]): number {
  return table.reduce((sum, e) => sum + e.weight, 0);
}

function pick(table: readonly Entry[], value: number): Entry {
  let n = value * totalWeight(table);
  for (const entry of table) {
    n -= entry.weight;
    if (n <= 0) return entry;
  }
  return table[0]!;
}

/**
 * Sortea la rareza y después la recorta al techo del arma. Recortar (en vez de
 * volver a tirar) hace que un francotirador épico sea más probable que un rifle
 * épico, que es justo lo que querés: el arma rara sale buena más seguido.
 */
function tierFrom(value: number, weaponIndex: number): number {
  let n = value * RARITY_WEIGHT;
  for (let tier = 0; tier < RARITIES.length; tier++) {
    n -= RARITIES[tier]!.weight;
    if (n <= 0) return clampTier(weaponIndex, tier);
  }
  return 0;
}

/** Un objeto no puede caer adentro de una pared: sería imposible agarrarlo. */
function isClear(x: number, y: number, arena: ArenaMap): boolean {
  const dx = x - WORLD_CENTER_X;
  const dy = y - WORLD_CENTER_Y;
  if (Math.sqrt(dx * dx + dy * dy) > WORLD_RADIUS - 60) return false;
  for (const o of arena.obstacles) {
    if (circleHitsBox(x, y, PLAYER_RADIUS + 6, o)) return false;
  }
  return true;
}

export function spawnLoot(seed: number, arena: ArenaMap): GroundItem[] {
  const rnd = makeRng(seed ^ 0x10c7);
  const items: GroundItem[] = [];
  let nextId = 1;

  const hotspots = arena.obstacles.filter((o) => o.kind === "crate" || o.kind === "container");

  const place = (x: number, y: number): boolean => {
    if (!isClear(x, y, arena)) return false;
    const entry = pick(GROUND_TABLE, rnd());
    const span = entry.max - entry.min + 1;
    items.push({
      id: nextId++,
      kind: entry.kind,
      ref: entry.ref,
      tier: entry.kind === ITEM_WEAPON ? tierFrom(rnd(), entry.ref) : entry.tier,
      x,
      y,
      count: entry.min + Math.floor(rnd() * span),
    });
    return true;
  };

  // Algo de curación suelta adentro de las casas, además de las cajas.
  for (let i = 0; i < IN_BUILDINGS && arena.buildings.length > 0; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const b = arena.buildings[Math.floor(rnd() * arena.buildings.length)]!;
      const inside = buildingInterior(b);
      const placed = place(
        inside.x + 20 + rnd() * Math.max(1, inside.w - 40),
        inside.y + 20 + rnd() * Math.max(1, inside.h - 40),
      );
      if (placed) break;
    }
  }

  for (let i = 0; i < CLUSTERED && hotspots.length > 0; i++) {
    const spot = hotspots[Math.floor(rnd() * hotspots.length)]!;
    const angle = rnd() * Math.PI * 2;
    const dist = 40 + rnd() * 70;
    place(spot.x + spot.w / 2 + Math.cos(angle) * dist, spot.y + spot.h / 2 + Math.sin(angle) * dist);
  }

  // El resto, repartido por toda la arena para que nadie quede sin nada.
  let attempts = 0;
  while (items.length < LOOT_COUNT && attempts < LOOT_COUNT * 30) {
    attempts++;
    const angle = rnd() * Math.PI * 2;
    const radius = Math.sqrt(rnd()) * (WORLD_RADIUS - 80);
    place(WORLD_CENTER_X + Math.cos(angle) * radius, WORLD_CENTER_Y + Math.sin(angle) * radius);
  }

  return items;
}

// ------------------------------------------------------- cajas de botín

/** Un objeto de caja, todavía sin id ni posición: eso lo pone la simulación. */
export interface CrateItem {
  kind: number;
  ref: number;
  tier: number;
  count: number;
}

/**
 * Contenido de una caja. Recibe y devuelve el estado del RNG de la partida en
 * vez de tirar dados por su cuenta, porque el contenido se decide al abrirla y
 * tiene que ser determinista como todo el resto de la simulación.
 */
export function rollCrateContents(rngState: number): { state: number; items: CrateItem[] } {
  let state = rngState;
  const next = (): number => {
    const r = nextRandom(state);
    state = r.state;
    return r.value;
  };

  const items: CrateItem[] = [];

  const take = (table: readonly Entry[]): void => {
    const entry = pick(table, next());
    const span = entry.max - entry.min + 1;
    items.push({
      kind: entry.kind,
      ref: entry.ref,
      tier: entry.kind === ITEM_WEAPON ? tierFrom(next(), entry.ref) : entry.tier,
      count: entry.min + Math.floor(next() * span),
    });
  };

  // Un arma garantizada: si una caja pudiera salir sin arma, abrirla sería una
  // lotería y la gente dejaría de desviarse para hacerlo.
  take(CRATE_WEAPONS);
  const extra = 1 + Math.floor(next() * 3);
  for (let i = 0; i < extra; i++) take(CRATE_TABLE);

  return { state, items };
}
