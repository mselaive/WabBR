import { TICK_RATE } from "./constants.js";

/**
 * Catálogo de todo lo que se puede agarrar del suelo.
 *
 * Armas, curaciones y chalecos son la misma cosa desde el punto de vista del
 * juego —un objeto tirado que alguien recoge— así que comparten el tipo
 * `GroundItem` y sólo se diferencian por la tabla a la que apuntan.
 *
 * Por la red viajan índices, no nombres: `WEAPON_IDS.indexOf(id)`. Si agregás
 * un arma, ponela AL FINAL del array o cambiás el significado de los índices
 * que ya están en vuelo.
 */

// --------------------------------------------------------------- rarezas

/**
 * La rareza multiplica las estadísticas del arma. Si sólo escalara el daño, la
 * legendaria sería estrictamente mejor y encontrarla dejaría de ser una
 * decisión; escalando también recarga, cargador y precisión, cada arma sigue
 * teniendo su carácter (la escopeta legendaria sigue sin servir de lejos).
 */
export interface RarityDef {
  readonly name: string;
  /** Color del borde de la placa en el suelo y del nombre en el HUD. */
  readonly color: number;
  readonly damage: number;
  /** Menor es mejor: recarga más rápida. */
  readonly reload: number;
  readonly mag: number;
  /** Menor es mejor: menos dispersión. */
  readonly spread: number;
  /** Peso para el sorteo del loot. */
  readonly weight: number;
}

export const RARITIES: readonly RarityDef[] = [
  { name: "Común", color: 0xb9c0c8, damage: 1, reload: 1, mag: 1, spread: 1, weight: 44 },
  { name: "Poco común", color: 0x5cd97a, damage: 1.1, reload: 0.96, mag: 1, spread: 0.95, weight: 28 },
  { name: "Rara", color: 0x4aa3ff, damage: 1.22, reload: 0.92, mag: 1.1, spread: 0.9, weight: 17 },
  { name: "Épica", color: 0xc07cff, damage: 1.35, reload: 0.87, mag: 1.2, spread: 0.84, weight: 8 },
  { name: "Legendaria", color: 0xffb03a, damage: 1.5, reload: 0.8, mag: 1.35, spread: 0.75, weight: 3 },
];

export const MAX_RARITY = RARITIES.length - 1;

export function rarityAt(tier: number): RarityDef {
  return RARITIES[Math.max(0, Math.min(MAX_RARITY, tier))]!;
}

// ---------------------------------------------------------------- armas

