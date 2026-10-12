import {
  BULLET_RADIUS,
  DT,
  EXPLOSION_MAX_DAMAGE,
  EXPLOSION_MIN_DAMAGE,
  EXPLOSION_RADIUS,
  GRENADE_BOUNCE,
  GRENADE_FRICTION,
  GRENADE_FUSE_TICKS,
  GRENADE_MAX_STACK,
  GRENADE_RADIUS,
  GRENADE_SPEED,
  SPRINT_MULT,
  STAMINA_DRAIN,
  STAMINA_MAX,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  AIRDROP_FALL_TICKS,
  AIRDROP_PHASES,
  ENDED_TICKS,
  LAG_COMP_MAX_TICKS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  ZONE_PHASES,
} from "../constants.js";
import { lerp, makeRng, nextRandom } from "../math.js";
import {
  ARMORS,
  ITEM_ARMOR,
  ITEM_CONSUMABLE,
  ITEM_GRENADE,
  ITEM_WEAPON,
  CRATE_REACH,
  PICKUP_RADIUS,
  STARTING_WEAPON,
  WEAPON_IDS,
  clampTier,
  consumableAt,
  weaponStats,
  type GroundItem,
} from "../items.js";
import { bushAt, getArena, lootCrates, spawnPoint, type ArenaMap } from "../map/arena.js";
import { hasLineOfSight } from "./sight.js";
import { rollCrateContents, spawnLoot } from "../map/loot.js";
import {
  circleHitsBox,
  clampToArena,
  insideArena,
  resolveCircleBox,
  segmentBoxT,
  segmentCircleT,
  type Resolved,
} from "./collision.js";
import {
  ACT_PICKUP,
  ACT_SLOT_0,
  ACT_THROW,
  ACT_SLOT_1,
  CAUSE_EXPLOSION,
  CAUSE_ZONE,
  ACT_USE_BASE,
  type BulletState,
  type GameState,
  type GrenadeState,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
  type ZoneState,
} from "./types.js";

// Scratch reutilizado para no asignar objetos en el bucle de simulación.
const scratch: Resolved = { x: 0, y: 0 };
const nearby: number[] = [];

const SLOTS = 2;
/** Ticks de historia por jugador: lo máximo que se rebobina más el par a interpolar. */
const TRAIL_LENGTH = LAG_COMP_MAX_TICKS + 2;
const CONSUMABLE_KINDS = 3;

// ------------------------------------------------------------ construcción

export function createPlayer(id: number, x = 0, y = 0): PlayerState {
  const start = weaponStats(STARTING_WEAPON, 0);
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    aim: 0,
    hp: PLAYER_MAX_HP,
    alive: false,
    connected: true,
    kills: 0,
    slots: [STARTING_WEAPON, -1],
    slotTier: [0, 0],
    slotAmmo: [start.magSize, 0],
    activeSlot: 0,
    shield: 0,
    consumables: new Array<number>(CONSUMABLE_KINDS).fill(0),
    useCd: 0,
    useIndex: -1,
    boostTicks: 0,
    stamina: STAMINA_MAX,
    staminaDelay: 0,
    grenades: 0,
    fireCd: 0,
    reloadCd: 0,
    lastSeq: 0,
    diedAtTick: -1,
    killerId: -1,
    inBush: false,
    lastShotTick: -1000,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    place: -1,
    trail: new Array<number>(TRAIL_LENGTH * 2).fill(0).map((_, i) => (i % 2 === 0 ? x : y)),
  };
}

export function createZone(): ZoneState {
  const first = ZONE_PHASES[0]!;
  return {
    x: WORLD_CENTER_X,
    y: WORLD_CENTER_Y,
    radius: WORLD_RADIUS,
    phase: 0,
    shrinking: false,
    ticksLeft: first.waitTicks,
    targetX: WORLD_CENTER_X,
    targetY: WORLD_CENTER_Y,
    targetRadius: WORLD_RADIUS,
    fromRadius: WORLD_RADIUS,
    fromX: WORLD_CENTER_X,
    fromY: WORLD_CENTER_Y,
  };
}

export function createGameState(seed = 1): GameState {
  return {
    tick: 0,
    phase: "lobby",
    phaseTicksLeft: 0,
    players: [],
    bullets: [],
    grenades: [],
    nextGrenadeId: 1,
    airdrops: [],
    nextAirdropId: 1,
    items: [],
    nextItemId: 1,
    openedCrates: [],
    zone: createZone(),
    nextBulletId: 1,
    rng: seed | 0,
    winnerId: -1,
  };
}

/** Coloca a todos en el anillo de spawn, reparte el loot y arranca la partida. */
export function startMatch(state: GameState, seed: number, arena: ArenaMap = getArena()): void {
  const active = state.players.filter((p) => p.connected);
  const start = weaponStats(STARTING_WEAPON, 0);

  state.phase = "playing";
  state.phaseTicksLeft = 0;
  state.bullets.length = 0;
  state.grenades = [];
  state.nextGrenadeId = 1;
  state.airdrops = [];
  state.nextAirdropId = 1;
  state.zone = createZone();
  state.rng = seed | 0;
  state.winnerId = -1;
  state.tick = 0;

  state.items = spawnLoot(seed, arena);
  state.nextItemId = state.items.length + 1;
  state.openedCrates = [];

  // Qué lugar del anillo le toca a cada uno, sorteado. Sin esto el orden de
  // llegada a la sala decidía al lado de quién aparecías, siempre igual.
  const slots = active.map((_, i) => i);
  const pick = makeRng(seed ^ 0x51ed270b);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }

  active.forEach((p, i) => {
    const sp = spawnPoint(slots[i]!, active.length, seed, arena);
    p.x = sp.x;
    p.y = sp.y;
    p.vx = 0;
    p.vy = 0;
    p.hp = PLAYER_MAX_HP;
    p.alive = true;
    p.kills = 0;
    p.slots = [STARTING_WEAPON, -1];
    p.slotTier = [0, 0];
    p.slotAmmo = [start.magSize, 0];
    p.activeSlot = 0;
    p.shield = 0;
    p.consumables = new Array<number>(CONSUMABLE_KINDS).fill(0);
    p.useCd = 0;
    p.useIndex = -1;
    p.boostTicks = 0;
    p.stamina = STAMINA_MAX;
    p.staminaDelay = 0;
    p.grenades = 0;
    p.fireCd = 0;
    p.reloadCd = 0;
    p.diedAtTick = -1;
    p.killerId = -1;
    p.place = 0;
    p.inBush = false;
    p.lastShotTick = -1000;
    p.damageDealt = 0;
    p.damageTaken = 0;
    p.shotsFired = 0;
    p.shotsHit = 0;
    // Sin historia previa: hasta que la haya, rebobinarlo da donde apareció.
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      p.trail[i * 2] = p.x;
      p.trail[i * 2 + 1] = p.y;
    }
    // Mirando al centro de la arena.
    p.aim = Math.atan2(WORLD_CENTER_Y - sp.y, WORLD_CENTER_X - sp.x);
  });
}

export function findPlayer(state: GameState, id: number): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

// --------------------------------------------------- compensación de lag

function trailSlot(tick: number): number {
  return (((tick % TRAIL_LENGTH) + TRAIL_LENGTH) % TRAIL_LENGTH) * 2;
}

function recordTrail(p: PlayerState, tick: number): void {
  const i = trailSlot(tick);
  p.trail[i] = p.x;
  p.trail[i + 1] = p.y;
}

/**
 * Dónde estaba `p` hace `rewind` ticks, interpolando entre los dos que rodean
 * ese instante, igual que el cliente interpola entre snapshots.
 *
 * Es la compensación de lag. El que dispara ve a los demás atrasados —la
 * interpolación (100 ms) más el viaje del snapshot— y su input tarda otro
 * tanto en llegar. Si el servidor probara la bala contra donde están ahora,
 * le pegaría a algo distinto de lo que vio: había que adelantar el tiro todo
 * el ping más 100 ms, y la bala que en tu pantalla le pegaba no hacía daño.
 * Probándola contra donde los veías, lo que ves es lo que pasa.
 */
export function pastPosition(p: PlayerState, tick: number, rewind: number, out: Resolved): void {
  if (rewind <= 0) {
    out.x = p.x;
    out.y = p.y;
    return;
  }
  const t = tick - rewind;
  const t0 = Math.floor(t);
  const f = t - t0;
  const a = trailSlot(t0);
  const b = trailSlot(t0 + 1);
  out.x = lerp(p.trail[a]!, p.trail[b]!, f);
  out.y = lerp(p.trail[a + 1]!, p.trail[b + 1]!, f);
}

/**
 * Cuántos ticks rebobinar para una bala disparada ahora con lo que el jugador
 * veía en `view`.
 *
 * El medio tick es porque cada paso del servidor mueve la bala un tick entero
 * de vuelo, y mientras tanto el que disparó ve avanzar a los demás: el blanco
 * representativo de ese tramo es el del medio, no el del principio.
 */
export function shotRewind(tick: number, view: number): number {
  if (view < 0) return 0;
  return Math.max(0, Math.min(LAG_COMP_MAX_TICKS, tick - view - 0.5));
}

export function activeWeapon(p: PlayerState): number {
  return p.slots[p.activeSlot] ?? -1;
}

export function activeTier(p: PlayerState): number {
  return p.slotTier[p.activeSlot] ?? 0;
}

// ------------------------------------------------------------ movimiento

/**
 * Movimiento + colisión de UN jugador. Es la única función que el cliente
 * re-ejecuta al reconciliar, así que tiene que ser idéntica bit a bit a lo que
 * corre el servidor: nada de random, nada de reloj, solo el input y el mapa.
 */
export function stepPlayerMovement(p: PlayerState, input: PlayerInput, arena: ArenaMap): void {
  const mx = input.moveX;
  const my = input.moveY;
  const len2 = mx * mx + my * my;

  // La adrenalina y el sprint son lo único que cambia la velocidad, y por eso
  // `boostTicks` y `stamina` viajan en el snapshot: si el cliente no los
  // supiera, predeciría de más en cuanto se le acabara la estamina.
  let speed = p.boostTicks > 0 ? PLAYER_SPEED * 1.2 : PLAYER_SPEED;

  // La estamina se resuelve acá adentro, junto con el movimiento, para que el
  // cliente llegue exactamente al mismo número que el servidor al reaplicar.
  const canSprint = input.sprint && len2 > 0 && p.useCd === 0 && p.stamina > 0;
  if (canSprint) {
    speed *= SPRINT_MULT;
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * DT);
    p.staminaDelay = STAMINA_REGEN_DELAY;
  } else if (p.staminaDelay > 0) {
    p.staminaDelay--;
  } else if (p.stamina < STAMINA_MAX) {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * DT);
  }

  if (len2 > 0) {
    const inv = 1 / Math.sqrt(len2);
    p.vx = mx * inv * speed;
    p.vy = my * inv * speed;
  } else {
    p.vx = 0;
    p.vy = 0;
  }

  p.x += p.vx * DT;
  p.y += p.vy * DT;

  // Dos pasadas: la primera puede empujar el círculo contra otra caja.
  for (let pass = 0; pass < 2; pass++) {
    arena.grid.query(p.x, p.y, PLAYER_RADIUS, nearby);
    if (nearby.length === 0) break;
    nearby.sort((a, b) => a - b); // orden fijo => resultado determinista
    for (let i = 0; i < nearby.length; i++) {
      const box = arena.obstacles[nearby[i]!]!;
      if (resolveCircleBox(p.x, p.y, PLAYER_RADIUS, box, scratch)) {
        p.x = scratch.x;
        p.y = scratch.y;
      }
    }
  }

  clampToArena(p.x, p.y, PLAYER_RADIUS, scratch);
  p.x = scratch.x;
  p.y = scratch.y;

  p.aim = input.aim;
  p.lastSeq = input.seq;
}