export type WeaponId = "pistol" | "smg" | "rifle" | "shotgun" | "sniper" | "crossbow";

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  /** Daño por proyectil. La escopeta multiplica por `pellets`. */
  readonly damage: number;
  /** Ticks entre disparos. A 20 Hz, 3 ticks ≈ 6,6 disparos/s. */
  readonly fireCd: number;
  readonly magSize: number;
  readonly reloadTicks: number;
  readonly bulletSpeed: number;
  /** Desviación máxima en radianes. En la escopeta es la mitad del cono. */
  readonly spread: number;
  /** Ticks de vuelo de la bala: junto con la velocidad define el alcance. */
  readonly lifeTicks: number;
  readonly pellets: number;
  /**
   * Rareza máxima que puede salir de esta arma. El francotirador tope en épica
   * a propósito: con el multiplicador legendario haría 104 de daño y mataría de
   * un tiro desde fuera de la pantalla, que no es una pelea, es una lotería.
   */
  readonly maxTier: number;
  /**
   * Sin fogonazo y sin delatarte: disparar no te saca del arbusto. Los demás
   * ven venir la flecha, pero no de dónde salió.
   */
  readonly silent?: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: "pistol",
    name: "Pistola",
    damage: 14,
    fireCd: 5,
    magSize: 12,
    reloadTicks: 24,
    bulletSpeed: 560,
    spread: 0.045,
    lifeTicks: 20,
    pellets: 1,
    maxTier: 4,
  },
  smg: {
    id: "smg",
    name: "Subfusil",
    damage: 11,
    fireCd: 2,
    magSize: 25,
    reloadTicks: 30,
    bulletSpeed: 580,
    spread: 0.09,
    lifeTicks: 16,
    pellets: 1,
    maxTier: 4,
  },
  rifle: {
    id: "rifle",
    name: "Rifle",
    damage: 18,
    fireCd: 3,
    magSize: 30,
    reloadTicks: 32,
    bulletSpeed: 640,
    spread: 0.035,
    lifeTicks: 23,
    pellets: 1,
    maxTier: 4,
  },
  /**
   * La reina de la corta distancia: dos tiros matan hasta unos 100 px, y de
   * ahí para afuera pierde contra el rifle. Antes el cono abría 0,3 rad y a
   * 120 px entraban tres perdigones de ocho (23 de daño): sólo servía pegado
   * al otro. Con 0,16 entran todos hasta ~80 px y la mitad a 150.
   *
   * El daño por perdigón tiene techo: en legendaria es 12 × 8 = 96, y un
   * perdigón más de daño mataría de un tiro (ver el test de rareza máxima).
   */
  shotgun: {
    id: "shotgun",
    name: "Escopeta",
    damage: 8,
    fireCd: 12,
    magSize: 6,
    reloadTicks: 44,
    // Más rápidos para que lleguen antes de que el otro se corra; con un tick
    // menos de vuelo el alcance queda igual que antes (~380 px).
    bulletSpeed: 600,
    spread: 0.16,
    lifeTicks: 12,
    pellets: 8,
    maxTier: 4,
  },
  sniper: {
    id: "sniper",
    name: "Francotirador",
    damage: 65,
    fireCd: 24,
    magSize: 5,
    reloadTicks: 50,
    bulletSpeed: 1100,
    spread: 0.005,
    lifeTicks: 25,
    pellets: 1,
    // Tope en épica: 88 de daño sigue necesitando dos tiros.
    maxTier: 3,
  },
  /**
   * La del que juega escondido: dos flechas matan y no te delatan, pero hay
   * que recargar después de cada una y la flecha es lenta. Es lo que le da
   * sentido a quedarse en un arbusto en vez de salir a pelear.
   */
  crossbow: {
    id: "crossbow",
    name: "Ballesta",
    damage: 50,
    fireCd: 18,
    magSize: 1,
    reloadTicks: 26,
    bulletSpeed: 720,
    spread: 0.01,
    lifeTicks: 18,
    pellets: 1,
    // En legendaria hace 75: sigue necesitando dos.
    maxTier: 4,
    silent: true,
  },
};

/** El orden importa: es lo que viaja por la red. Agregá al final. */
export const WEAPON_IDS: readonly WeaponId[] = ["pistol", "smg", "rifle", "shotgun", "sniper", "crossbow"];

/** Con la que arrancás. Débil a propósito: es el motivo para buscar loot. */
export const STARTING_WEAPON = 0;

export function weaponAt(index: number): WeaponDef {
  return WEAPONS[WEAPON_IDS[index] ?? "pistol"]!;
}

/**
 * Estadísticas ya escaladas por rareza, calculadas una sola vez al cargar el
 * módulo. Son 25 combinaciones: no vale la pena rehacer las cuentas en cada
 * disparo, y así el objeto que se compara es siempre el mismo.
 */
const SCALED: WeaponDef[][] = WEAPON_IDS.map((id) => {
  const base = WEAPONS[id];
  return RARITIES.map((rarity, tier) => {
    if (tier === 0) return base;
    return {
      ...base,
      name: base.name,
      damage: Math.round(base.damage * rarity.damage),
      reloadTicks: Math.round(base.reloadTicks * rarity.reload),
      magSize: Math.round(base.magSize * rarity.mag),
      spread: base.spread * rarity.spread,
    };
  });
});

/** El arma tal como se juega: base + rareza. Es lo que debe usar la simulación. */
export function weaponStats(index: number, tier: number): WeaponDef {
  const byTier = SCALED[index] ?? SCALED[0]!;
  return byTier[clampTier(index, tier)] ?? byTier[0]!;
}

/** Ninguna arma puede pasar de su techo, ni por loot ni por un cliente mentiroso. */
export function clampTier(weaponIndex: number, tier: number): number {
  const max = weaponAt(weaponIndex).maxTier;
  return Math.max(0, Math.min(max, Math.floor(tier) || 0));
}

// ---------------------------------------------------------- consumibles

export type ConsumableId = "bandage" | "medkit" | "adrenaline";