// ------------------------------------------------------------ inventario

/** Deja un objeto en el piso, en la posición del jugador. */
function dropItem(
  state: GameState,
  p: PlayerState,
  kind: number,
  ref: number,
  tier: number,
  count: number,
  events: SimEvent[],
): void {
  const r = nextRandom(state.rng);
  state.rng = r.state;
  const angle = r.value * Math.PI * 2;
  const item: GroundItem = {
    id: state.nextItemId++,
    kind,
    ref,
    tier,
    // Un empujoncito para que dos objetos soltados juntos no queden apilados.
    x: p.x + Math.cos(angle) * 18,
    y: p.y + Math.sin(angle) * 18,
    count,
  };
  state.items.push(item);
  events.push({ t: "drop", item });
}

/** Devuelve true si el objeto se pudo guardar (y por lo tanto sale del piso). */
function takeItem(
  state: GameState,
  p: PlayerState,
  item: GroundItem,
  events: SimEvent[],
): boolean {
  if (item.kind === ITEM_WEAPON) {
    const def = weaponStats(item.ref, item.tier);
    const empty = p.slots.indexOf(-1);

    if (empty >= 0) {
      p.slots[empty] = item.ref;
      p.slotTier[empty] = item.tier;
      p.slotAmmo[empty] = def.magSize;
      p.activeSlot = empty;
      return true;
    }

    // Las dos ranuras ocupadas: la que está en la mano se cambia por esta.
    const current = p.slots[p.activeSlot]!;
    dropItem(state, p, ITEM_WEAPON, current, p.slotTier[p.activeSlot] ?? 0, 1, events);
    p.slots[p.activeSlot] = item.ref;
    p.slotTier[p.activeSlot] = item.tier;
    p.slotAmmo[p.activeSlot] = def.magSize;
    p.reloadCd = 0;
    return true;
  }

  if (item.kind === ITEM_CONSUMABLE) {
    const def = consumableAt(item.ref);
    if (!def) return false;
    const have = p.consumables[item.ref] ?? 0;
    if (have >= def.maxStack) return false;
    p.consumables[item.ref] = Math.min(def.maxStack, have + item.count);
    return true;
  }

  if (item.kind === ITEM_GRENADE) {
    if (p.grenades >= GRENADE_MAX_STACK) return false;
    p.grenades = Math.min(GRENADE_MAX_STACK, p.grenades + item.count);
    return true;
  }

  if (item.kind === ITEM_ARMOR) {
    const def = ARMORS[item.ref];
    // Sólo vale la pena si aguanta más que lo que ya tenés puesto.
    if (!def || def.shield <= p.shield) return false;
    p.shield = def.shield;
    return true;
  }

  return false;
}

/**
 * Abre una caja: el contenido se sortea AHORA, no al generar el mapa. Así el
 * cliente no puede espiar lo que hay adentro leyendo el estado, y la lista de
 * cajas no tiene que viajar con su contenido.
 */
function openCrate(
  state: GameState,
  crateId: number,
  crate: { x: number; y: number; w: number; h: number },
  p: PlayerState,
  events: SimEvent[],
): void {
  state.openedCrates.push(crateId);

  const rolled = rollCrateContents(state.rng);
  state.rng = rolled.state;

  const cx = crate.x + crate.w / 2;
  const cy = crate.y + crate.h / 2;

  rolled.items.forEach((content, i) => {
    // En corona alrededor de la caja, para que no queden apilados y se pueda
    // elegir cuál levantar.
    const angle = (i / rolled.items.length) * Math.PI * 2;
    const item: GroundItem = {
      id: state.nextItemId++,
      kind: content.kind,
      ref: content.ref,
      tier: content.tier,
      x: cx + Math.cos(angle) * 34,
      y: cy + Math.sin(angle) * 34,
      count: content.count,
    };
    state.items.push(item);
    events.push({ t: "drop", item });
  });

  events.push({ t: "crate", crateId, x: cx, y: cy, byId: p.id });
}

/**
 * La tecla de acción hace las dos cosas: abre la caja más cercana o levanta el
 * objeto más cercano, lo que esté más a mano. Dos teclas separadas para "abrir"
 * y "recoger" sería una tecla de más para algo que nunca es ambiguo.
 */
function tryPickup(
  state: GameState,
  p: PlayerState,
  arena: ArenaMap,
  events: SimEvent[],
): void {
  const crates = lootCrates(arena);
  let crateIndex = -1;
  let crateDist = CRATE_REACH * CRATE_REACH;

  for (let i = 0; i < crates.length; i++) {
    if (state.openedCrates.includes(i)) continue;
    const c = crates[i]!;
    const dx = c.x + c.w / 2 - p.x;
    const dy = c.y + c.h / 2 - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= crateDist) {
      crateDist = d2;
      crateIndex = i;
    }
  }

  let bestIndex = -1;
  let bestDist = PICKUP_RADIUS * PICKUP_RADIUS;

  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]!;
    const dx = item.x - p.x;
    const dy = item.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestDist) {
      bestDist = d2;
      bestIndex = i;
    }
  }

  // Si hay una caja al alcance y no hay un objeto más cerca, se abre la caja.
  if (crateIndex >= 0 && (bestIndex < 0 || crateDist <= bestDist)) {
    openCrate(state, crateIndex, crates[crateIndex]!, p, events);
    return;
  }

  if (bestIndex < 0) return;
  const item = state.items[bestIndex]!;
  if (!takeItem(state, p, item, events)) return;

  state.items.splice(bestIndex, 1);
  events.push({ t: "pickup", itemId: item.id, byId: p.id });
}

function handleAction(
  state: GameState,
  p: PlayerState,
  act: number,
  arena: ArenaMap,
  events: SimEvent[],
): void {
  if (act === ACT_PICKUP) {
    tryPickup(state, p, arena, events);
    return;
  }

  if (act === ACT_THROW) {
    if (!canThrow(p)) return;
    p.grenades--;
    state.grenades.push({ id: state.nextGrenadeId++, ownerId: p.id, ...grenadeLaunch(p) });
    return;
  }

  applySelfAction(p, act);
}

/**
 * Las acciones que sólo tocan al propio jugador: cambiar de arma y empezar a
 * curarse. Van aparte porque el cliente las predice —deciden si el próximo
 * disparo sale y con qué arma— y no puede correr las que necesitan el mundo,
 * como recoger o tirar una granada.
 */
export function applySelfAction(p: PlayerState, act: number): void {
  if (act === ACT_SLOT_0 || act === ACT_SLOT_1) {
    const slot = act === ACT_SLOT_0 ? 0 : 1;
    if (slot === p.activeSlot || p.slots[slot] === -1) return;
    p.activeSlot = slot;
    // Cambiar de arma corta la recarga y la curación: es el costo de cambiar.
    p.reloadCd = 0;
    p.useCd = 0;
    p.useIndex = -1;
    return;
  }

  if (act >= ACT_USE_BASE && act < ACT_THROW) {
    const index = act - ACT_USE_BASE;
    const def = consumableAt(index);
    if (!def) return;
    if ((p.consumables[index] ?? 0) <= 0) return;
    if (p.useCd > 0) return;
    // No tiene sentido vendarse a tope de vida (la adrenalina sí, por la velocidad).
    if (def.heal > 0 && p.hp >= def.capAt) return;
    p.useIndex = index;
    p.useCd = def.useTicks;
    p.reloadCd = 0;
  }
}

/** Avanza la canalización. Moverse la cancela: por eso curarse es una decisión. */
export function stepConsumable(
  p: PlayerState,
  input: PlayerInput | undefined,
  events: SimEvent[],
): void {
  if (p.useCd <= 0) return;

  const moving = input ? input.moveX !== 0 || input.moveY !== 0 : false;
  if (moving) {
    p.useCd = 0;
    p.useIndex = -1;
    return;
  }

  p.useCd--;
  if (p.useCd > 0) return;

  const def = consumableAt(p.useIndex);
  p.useIndex = -1;
  if (!def) return;

  const index = def.id === "bandage" ? 0 : def.id === "medkit" ? 1 : 2;
  const have = p.consumables[index] ?? 0;
  if (have <= 0) return;
  p.consumables[index] = have - 1;

  if (def.heal > 0) {
    const before = p.hp;
    p.hp = Math.min(def.capAt, p.hp + def.heal);
    events.push({ t: "heal", byId: p.id, amount: Math.round(p.hp - before) });
  }
  if (def.boostTicks > 0) p.boostTicks = def.boostTicks;
}

// ------------------------------------------------------------ arma

/**
 * Cadencia, recarga y munición del arma en mano durante un tick. Devuelve el
 * índice del arma si disparó, o -1.
 *
 * No crea las balas: el servidor las mete en la partida y el cliente las dibuja
 * por su cuenta en el mismo instante en que apretás el gatillo. Para eso la
 * decisión de si el disparo sale tiene que ser la misma función en los dos lados.
 */
export function stepWeaponState(p: PlayerState, input: PlayerInput, events: SimEvent[]): number {
  if (p.fireCd > 0) p.fireCd--;

  const weaponIndex = activeWeapon(p);
  if (weaponIndex < 0) return -1;
  const slot = p.activeSlot;
  const def = weaponStats(weaponIndex, p.slotTier[slot] ?? 0);

  if (p.reloadCd > 0) {
    p.reloadCd--;
    if (p.reloadCd === 0) p.slotAmmo[slot] = def.magSize;
    return -1;
  }

  const ammo = p.slotAmmo[slot] ?? 0;

  if (input.reload && ammo < def.magSize) {
    p.reloadCd = def.reloadTicks;
    events.push({ t: "reload", byId: p.id });
    return -1;
  }

  if (!input.shoot || p.fireCd > 0) return -1;
  // Curarse y disparar son excluyentes.
  if (p.useCd > 0) return -1;

  if (ammo <= 0) {
    p.reloadCd = def.reloadTicks;
    events.push({ t: "reload", byId: p.id });
    return -1;
  }

  p.slotAmmo[slot] = ammo - 1;
  p.fireCd = def.fireCd;
  return weaponIndex;
}