export interface ConsumableDef {
  readonly id: ConsumableId;
  readonly name: string;
  /** Vida que suma. `capAt` limita hasta dónde. */
  readonly heal: number;
  readonly capAt: number;
  /** Ticks quieto para usarlo. Si te pegan, se cancela. */
  readonly useTicks: number;
  /** Multiplicador de velocidad mientras dura el efecto. */
  readonly speedBoost: number;
  readonly boostTicks: number;
  /** Vida por segundo durante el efecto. */
  readonly regen: number;
  readonly maxStack: number;
}

export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  bandage: {
    id: "bandage",
    name: "Vendas",
    heal: 25,
    capAt: 75,
    useTicks: 2 * TICK_RATE,
    speedBoost: 1,
    boostTicks: 0,
    regen: 0,
    maxStack: 8,
  },
  medkit: {
    id: "medkit",
    name: "Botiquín",
    heal: 100,
    capAt: 100,
    useTicks: 5 * TICK_RATE,
    speedBoost: 1,
    boostTicks: 0,
    regen: 0,
    maxStack: 3,
  },
  adrenaline: {
    id: "adrenaline",
    name: "Adrenalina",
    heal: 0,
    capAt: 100,
    useTicks: 3 * TICK_RATE,
    speedBoost: 1.2,
    boostTicks: 8 * TICK_RATE,
    regen: 1,
    maxStack: 4,
  },
};

export const CONSUMABLE_IDS: readonly ConsumableId[] = ["bandage", "medkit", "adrenaline"];

export function consumableAt(index: number): ConsumableDef | undefined {
  const id = CONSUMABLE_IDS[index];
  return id ? CONSUMABLES[id] : undefined;
}

// -------------------------------------------------------------- chalecos

export interface ArmorDef {
  readonly name: string;
  /** Puntos de escudo: una barra aparte que se gasta antes que la vida. */
  readonly shield: number;
}

export const ARMORS: readonly ArmorDef[] = [
  { name: "Chaleco ligero", shield: 50 },
  { name: "Chaleco pesado", shield: 100 },
];

// ------------------------------------------------------- ítems del suelo

export const ITEM_WEAPON = 0;
export const ITEM_CONSUMABLE = 1;
export const ITEM_ARMOR = 2;
/** Granadas. No ocupan ranura: se cuentan aparte y se tiran con G. */
export const ITEM_GRENADE = 3;

export interface GroundItem {
  id: number;
  /** ITEM_WEAPON | ITEM_CONSUMABLE | ITEM_ARMOR */
  kind: number;
  /** Índice dentro de la tabla que corresponde al `kind`. */
  ref: number;
  /**
   * Rareza. En las armas escala las estadísticas; en curaciones y chalecos es
   * sólo el color de la placa, porque su rareza ya está en lo que hacen.
   */
  tier: number;
  x: number;
  y: number;
  /** Unidades apiladas. Siempre 1 para armas y chalecos. */
  count: number;
}

/**
 * Radio para recoger. Un poco más grande que la placa que se dibuja: si te
 * exige pisar el centro exacto, recoger se siente peleado.
 */
export const PICKUP_RADIUS = 46;

/**
 * Alcance para abrir una caja. Más largo que el de recoger porque la caja es un
 * obstáculo de 48 px: no podés pararte encima, así que medís desde más lejos.
 */
export const CRATE_REACH = 74;

export function itemName(item: GroundItem): string {
  if (item.kind === ITEM_WEAPON) {
    // La rareza va en el nombre: es el dato que decide si te agachás a agarrarla.
    return `${weaponAt(item.ref).name} ${rarityAt(item.tier).name.toLowerCase()}`;
  }
  if (item.kind === ITEM_ARMOR) return ARMORS[item.ref]?.name ?? "Chaleco";
  if (item.kind === ITEM_GRENADE) {
    return item.count > 1 ? `Granadas x${item.count}` : "Granada";
  }
  const def = consumableAt(item.ref);
  return def ? (item.count > 1 ? `${def.name} x${item.count}` : def.name) : "Objeto";
}

/** Color con el que se pinta el objeto, tanto en el suelo como en el HUD. */
export function itemColor(item: GroundItem): number {
  return rarityAt(item.tier).color;
}