/** Posición y velocidad iniciales de un proyectil. */
export interface Pellet {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Azar de un perdigón, fijado por quién disparó, con qué input y cuál de los
 * perdigones es. No sale del rng de la partida porque ése el cliente no lo
 * conoce: así puede calcular la misma dispersión que el servidor y dibujar la
 * bala exactamente por donde va a ir, sin esperar a que se la confirmen.
 */
function pelletRandom(playerId: number, seq: number, pellet: number): number {
  const seed =
    Math.imul(seq, 0x9e3779b1) ^ Math.imul(playerId + 1, 0x85ebca6b) ^ Math.imul(pellet + 1, 0xc2b2ae35);
  return nextRandom(seed).value;
}

/** Los proyectiles de un disparo, saliendo del caño del arma hacia `p.aim`. */
export function shotPellets(p: PlayerState, weaponIndex: number, seq: number): Pellet[] {
  const def = weaponStats(weaponIndex, activeTier(p));
  const muzzle = PLAYER_RADIUS + 8;
  const pellets: Pellet[] = [];

  for (let i = 0; i < def.pellets; i++) {
    const r = pelletRandom(p.id, seq, i);

    // Un solo proyectil se desvía al azar; la escopeta reparte los perdigones
    // por el cono y le agrega un poco de ruido a cada uno.
    const spread =
      def.pellets === 1
        ? (r * 2 - 1) * def.spread
        : ((i / (def.pellets - 1)) * 2 - 1) * def.spread * 0.85 + (r * 2 - 1) * def.spread * 0.2;

    const angle = p.aim + spread;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    pellets.push({
      x: p.x + cos * muzzle,
      y: p.y + sin * muzzle,
      vx: cos * def.bulletSpeed,
      vy: sin * def.bulletSpeed,
    });
  }

  return pellets;
}

function stepWeapon(
  state: GameState,
  p: PlayerState,
  input: PlayerInput,
  events: SimEvent[],
): void {
  const weaponIndex = stepWeaponState(p, input, events);
  if (weaponIndex < 0) return;

  const def = weaponStats(weaponIndex, activeTier(p));
  const firstBullet = state.nextBulletId;
  p.shotsFired += def.pellets;
  // La ballesta no te delata: se puede tirar desde un arbusto sin salir de él.
  if (!def.silent) p.lastShotTick = state.tick;

  for (const pellet of shotPellets(p, weaponIndex, input.seq)) {
    state.bullets.push({
      id: state.nextBulletId++,
      ownerId: p.id,
      damage: def.damage,
      weapon: weaponIndex,
      x: pellet.x,
      y: pellet.y,
      vx: pellet.vx,
      vy: pellet.vy,
      life: def.lifeTicks,
      rewind: shotRewind(state.tick, input.view),
    });
  }

  events.push({
    t: "shot",
    x: p.x,
    y: p.y,
    aim: p.aim,
    byId: p.id,
    seq: input.seq,
    firstBullet,
    pellets: def.pellets,
    ...(def.silent ? { silent: true } : {}),
  });
}

// ------------------------------------------------------------ daño

/** El escudo se come el daño antes que la vida. */
function applyDamage(
  state: GameState,
  target: PlayerState,
  amount: number,
  byId: number,
  cause: number,
  events: SimEvent[],
): void {
  // Lo que de verdad entra: un tiro de 64 a alguien con 10 de vida hizo 10.
  const landed = Math.min(amount, target.shield + Math.max(0, target.hp));
  target.damageTaken += landed;
  if (byId !== target.id) {
    const attacker = byId >= 0 ? findPlayer(state, byId) : undefined;
    if (attacker) attacker.damageDealt += landed;
  }

  let left = amount;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, left);
    target.shield -= absorbed;
    left -= absorbed;
  }
  if (left > 0) target.hp -= left;

  // Cualquier golpe corta la curación en curso.
  if (target.useCd > 0) {
    target.useCd = 0;
    target.useIndex = -1;
  }

  if (target.hp <= 0) killPlayer(state, target, byId, cause, events);
}

function killPlayer(
  state: GameState,
  victim: PlayerState,
  killerId: number,
  cause: number,
  events: SimEvent[],
): void {
  victim.hp = 0;
  victim.alive = false;
  victim.shield = 0;
  victim.useCd = 0;
  victim.useIndex = -1;
  victim.diedAtTick = state.tick;
  victim.killerId = killerId;

  // Suelta lo que llevaba: matar a alguien tiene que valer la pena.
  for (let slot = 0; slot < SLOTS; slot++) {
    const weapon = victim.slots[slot] ?? -1;
    if (weapon >= 0) {
      dropItem(state, victim, ITEM_WEAPON, weapon, victim.slotTier[slot] ?? 0, 1, events);
    }
    victim.slots[slot] = -1;
    victim.slotAmmo[slot] = 0;
  }
  if (victim.grenades > 0) {
    dropItem(state, victim, ITEM_GRENADE, 0, 0, victim.grenades, events);
    victim.grenades = 0;
  }
  for (let i = 0; i < victim.consumables.length; i++) {
    const count = victim.consumables[i] ?? 0;
    if (count > 0) dropItem(state, victim, ITEM_CONSUMABLE, i, i, count, events);
    victim.consumables[i] = 0;
  }

  const killer = killerId >= 0 ? findPlayer(state, killerId) : undefined;
  if (killer && killer.id !== victim.id) killer.kills++;
  events.push({ t: "kill", targetId: victim.id, byId: killerId, cause });
}

// --------------------------------------------------------- explosiones

/**
 * Daño en área con caída lineal. Va como función aparte porque no es sólo de
 * las granadas: cualquier cosa que estalle —un barril, un cohete— la va a usar
 * igual, y así el balance de las explosiones vive en un solo lugar.
 *
 * Le pega también a quien la tiró. Es lo que hace que tirar una granada a los
 * pies de alguien que te está corriendo sea una decisión y no un botón gratis.
 */
export function applyExplosion(
  state: GameState,
  x: number,
  y: number,
  byId: number,
  arena: ArenaMap,
  events: SimEvent[],
  /** La granada que estalló, si fue una: el que la tiró ya dibujó su explosión. */
  grenade = -1,
): void {
  events.push({ t: "explosion", x, y, byId, grenade });

  for (const p of state.players) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist > EXPLOSION_RADIUS) continue;
    // Una pared frena la esquirla igual que frena una bala: si no, se podrían
    // tirar granadas a través de las casas.
    if (!hasLineOfSight(x, y, p.x, p.y, arena)) continue;

    const damage = lerp(EXPLOSION_MAX_DAMAGE, EXPLOSION_MIN_DAMAGE, dist / EXPLOSION_RADIUS);
    events.push({
      t: "hit",
      x: p.x,
      y: p.y,
      targetId: p.id,
      byId,
      amount: damage,
      dir: Math.atan2(p.y - y, p.x - x),
      bullet: -1,
    });
    applyDamage(state, p, damage, byId, CAUSE_EXPLOSION, events);
  }
}

// ------------------------------------------------------------ granadas

/** ¿La granada choca acá? Se usa por eje, para poder rebotar. */
function grenadeBlocked(x: number, y: number, arena: ArenaMap): boolean {
  if (!insideArena(x, y, GRENADE_RADIUS)) return true;
  arena.grid.query(x, y, GRENADE_RADIUS, nearby);
  for (let i = 0; i < nearby.length; i++) {
    const box = arena.obstacles[nearby[i]!];
    if (box && circleHitsBox(x, y, GRENADE_RADIUS, box)) return true;
  }
  return false;
}

/** ¿Puede tirar una granada? Curándose no: tiene las manos ocupadas. */
export function canThrow(p: PlayerState): boolean {
  return p.grenades > 0 && p.useCd === 0;
}

/** Dónde aparece y con qué velocidad sale una granada tirada ahora. */
export function grenadeLaunch(p: PlayerState): { x: number; y: number; vx: number; vy: number; fuse: number } {
  const cos = Math.cos(p.aim);
  const sin = Math.sin(p.aim);
  return {
    x: p.x + cos * (PLAYER_RADIUS + 12),
    y: p.y + sin * (PLAYER_RADIUS + 12),
    vx: cos * GRENADE_SPEED,
    vy: sin * GRENADE_SPEED,
    fuse: GRENADE_FUSE_TICKS,
  };
}

/**
 * Un tick de una granada: mecha, rebote y rozamiento. Devuelve false si le
 * toca estallar. La comparten el servidor y el cliente, que dibuja la suya sin
 * esperarlo: con el mismo mapa y los mismos números, rueda por el mismo lado.
 */
export function advanceGrenade(
  g: { x: number; y: number; vx: number; vy: number; fuse: number },
  arena: ArenaMap,
): boolean {
  g.fuse--;
  if (g.fuse <= 0) return false;

  // Rebote por eje: es lo que permite tirarla contra una pared para que caiga
  // del otro lado de una esquina.
  let nx = g.x + g.vx * DT;
  if (grenadeBlocked(nx, g.y, arena)) {
    g.vx = -g.vx * GRENADE_BOUNCE;
    nx = g.x;
  }
  let ny = g.y + g.vy * DT;
  if (grenadeBlocked(nx, ny, arena)) {
    g.vy = -g.vy * GRENADE_BOUNCE;
    ny = g.y;
  }

  g.x = nx;
  g.y = ny;
  g.vx *= GRENADE_FRICTION;
  g.vy *= GRENADE_FRICTION;
  return true;
}

function stepGrenades(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  const kept: GrenadeState[] = [];

  for (const g of state.grenades) {
    if (!advanceGrenade(g, arena)) {
      applyExplosion(state, g.x, g.y, g.ownerId, arena, events, g.id);
      continue;
    }
    kept.push(g);
  }

  state.grenades = kept;
}

// ------------------------------------------------------------ balas

function stepBullets(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  const kept: BulletState[] = [];

  for (const b of state.bullets) {
    const dx = b.vx * DT;
    const dy = b.vy * DT;

    let bestT = 1;
    let hitPlayer: PlayerState | null = null;

    // Impacto contra jugadores (test de segmento: la bala no puede atravesarlos),
    // cada uno donde lo veía el que disparó.
    for (const target of state.players) {
      if (!target.alive || target.id === b.ownerId) continue;
      pastPosition(target, state.tick, b.rewind, scratch);
      const t = segmentCircleT(b.x, b.y, dx, dy, scratch.x, scratch.y, PLAYER_RADIUS + BULLET_RADIUS);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = target;
      }
    }

    // Impacto contra obstáculos.
    let hitBox = false;
    arena.grid.query(b.x + dx * 0.5, b.y + dy * 0.5, Math.abs(dx) + Math.abs(dy) + BULLET_RADIUS, nearby);
    nearby.sort((a, c) => a - c);
    for (let i = 0; i < nearby.length; i++) {
      const box = arena.obstacles[nearby[i]!]!;
      const t = segmentBoxT(b.x, b.y, dx, dy, BULLET_RADIUS, box);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = null;
        hitBox = true;
      }
    }

    const nx = b.x + dx * bestT;
    const ny = b.y + dy * bestT;

    if (hitPlayer) {
      events.push({
        t: "hit",
        x: nx,
        y: ny,
        targetId: hitPlayer.id,
        byId: b.ownerId,
        amount: b.damage,
        dir: Math.atan2(b.vy, b.vx),
        bullet: b.id,
      });
      const owner = findPlayer(state, b.ownerId);
      if (owner) owner.shotsHit++;
      applyDamage(state, hitPlayer, b.damage, b.ownerId, b.weapon, events);
      continue;
    }

    if (hitBox) {
      events.push({ t: "impact", x: nx, y: ny, bullet: b.id });
      continue;
    }

    // Muro circular de la arena.
    const cx = nx - WORLD_CENTER_X;
    const cy = ny - WORLD_CENTER_Y;
    const limit = WORLD_RADIUS - BULLET_RADIUS;
    if (cx * cx + cy * cy >= limit * limit) {
      events.push({ t: "impact", x: nx, y: ny, bullet: b.id });
      continue;
    }

    b.x = nx;
    b.y = ny;
    b.life--;
    if (b.life > 0) kept.push(b);
  }

  state.bullets = kept;
}

// ------------------------------------------------------ paquetes aéreos

/** Armas que puede traer un paquete: cualquiera menos la pistola, que es la de arranque. */
const AIRDROP_WEAPONS = WEAPON_IDS.map((_, i) => i).filter((i) => i !== STARTING_WEAPON);

/**
 * Anuncia un paquete que va a caer dentro de la próxima zona. Se elige un punto
 * despejado: si cayera encima de una pared, la mitad del botín quedaría adentro.
 */
function launchAirdrop(state: GameState, arena: ArenaMap): void {
  const z = state.zone;
  const random = (): number => {
    const r = nextRandom(state.rng);
    state.rng = r.state;
    return r.value;
  };

  let x = z.targetX;
  let y = z.targetY;
  for (let attempt = 0; attempt < 40; attempt++) {
    const angle = random() * Math.PI * 2;
    // Hacia adentro de la próxima zona, no pegado a su borde: que valga la pena ir.
    const d = Math.sqrt(random()) * z.targetRadius * 0.7;
    const cx = z.targetX + Math.cos(angle) * d;
    const cy = z.targetY + Math.sin(angle) * d;
    if (airdropClear(cx, cy, arena)) {
      x = cx;
      y = cy;
      break;
    }
  }

  state.airdrops.push({ id: state.nextAirdropId++, x, y, landTick: state.tick + AIRDROP_FALL_TICKS });
}

/** Lugar libre para que el botín quede en el piso y al alcance. */
function airdropClear(x: number, y: number, arena: ArenaMap): boolean {
  const dx = x - WORLD_CENTER_X;
  const dy = y - WORLD_CENTER_Y;
  if (dx * dx + dy * dy > (WORLD_RADIUS - 120) ** 2) return false;
  arena.grid.query(x, y, 64, nearby);
  for (let i = 0; i < nearby.length; i++) {
    if (circleHitsBox(x, y, 64, arena.obstacles[nearby[i]!]!)) return false;
  }
  return true;
}

/**
 * Aterriza lo que tenga que aterrizar. Trae lo que hace que valga la pena
 * cruzar el mapa: un arma épica o legendaria (hasta el techo de cada una), el
 * chaleco pesado, un botiquín y dos granadas.
 */
function stepAirdrops(state: GameState, events: SimEvent[]): void {
  if (state.airdrops.length === 0) return;
  const pending = [];
  for (const drop of state.airdrops) {
    if (state.tick < drop.landTick) {
      pending.push(drop);
      continue;
    }
    const r1 = nextRandom(state.rng);
    const r2 = nextRandom(r1.state);
    state.rng = r2.state;
    const weapon = AIRDROP_WEAPONS[Math.floor(r1.value * AIRDROP_WEAPONS.length)]!;
    const tier = clampTier(weapon, r2.value < 0.5 ? 3 : 4);

    const loot: Omit<GroundItem, "id" | "x" | "y">[] = [
      { kind: ITEM_WEAPON, ref: weapon, tier, count: 1 },
      { kind: ITEM_ARMOR, ref: ARMORS.length - 1, tier: 3, count: 1 },
      { kind: ITEM_CONSUMABLE, ref: 1, tier: 3, count: 1 },
      { kind: ITEM_GRENADE, ref: 0, tier: 3, count: 2 },
    ];
    loot.forEach((content, i) => {
      // En corona, como las cajas: se ve todo y se elige qué levantar.
      const angle = (i / loot.length) * Math.PI * 2 + Math.PI / 4;
      const item: GroundItem = {
        id: state.nextItemId++,
        ...content,
        x: drop.x + Math.cos(angle) * 34,
        y: drop.y + Math.sin(angle) * 34,
      };
      state.items.push(item);
      events.push({ t: "drop", item });
    });
    events.push({ t: "airdrop", x: drop.x, y: drop.y });
  }
  state.airdrops = pending;
}

// ------------------------------------------------------------ zona

function stepZone(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  const z = state.zone;
  const cfg = ZONE_PHASES[z.phase];

  if (cfg) {
    if (!z.shrinking) {
      if (z.ticksLeft > 0) z.ticksLeft--;
      if (z.ticksLeft === 0) {
        z.shrinking = true;
        z.ticksLeft = cfg.shrinkTicks;
        z.fromRadius = z.radius;
        z.fromX = z.x;
        z.fromY = z.y;
        z.targetRadius = WORLD_RADIUS * cfg.radiusFactor;

        // Nuevo centro dentro del círculo actual, para que la zona "camine".
        const r1 = nextRandom(state.rng);
        state.rng = r1.state;
        const r2 = nextRandom(state.rng);
        state.rng = r2.state;
        const maxOffset = Math.max(0, z.radius - z.targetRadius);
        const angle = r1.value * Math.PI * 2;
        const off = Math.sqrt(r2.value) * maxOffset;
        z.targetX = z.x + Math.cos(angle) * off;
        z.targetY = z.y + Math.sin(angle) * off;

        if (z.phase < AIRDROP_PHASES) launchAirdrop(state, arena);
      }
    } else {
      if (z.ticksLeft > 0) z.ticksLeft--;
      const t = cfg.shrinkTicks === 0 ? 1 : 1 - z.ticksLeft / cfg.shrinkTicks;
      z.radius = lerp(z.fromRadius, z.targetRadius, t);
      z.x = lerp(z.fromX, z.targetX, t);
      z.y = lerp(z.fromY, z.targetY, t);
      if (z.ticksLeft === 0) {
        z.shrinking = false;
        z.phase++;
        const next = ZONE_PHASES[z.phase];
        z.ticksLeft = next ? next.waitTicks : 0;
      }
    }
  }

  const dps = (cfg ?? ZONE_PHASES[ZONE_PHASES.length - 1]!).dps;
  const damage = dps * DT;

  for (const p of state.players) {
    if (!p.alive) continue;
    const dx = p.x - z.x;
    const dy = p.y - z.y;
    if (dx * dx + dy * dy <= z.radius * z.radius) continue;
    // La zona ignora el escudo: no querés que un chaleco te deje vivir afuera.
    p.damageTaken += Math.min(damage, Math.max(0, p.hp));
    p.hp -= damage;
    if (p.useCd > 0) {
      p.useCd = 0;
      p.useIndex = -1;
    }
    if (p.hp <= 0) killPlayer(state, p, -1, CAUSE_ZONE, events);
  }
}

// ------------------------------------------------------------ tick completo

function isInputList(v: PlayerInput | readonly PlayerInput[]): v is readonly PlayerInput[] {
  return Array.isArray(v);
}

/**
 * Un tick autoritativo. `inputs` mapea id de jugador -> lo que hizo en este
 * tick: un input, o una lista. La lista existe porque el servidor procesa cada
 * input del cliente exactamente una vez y en orden, aunque lleguen a destiempo:
 * vacía si no llegó nada (el jugador espera), dos si quedó atrasado y se está
 * poniendo al día. Es lo que la predicción del cliente hace con los mismos
 * inputs, así que movimiento y disparos coinciden sin corregir nada.
 *
 * Un jugador que no figura en el mapa se queda quieto pero el tiempo le corre
 * igual: las recargas y curaciones siguen.
 */
export function step(
  state: GameState,
  inputs: Map<number, PlayerInput | readonly PlayerInput[]>,
  events: SimEvent[],
  arena: ArenaMap = getArena(),
): void {
  state.tick++;

  if (state.phase !== "playing") {
    if (state.phaseTicksLeft > 0) state.phaseTicksLeft--;
    return;
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    const input = inputs.get(p.id);

    if (p.boostTicks > 0) {
      p.boostTicks--;
      const adrenaline = consumableAt(2);
      if (adrenaline && adrenaline.regen > 0) {
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + adrenaline.regen * DT);
      }
    }

    if (input) {
      const list: readonly PlayerInput[] = isInputList(input) ? input : [input];
      for (const one of list) {
        stepPlayerMovement(p, one, arena);
        if (one.act !== 0) {
          const before = state.nextGrenadeId;
          handleAction(state, p, one.act, arena, events);
          // Como el "shot" de las balas: le dice al que la tiró cuál es la suya.
          if (state.nextGrenadeId > before) {
            events.push({ t: "throw", byId: p.id, seq: one.seq, grenade: before });
          }
        }
        stepConsumable(p, one, events);
        stepWeapon(state, p, one, events);
      }
    } else {
      p.vx = 0;
      p.vy = 0;
      stepConsumable(p, undefined, events);
      if (p.fireCd > 0) p.fireCd--;
      if (p.reloadCd > 0) {
        p.reloadCd--;
        const weapon = activeWeapon(p);
        if (p.reloadCd === 0 && weapon >= 0) {
          p.slotAmmo[p.activeSlot] = weaponStats(weapon, activeTier(p)).magSize;
        }
      }
    }
  }

  // Antes de las balas: las de este tick se prueban contra la historia, y el
  // tramo más reciente es el de ahora.
  for (const p of state.players) {
    if (!p.alive) continue;
    recordTrail(p, state.tick);
    p.inBush = bushAt(arena, p.x, p.y);
  }

  stepGrenades(state, arena, events);
  stepBullets(state, arena, events);
  stepZone(state, arena, events);
  stepAirdrops(state, events);

  const alive = state.players.filter((p) => p.alive);

  // Puestos: el que cae queda detrás de todos los que siguen en pie. Se mira
  // acá y no al morir para cubrir también al que se desconecta, y para que dos
  // que caen en el mismo tick (una granada, la zona) empaten.
  for (const p of state.players) {
    if (p.place === 0 && !p.alive) {
      p.place = alive.length + 1;
      // El que se desconecta no pasa por killPlayer: su tiempo vivo termina acá.
      if (p.diedAtTick < 0) p.diedAtTick = state.tick;
    }
  }

  if (alive.length <= 1) {
    state.phase = "ended";
    state.phaseTicksLeft = ENDED_TICKS;
    state.winnerId = alive.length === 1 ? alive[0]!.id : -1;
    if (alive.length === 1) alive[0]!.place = 1;
  }
}
