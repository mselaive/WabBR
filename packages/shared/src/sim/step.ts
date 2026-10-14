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
  DOWNED_BLEED_TICKS,
  DOWNED_HP,
  DOWNED_SPEED_MULT,
  REVIVE_HP,
  REVIVE_RANGE,
  REVIVE_TICKS,
  RESPAWN_TICKS,
  ZIP_RADIUS,
  ZIP_SPEED,
  AIR_DIVE_TICKS,
  AIR_RESPAWN_TICKS,
  AIR_TICKS,
  GLIDE_SPEED,
  RADAR_PING_EVERY,
  RADAR_RANGE,
  RADAR_TICKS,
  CHICKEN_FEAR_RADIUS,
  CHICKEN_FLEE_SPEED,
  CHICKEN_HP,
  CHICKEN_RADIUS,
  CHICKEN_WALK_SPEED,
  RULES_BLITZ,
  RULES_CHAOS,
  RULES_LEGENDARY,
  RULES_SNIPERS,
  RULES_SHOTGUNS,
  SMOKE_MAX_STACK,
  MOLOTOV_MAX_STACK,
  MINE_ARM_TICKS,
  MINE_MAX_STACK,
  MINE_TICKS,
  MINE_TRIGGER,
  FIRE_DPS,
  FIRE_RADIUS,
  FIRE_TICKS,
  STRIKE_BOMB_EVERY,
  STRIKE_FIRST_PHASE,
  STRIKE_LAST_PHASE,
  STRIKE_RADIUS,
  STRIKE_TICKS,
  STRIKE_WARN_TICKS,
  GOLDEN_CRATES,
  CAMPFIRE_CALM_TICKS,
  JUMP_PAD_RADIUS,
  JUMP_SPEED,
  JUMP_TICKS,
  CAMPFIRE_HEAL_PER_S,
  CAMPFIRE_RADIUS,
  WANTED_LEAD,
  WANTED_MIN_KILLS,
  WANTED_REVEAL_TICKS,
  SMOKE_TICKS,
  SPRINT_MULT,
  STAMINA_DRAIN,
  STAMINA_MAX,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  AIRDROP_FALL_TICKS,
  AIRDROP_PHASES,
  BARREL_HP,
  ENDED_TICKS,
  LAG_COMP_MAX_TICKS,
  MIN_PLAYERS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  ZONE_FULL_PACE_PLAYERS,
  ZONE_MIN_PACE,
  ZONE_PHASES,
} from "../constants.js";
import { lerp, makeRng, nextRandom } from "../math.js";
import {
  ARMORS,
  ITEM_ARMOR,
  ITEM_BACKPACK,
  ITEM_FLARE,
  ITEM_RADAR,
  BACKPACK_MULT,
  ITEM_CONSUMABLE,
  ITEM_GRENADE,
  ITEM_WEAPON,
  CRATE_REACH,
  PICKUP_RADIUS,
  STARTING_WEAPON,
  WEAPON_IDS,
  clampTier,
  consumableAt,
  weaponAt,
  weaponStats,
  type GroundItem,
} from "../items.js";
import { bushAt, getArena, lootCrates, spawnBeside, spawnPoint, type ArenaMap } from "../map/arena.js";
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
  emptyInput,
  ACT_PICKUP,
  ACT_SLOT_0,
  ACT_THROW,
  ACT_SMOKE,
  ACT_MOLOTOV,
  ACT_MINE,
  ACT_SLOT_1,
  CAUSE_EXPLOSION,
  CAUSE_STRIKE,
  CAUSE_FIRE,
  CAUSE_MINE,
  GRENADE_MOLOTOV,
  GRENADE_MINE,
  type MineState,
  CAUSE_ZONE,
  ACT_USE_BASE,
  GRENADE_FRAG,
  GRENADE_SMOKE,
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
    smokes: 0,
    molotovs: 0,
    mines: 0,
    downed: false,
    downedBy: -1,
    downedCause: 0,
    longestKill: 0,
    jumpTicks: 0,
    jumpVx: 0,
    jumpVy: 0,
    lastHurtTick: -1000,
    healed: 0,
    selfDamage: 0,
    traveled: 0,
    thrown: 0,
    reviving: -1,
    reviveTicks: 0,
    fireCd: 0,
    reloadCd: 0,
    lastSeq: 0,
    diedAtTick: -1,
    radarTicks: 0,
    airTicks: 0,
    zip: false,
    backpack: false,
    respawnTick: -1,
    usedSecondChance: false,
    killerId: -1,
    inBush: false,
    lastShotTick: -1000,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    place: -1,
    team: id,
    trail: new Array<number>(TRAIL_LENGTH * 2).fill(0).map((_, i) => (i % 2 === 0 ? x : y)),
  };
}

/** Cuánto duran las esperas de la zona con `players` en la partida (1 = lo normal). */
export function zonePace(players: number): number {
  const t = (players - MIN_PLAYERS) / (ZONE_FULL_PACE_PLAYERS - MIN_PLAYERS);
  return ZONE_MIN_PACE + (1 - ZONE_MIN_PACE) * Math.max(0, Math.min(1, t));
}

export function createZone(pace = 1): ZoneState {
  const first = ZONE_PHASES[0]!;
  return {
    x: WORLD_CENTER_X,
    y: WORLD_CENTER_Y,
    radius: WORLD_RADIUS,
    phase: 0,
    shrinking: false,
    ticksLeft: Math.round(first.waitTicks * pace),
    targetX: WORLD_CENTER_X,
    targetY: WORLD_CENTER_Y,
    targetRadius: WORLD_RADIUS,
    fromRadius: WORLD_RADIUS,
    fromX: WORLD_CENTER_X,
    fromY: WORLD_CENTER_Y,
    pace,
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
    smokes: [],
    fires: [],
    mines: [],
    teamSize: 1,
    pairs: [],
    championId: -1,
    night: false,
    rules: 0,
    secondChance: false,
    skydive: false,
    startTeams: 0,
    finalTwo: false,
    chicken: null,
    chickenSpawned: false,
    airdrops: [],
    nextAirdropId: 1,
    strikes: [],
    nextStrikeId: 1,
    wanted: null,
    barrelHp: new Map(),
    explodedBarrels: [],
    items: [],
    nextItemId: 1,
    openedCrates: [],
    goldenCrates: [],
    zone: createZone(),
    nextBulletId: 1,
    rng: seed | 0,
    winnerId: -1,
  };
}

/** Con qué arranca cada uno según las reglas. */
function startingWeapon(rules: number): number {
  if (rules === RULES_CHAOS) return WEAPON_IDS.indexOf("rocket");
  if (rules === RULES_SNIPERS) return WEAPON_IDS.indexOf("sniper");
  if (rules === RULES_SHOTGUNS) return SHOTGUN;
  if (rules === RULES_BLITZ) return WEAPON_IDS.indexOf("smg");
  return STARTING_WEAPON;
}

/** La única arma de la regla escopetas. */
const SHOTGUN = WEAPON_IDS.indexOf("shotgun");

/** Las armas de precisión, las únicas de la regla francotiradores. */
const PRECISION = ["sniper", "crossbow", "revolver"].map((id) => WEAPON_IDS.indexOf(id as (typeof WEAPON_IDS)[number]));

/**
 * Cómo cambian las reglas un arma del botín (en el piso, en una caja o en un
 * paquete): todo legendario la sube a su máxima rareza; francotiradores la
 * cambia por una de precisión, elegida por su ref para que sea siempre igual.
 */
function ruledLoot(state: GameState, item: { kind: number; ref: number; tier: number }): { ref: number; tier: number } {
  if (item.kind !== ITEM_WEAPON) return { ref: item.ref, tier: item.tier };
  let ref = item.ref;
  if (state.rules === RULES_SNIPERS && !PRECISION.includes(ref)) ref = PRECISION[ref % PRECISION.length]!;
  if (state.rules === RULES_SHOTGUNS) ref = SHOTGUN;
  const tier = state.rules === RULES_LEGENDARY ? 4 : item.tier;
  return { ref, tier: clampTier(ref, tier) };
}

/** Coloca a todos en el anillo de spawn, reparte el loot y arranca la partida. */
export function startMatch(state: GameState, seed: number, arena: ArenaMap = getArena()): void {
  const active = state.players.filter((p) => p.connected);

  state.phase = "playing";
  state.phaseTicksLeft = 0;
  state.bullets.length = 0;
  state.grenades = [];
  state.nextGrenadeId = 1;
  state.smokes = [];
  state.fires = [];
  state.airdrops = [];
  state.mines = [];
  state.finalTwo = false;
  state.chicken = null;
  state.chickenSpawned = false;
  state.nextAirdropId = 1;
  state.strikes = [];
  state.nextStrikeId = 1;
  state.wanted = null;
  state.barrelHp = new Map();
  state.explodedBarrels = [];
  // Relámpago: la zona espera un tercio de lo que esperaría.
  state.zone = createZone(zonePace(active.length) * (state.rules === RULES_BLITZ ? 1 / 3 : 1));
  state.rng = seed | 0;
  state.winnerId = -1;
  state.tick = 0;

  state.items = spawnLoot(seed, arena).map((item) => ({ ...item, ...ruledLoot(state, item) }));
  state.nextItemId = state.items.length + 1;
  state.openedCrates = [];
  // Las doradas, sorteadas con su propio azar: no cambian nada más del reparto.
  const crateCount = lootCrates(arena).length;
  const pickGold = makeRng(seed ^ 0x601d);
  state.goldenCrates = [];
  while (state.goldenCrates.length < Math.min(GOLDEN_CRATES, crateCount)) {
    const id = Math.floor(pickGold() * crateCount);
    if (!state.goldenCrates.includes(id)) state.goldenCrates.push(id);
  }

  // Qué lugar del anillo le toca a cada uno, sorteado. Sin esto el orden de
  // llegada a la sala decidía al lado de quién aparecías, siempre igual.
  const slots = active.map((_, i) => i);
  const pick = makeRng(seed ^ 0x51ed270b);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }

  // En dúos (o tríos), el lugar sorteado también arma los equipos: 0 y 1
  // juntos, 2 y 3... Cada equipo aparece junto, en un punto del anillo para él
  // solo. Si no alcanza para dos equipos, todos contra todos: serían
  // compañeros y la partida terminaría al empezar.
  const size = state.teamSize >= 2 && active.length > state.teamSize ? state.teamSize : 1;
  const duos = size === 2;
  // El que no juega esta partida no arrastra el equipo de la anterior.
  for (const p of state.players) p.team = p.id;
  const teams = Math.ceil(active.length / size);

  // Las parejas que se eligieron en el lobby van primero, juntas; el resto se
  // empareja por sorteo. El lugar en el anillo igual sale al azar: la rotación
  // del anillo cambia en cada partida (ver spawnPoint).
  const order: PlayerState[] = [];
  if (duos) {
    const byId = new Map(active.map((p) => [p.id, p]));
    const used = new Set<number>();
    for (const [a, b] of state.pairs) {
      const pa = byId.get(a);
      const pb = byId.get(b);
      if (!pa || !pb || a === b || used.has(a) || used.has(b)) continue;
      used.add(a);
      used.add(b);
      order.push(pa, pb);
    }
  }
  const placed = new Set(order);
  const rest = active.map((p, i) => ({ p, slot: slots[i]! })).filter((x) => !placed.has(x.p));
  rest.sort((a, b) => a.slot - b.slot);
  for (const x of rest) order.push(x.p);
  const rank = new Map(order.map((p, i) => [p, i]));

  state.startTeams = teams;
  const firstOfTeam = new Map<number, { x: number; y: number }>();
  const teamCount = new Map<number, number>();
  const teamSpots = new Map<number, { x: number; y: number }[]>();
  active.forEach((p) => {
    const slot = rank.get(p)!;
    // En dúos, de a dos seguidos (así quedan juntas las parejas elegidas). En
    // tríos, repartidos: con 4 son 2 y 2, y no 3 contra 1.
    const team = size === 3 ? slot % teams : Math.floor(slot / size);
    p.team = size > 1 ? -1 - team : p.id;
    const mate = firstOfTeam.get(team);
    // El segundo al lado del primero; el tercero, del otro lado (y nunca donde
    // ya hay alguien del equipo).
    const nth = teamCount.get(team) ?? 0;
    teamCount.set(team, nth + 1);
    const taken = teamSpots.get(team) ?? [];
    const sp = mate ? spawnBeside(mate, arena, (nth - 1) * 4, taken) : spawnPoint(team, teams, seed, arena);
    if (!mate) firstOfTeam.set(team, sp);
    teamSpots.set(team, [...taken, sp]);
    p.x = sp.x;
    p.y = sp.y;
    p.vx = 0;
    p.vy = 0;
    equipFresh(state, p);
    if (state.skydive) p.airTicks = AIR_TICKS;
    // El cliente vuelve a numerar sus inputs desde 1: con el seq de la partida
    // anterior, la predicción daría por confirmados inputs que no lo están.
    p.lastSeq = 0;
    p.kills = 0;
    p.longestKill = 0;
    p.healed = 0;
    p.selfDamage = 0;
    p.traveled = 0;
    p.thrown = 0;
    p.diedAtTick = -1;
    p.respawnTick = -1;
    p.usedSecondChance = false;
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

/**
 * Vivo, con la vida llena y lo de arranque: al empezar la partida y al volver
 * con la segunda oportunidad. Las estadísticas (kills, daño) no se tocan acá.
 */
function equipFresh(state: GameState, p: PlayerState): void {
  p.hp = PLAYER_MAX_HP;
  p.alive = true;
  const first = startingWeapon(state.rules);
  p.slots = [first, -1];
  p.slotTier = [clampTier(first, state.rules === RULES_LEGENDARY ? 4 : 0), 0];
  p.slotAmmo = [weaponStats(first, p.slotTier[0]!).magSize, 0];
  p.activeSlot = 0;
  // Relámpago: con chaleco, para que las peleas apuradas no se terminen al primer tiro.
  p.shield = state.rules === RULES_BLITZ ? ARMORS[0]!.shield : 0;
  p.consumables = new Array<number>(CONSUMABLE_KINDS).fill(0);
  p.useCd = 0;
  p.useIndex = -1;
  p.boostTicks = 0;
  p.stamina = STAMINA_MAX;
  p.staminaDelay = 0;
  // Caos: con granadas y molotovs de entrada.
  p.grenades = state.rules === RULES_CHAOS ? 2 : 0;
  p.smokes = 0;
  p.molotovs = state.rules === RULES_CHAOS ? 2 : 0;
  p.mines = 0;
  p.downed = false;
  p.downedBy = -1;
  p.downedCause = 0;
  p.jumpTicks = 0;
  p.jumpVx = 0;
  p.jumpVy = 0;
  p.zip = false;
  p.lastHurtTick = -1000;
  p.reviving = -1;
  p.reviveTicks = 0;
  p.fireCd = 0;
  p.reloadCd = 0;
  p.radarTicks = 0;
  p.backpack = false;
  p.airTicks = 0;
}

/**
 * Cuánto puede cargar de algo que se apila (curaciones y granadas). Con
 * mochila, la mitad más (redondeando para arriba): 8 vendas pasan a 12, 3
 * granadas a 5. Lo usan recoger, el recoger al pasar y los bots.
 */
export function carryLimit(p: PlayerState, kind: number, ref: number): number {
  let base = 0;
  if (kind === ITEM_CONSUMABLE) base = consumableAt(ref)?.maxStack ?? 0;
  else if (kind === ITEM_GRENADE) {
    base =
      ref === GRENADE_SMOKE
        ? SMOKE_MAX_STACK
        : ref === GRENADE_MOLOTOV
          ? MOLOTOV_MAX_STACK
          : ref === GRENADE_MINE
            ? MINE_MAX_STACK
            : GRENADE_MAX_STACK;
  }
  return p.backpack ? Math.ceil(base * BACKPACK_MULT) : base;
}

/**
 * ¿Todavía vale la segunda oportunidad? Hasta que la zona empieza a cerrarse
 * por segunda vez: el que cae en el primer tiroteo no se pasa la partida
 * mirando, pero tampoco se vuelve del final.
 */
export function secondChanceOpen(state: GameState): boolean {
  return state.secondChance && (state.zone.phase === 0 || (state.zone.phase === 1 && !state.zone.shrinking));
}

/**
 * Los que esperan su segunda oportunidad vuelven a los RESPAWN_TICKS, adentro
 * de la zona (de la próxima, si se está cerrando) y lo más lejos posible de
 * los rivales: de seis lugares libres al azar, el que tenga al más cercano
 * más lejos. El que se desconectó mientras esperaba la pierde.
 */
function stepRespawns(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  for (const p of state.players) {
    if (p.alive || p.respawnTick < 0) continue;
    if (!p.connected) {
      p.respawnTick = -1;
      continue;
    }
    if (state.tick < p.respawnTick) continue;
    p.respawnTick = -1;
    p.usedSecondChance = true;

    const random = (): number => {
      const r = nextRandom(state.rng);
      state.rng = r.state;
      return r.value;
    };
    const best = safeSpot(state, arena, random, (o) => o.team !== p.team);

    equipFresh(state, p);
    // Con paracaídas, vuelve cayendo como el que se tira del avión: unos
    // segundos para elegir dónde (y nadie le pega mientras tanto).
    if (state.skydive) p.airTicks = AIR_RESPAWN_TICKS;
    p.x = best.x;
    p.y = best.y;
    p.vx = 0;
    p.vy = 0;
    p.diedAtTick = -1;
    p.killerId = -1;
    // Sin historia: rebobinarlo tiene que dar donde apareció, no donde murió.
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      p.trail[i * 2] = p.x;
      p.trail[i * 2 + 1] = p.y;
    }
    // Sin coordenadas: el evento le llega a todos, y dónde volvió no es público.
    events.push({ t: "respawn", id: p.id });
  }
}

/**
 * Un lugar libre adentro de la zona (de la próxima, si se está cerrando), lo
 * más lejos posible de los que importan: de seis lugares libres al azar, el
 * que tenga al más cercano más lejos.
 */
function safeSpot(
  state: GameState,
  arena: ArenaMap,
  random: () => number,
  avoid: (p: PlayerState) => boolean,
): { x: number; y: number } {
  const z = state.zone;
  const cx = z.shrinking ? z.targetX : z.x;
  const cy = z.shrinking ? z.targetY : z.y;
  const radius = z.shrinking ? z.targetRadius : z.radius;
  let best = { x: cx, y: cy };
  let bestScore = -1;
  for (let found = 0, attempt = 0; found < 6 && attempt < 60; attempt++) {
    const angle = random() * Math.PI * 2;
    const d = (0.3 + random() * 0.5) * radius;
    const x = cx + Math.cos(angle) * d;
    const y = cy + Math.sin(angle) * d;
    if (!respawnClear(x, y, arena)) continue;
    found++;
    let nearest = Infinity;
    for (const o of state.players) {
      if (o.alive && avoid(o)) nearest = Math.min(nearest, Math.hypot(o.x - x, o.y - y));
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = { x, y };
    }
  }
  return best;
}

// ------------------------------------------------------- gallina dorada

/**
 * La gallina dorada. Aparece cuando la zona empieza a cerrarse por primera
 * vez, lejos de todos. Pasea despacio; si alguien se le acerca, sale
 * corriendo para el otro lado, zigzagueando, y sigue corriendo un rato
 * aunque ya no lo vea. Se queda adentro de la zona (no se muere ahí: si la
 * zona la matara, el botín quedaría afuera). Chocar con una pared la frena
 * como a cualquiera: en una esquina es cuando se la caza.
 */
function stepChicken(state: GameState, arena: ArenaMap): void {
  const z = state.zone;
  if (!state.chickenSpawned && z.phase === 0 && z.shrinking) {
    state.chickenSpawned = true;
    let rng = state.rng ^ 0x6a11;
    const random = (): number => {
      const r = nextRandom(rng);
      rng = r.state;
      return r.value;
    };
    const at = safeSpot(state, arena, random, () => true);
    state.chicken = {
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      hp: CHICKEN_HP,
      panic: 0,
      turnIn: 0,
      rng,
      trail: new Array<number>(TRAIL_LENGTH * 2).fill(0).map((_, i) => (i % 2 === 0 ? at.x : at.y)),
    };
  }
  const c = state.chicken;
  if (!c) return;
  const random = (): number => {
    const r = nextRandom(c.rng);
    c.rng = r.state;
    return r.value;
  };

  // Del que esté más cerca, si está a tiro de susto.
  let threat: PlayerState | null = null;
  let threatD = CHICKEN_FEAR_RADIUS;
  for (const p of state.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < threatD) {
      threatD = d;
      threat = p;
    }
  }

  const zx = z.x - c.x;
  const zy = z.y - c.y;
  const zd = Math.hypot(zx, zy);
  let speed = CHICKEN_WALK_SPEED;
  if (zd > z.radius * 0.85) {
    // Afuera (o casi): para adentro, sin importar quién esté.
    c.vx = zx / zd;
    c.vy = zy / zd;
    speed = CHICKEN_FLEE_SPEED;
  } else if (threat) {
    c.panic = 30;
    const ax = c.x - threat.x;
    const ay = c.y - threat.y;
    const len = Math.hypot(ax, ay) || 1;
    // Para el otro lado, zigzagueando.
    const wobble = Math.sin(state.tick * 0.9) * 0.6;
    c.vx = ax / len - (ay / len) * wobble;
    c.vy = ay / len + (ax / len) * wobble;
    const n = Math.hypot(c.vx, c.vy) || 1;
    c.vx /= n;
    c.vy /= n;
    speed = CHICKEN_FLEE_SPEED;
  } else if (c.panic > 0) {
    c.panic--;
    speed = CHICKEN_FLEE_SPEED;
  } else {
    // Paseando: un rumbo al azar cada tanto, a veces quieta picoteando.
    if (--c.turnIn <= 0) {
      c.turnIn = 30 + Math.floor(random() * 40);
      const angle = random() * Math.PI * 2;
      const still = random() < 0.3;
      c.vx = still ? 0 : Math.cos(angle);
      c.vy = still ? 0 : Math.sin(angle);
    }
  }

  const fromX = c.x;
  const fromY = c.y;
  c.x += c.vx * speed * DT;
  c.y += c.vy * speed * DT;
  arena.grid.query(c.x, c.y, CHICKEN_RADIUS, nearby);
  nearby.sort((a, b) => a - b);
  for (let i = 0; i < nearby.length; i++) {
    if (resolveCircleBox(c.x, c.y, CHICKEN_RADIUS, arena.obstacles[nearby[i]!]!, scratch)) {
      c.x = scratch.x;
      c.y = scratch.y;
    }
  }
  clampToArena(c.x, c.y, CHICKEN_RADIUS, scratch);
  c.x = scratch.x;
  c.y = scratch.y;
  // Paseando contra una pared: mejor otro rumbo. (Quieta, picoteando, no.)
  const walking = speed === CHICKEN_WALK_SPEED && (c.vx !== 0 || c.vy !== 0);
  if (walking && Math.hypot(c.x - fromX, c.y - fromY) < speed * DT * 0.3) c.turnIn = 0;

  const slot = trailSlot(state.tick);
  c.trail[slot] = c.x;
  c.trail[slot + 1] = c.y;
}

/** Un tiro o una explosión a la gallina. Si no le queda vida, suelta el botín. */
function damageChicken(state: GameState, amount: number, byId: number, events: SimEvent[]): void {
  const c = state.chicken;
  if (!c) return;
  c.hp -= amount;
  // Sale corriendo para el lado contrario al que le tiró.
  c.panic = 40;
  const shooter = findPlayer(state, byId);
  if (shooter) {
    const len = Math.hypot(c.x - shooter.x, c.y - shooter.y) || 1;
    c.vx = (c.x - shooter.x) / len;
    c.vy = (c.y - shooter.y) / len;
  }
  events.push({ t: "cluck", x: c.x, y: c.y, byId });
  if (c.hp > 0) return;

  state.chicken = null;
  const rolled = rollGolden(state);
  state.rng = rolled.state;
  rolled.items.forEach((content, i) => {
    const loot = { ...content, ...ruledLoot(state, content) };
    const angle = (i / rolled.items.length) * Math.PI * 2;
    const item: GroundItem = {
      id: state.nextItemId++,
      kind: loot.kind,
      ref: loot.ref,
      tier: loot.tier,
      x: c.x + Math.cos(angle) * 26,
      y: c.y + Math.sin(angle) * 26,
      count: loot.count,
    };
    state.items.push(item);
    events.push({ t: "drop", item });
  });
  events.push({ t: "chicken", x: c.x, y: c.y, byId });
}

/** Un lugar donde aparecer: adentro de la arena y sin nada encima, con margen. */
function respawnClear(x: number, y: number, arena: ArenaMap): boolean {
  if (!insideArena(x, y, PLAYER_RADIUS + 40)) return false;
  arena.grid.query(x, y, PLAYER_RADIUS + 8, nearby);
  for (let i = 0; i < nearby.length; i++) {
    if (circleHitsBox(x, y, PLAYER_RADIUS + 8, arena.obstacles[nearby[i]!]!)) return false;
  }
  return true;
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
export function pastPosition(p: { x: number; y: number; trail: number[] }, tick: number, rewind: number, out: Resolved): void {
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

  // En paracaídas: planea para donde se mueva, sin chocar con nada. Con E
  // (ACT_PICKUP) se tira en picada y cae enseguida; al tocar el piso, en un
  // lugar libre.
  if (p.airTicks > 0) {
    if (input.act === ACT_PICKUP && p.airTicks > AIR_DIVE_TICKS) p.airTicks = AIR_DIVE_TICKS;
    p.airTicks--;
    const inv = len2 > 0 ? 1 / Math.sqrt(len2) : 0;
    p.vx = mx * inv * GLIDE_SPEED;
    p.vy = my * inv * GLIDE_SPEED;
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    clampToArena(p.x, p.y, PLAYER_RADIUS, scratch);
    p.x = scratch.x;
    p.y = scratch.y;
    if (p.airTicks === 0) touchDown(p, arena);
    p.aim = input.aim;
    p.lastSeq = input.seq;
    return;
  }

  // Volando de un hongo: derecho, sin chocar con nada, y al caer se resuelve.
  if (p.jumpTicks > 0) {
    p.jumpTicks--;
    p.vx = p.jumpVx;
    p.vy = p.jumpVy;
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    clampToArena(p.x, p.y, PLAYER_RADIUS, scratch);
    p.x = scratch.x;
    p.y = scratch.y;
    if (p.jumpTicks === 0) {
      land(p, arena);
      p.zip = false;
    }
    p.aim = input.aim;
    p.lastSeq = input.seq;
    return;
  }

  // Pisó un hongo: sale para donde iba, o para donde apunta si estaba quieto.
  if (!p.downed && onJumpPad(arena, p.x, p.y)) {
    const inv = len2 > 0 ? 1 / Math.sqrt(len2) : 0;
    const dx = len2 > 0 ? mx * inv : Math.cos(input.aim);
    const dy = len2 > 0 ? my * inv : Math.sin(input.aim);
    p.jumpTicks = JUMP_TICKS;
    p.jumpVx = dx * JUMP_SPEED;
    p.jumpVy = dy * JUMP_SPEED;
    p.zip = false;
    // Cortar la curación: volando no se venda nadie.
    p.useCd = 0;
    p.useIndex = -1;
  } else if (!p.downed && len2 > 0) {
    // En un poste de tirolesa, caminando hacia el cable: te lleva al otro poste.
    const inv = 1 / Math.sqrt(len2);
    const ride = zipRide(arena, p.x, p.y, mx * inv, my * inv);
    if (ride) {
      p.jumpTicks = ride.ticks;
      p.jumpVx = ride.vx;
      p.jumpVy = ride.vy;
      p.zip = true;
      p.useCd = 0;
      p.useIndex = -1;
    }
  }

  // La adrenalina y el sprint son lo único que cambia la velocidad, y por eso
  // `boostTicks` y `stamina` viajan en el snapshot: si el cliente no los
  // supiera, predeciría de más en cuanto se le acabara la estamina.
  let speed = p.boostTicks > 0 ? PLAYER_SPEED * 1.2 : PLAYER_SPEED;
  // Caído se arrastra. Como `downed` viaja en el snapshot, la predicción frena igual.
  if (p.downed) speed = PLAYER_SPEED * DOWNED_SPEED_MULT;

  // La estamina se resuelve acá adentro, junto con el movimiento, para que el
  // cliente llegue exactamente al mismo número que el servidor al reaplicar.
  const canSprint = input.sprint && len2 > 0 && p.useCd === 0 && p.stamina > 0 && !p.downed;
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

  resolveObstacles(p, arena);

  clampToArena(p.x, p.y, PLAYER_RADIUS, scratch);
  p.x = scratch.x;
  p.y = scratch.y;

  p.aim = input.aim;
  p.lastSeq = input.seq;
}

/** Saca al jugador de lo que esté pisando. */
function resolveObstacles(p: PlayerState, arena: ArenaMap): void {
  // Dos pasadas: la primera puede empujar el círculo contra otra caja. Al caer
  // de un salto pueden hacer falta más: se cayó en el medio de algo.
  for (let pass = 0; pass < 4; pass++) {
    arena.grid.query(p.x, p.y, PLAYER_RADIUS, nearby);
    if (nearby.length === 0) break;
    nearby.sort((a, b) => a - b); // orden fijo => resultado determinista
    let moved = false;
    for (let i = 0; i < nearby.length; i++) {
      const box = arena.obstacles[nearby[i]!]!;
      if (resolveCircleBox(p.x, p.y, PLAYER_RADIUS, box, scratch)) {
        p.x = scratch.x;
        p.y = scratch.y;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** De a cuánto se vuelve para atrás al caer encima de algo. */
const LAND_STEP = 8;

/**
 * Al caer de un salto. Empujar para afuera alcanza si cayó rozando algo, pero
 * no en el medio de un montón de cajas: cada empujón lo mete en la de al lado.
 * Así que primero vuelve por donde vino, de a poco, hasta un lugar libre: el
 * hongo está despejado, así que siempre hay uno. Sirve para cualquier mapa,
 * no sólo para los que se probaron a mano.
 */
function land(p: PlayerState, arena: ArenaMap): void {
  const speed = Math.hypot(p.jumpVx, p.jumpVy) || 1;
  const bx = (-p.jumpVx / speed) * LAND_STEP;
  const by = (-p.jumpVy / speed) * LAND_STEP;
  const maxSteps = Math.ceil((JUMP_SPEED * JUMP_TICKS * DT) / LAND_STEP) + 4;
  for (let i = 0; i < maxSteps && overlapsObstacle(p.x, p.y, arena); i++) {
    p.x += bx;
    p.y += by;
  }
  resolveObstacles(p, arena);
}

/**
 * Un tick de vuelo sin input (paracaídas, hongo o tirolesa): se cortó la
 * conexión, o hace rato que no llega nada (el servidor deja de mandar la lista;
 * ver GameRoom). Si no, el que deja de mandar quedaría colgado en el aire, y
 * en paracaídas, invulnerable.
 */
function fallWithoutInput(p: PlayerState, arena: ArenaMap): void {
  stepPlayerMovement(p, { ...emptyInput(p.lastSeq), aim: p.aim }, arena);
}

/**
 * Al tocar el piso con el paracaídas. Si cayó encima de algo, el lugar libre
 * más cercano: en anillos de 16 px, ocho direcciones por anillo, empezando por
 * el norte (orden fijo: cliente y servidor tienen que elegir el mismo).
 */
function touchDown(p: PlayerState, arena: ArenaMap): void {
  if (overlapsObstacle(p.x, p.y, arena)) {
    search: for (let r = 16; r <= 400; r += 16) {
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + (k / 8) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const y = p.y + Math.sin(a) * r;
        if (insideArena(x, y, PLAYER_RADIUS + 2) && !overlapsObstacle(x, y, arena)) {
          p.x = x;
          p.y = y;
          break search;
        }
      }
    }
  }
  resolveObstacles(p, arena);
  p.vx = 0;
  p.vy = 0;
}

function overlapsObstacle(x: number, y: number, arena: ArenaMap): boolean {
  arena.grid.query(x, y, PLAYER_RADIUS, nearby);
  for (let i = 0; i < nearby.length; i++) {
    if (circleHitsBox(x, y, PLAYER_RADIUS, arena.obstacles[nearby[i]!]!)) return true;
  }
  return false;
}

/**
 * Si (x, y) está en un poste de tirolesa y la dirección (dx, dy) va hacia el
 * cable (a menos de ~45°), el viaje: ticks y velocidad hasta el otro poste.
 * Al llegar al otro, seguir caminando para el mismo lado no te devuelve: hay
 * que darse vuelta.
 */
export function zipRide(
  arena: ArenaMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { ticks: number; vx: number; vy: number } | null {
  for (const z of arena.ziplines ?? []) {
    for (const [fx, fy, tx, ty] of [
      [z.ax, z.ay, z.bx, z.by],
      [z.bx, z.by, z.ax, z.ay],
    ] as const) {
      if ((x - fx) * (x - fx) + (y - fy) * (y - fy) > ZIP_RADIUS * ZIP_RADIUS) continue;
      const len = Math.hypot(tx - fx, ty - fy) || 1;
      const ux = (tx - fx) / len;
      const uy = (ty - fy) / len;
      if (ux * dx + uy * dy < 0.7) continue;
      return { ticks: Math.max(1, Math.round(len / (ZIP_SPEED * DT))), vx: ux * ZIP_SPEED, vy: uy * ZIP_SPEED };
    }
  }
  return null;
}

/** ¿Está parado sobre un hongo saltarín? */
export function onJumpPad(arena: ArenaMap, x: number, y: number): boolean {
  for (const pad of arena.jumpPads ?? []) {
    const dx = pad.x - x;
    const dy = pad.y - y;
    if (dx * dx + dy * dy <= JUMP_PAD_RADIUS * JUMP_PAD_RADIUS) return true;
  }
  return false;
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
  arena: ArenaMap,
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
    const limit = carryLimit(p, item.kind, item.ref);
    if (have >= limit) return false;
    p.consumables[item.ref] = Math.min(limit, have + item.count);
    return true;
  }

  if (item.kind === ITEM_GRENADE && item.ref === GRENADE_SMOKE) {
    const limit = carryLimit(p, item.kind, item.ref);
    if (p.smokes >= limit) return false;
    p.smokes = Math.min(limit, p.smokes + item.count);
    return true;
  }

  if (item.kind === ITEM_GRENADE && item.ref === GRENADE_MOLOTOV) {
    const limit = carryLimit(p, item.kind, item.ref);
    if (p.molotovs >= limit) return false;
    p.molotovs = Math.min(limit, p.molotovs + item.count);
    return true;
  }

  if (item.kind === ITEM_GRENADE && item.ref === GRENADE_MINE) {
    const limit = carryLimit(p, item.kind, item.ref);
    if (p.mines >= limit) return false;
    p.mines = Math.min(limit, p.mines + item.count);
    return true;
  }

  if (item.kind === ITEM_GRENADE) {
    const limit = carryLimit(p, item.kind, item.ref);
    if (p.grenades >= limit) return false;
    p.grenades = Math.min(limit, p.grenades + item.count);
    return true;
  }

  if (item.kind === ITEM_ARMOR) {
    const def = ARMORS[item.ref];
    // Sólo vale la pena si aguanta más que lo que ya tenés puesto.
    if (!def || def.shield <= p.shield) return false;
    p.shield = def.shield;
    return true;
  }

  // La bengala pide un paquete acá mismo (en un lugar libre de al lado).
  if (item.kind === ITEM_FLARE) {
    callAirdrop(state, p, arena, events);
    return true;
  }

  // La mochila se lleva puesta: una alcanza.
  if (item.kind === ITEM_BACKPACK) {
    if (p.backpack) return false;
    p.backpack = true;
    return true;
  }

  // El radar se prende al levantarlo. Con uno andando, el segundo espera en el piso.
  if (item.kind === ITEM_RADAR) {
    if (p.radarTicks > 0) return false;
    p.radarTicks = RADAR_TICKS;
    return true;
  }

  return false;
}

/** Cada cuánto cae un relámpago, en promedio: unos 20 segundos. */
const LIGHTNING_EVERY = 400;

/**
 * De noche hay tormenta: cada tanto un relámpago ilumina todo el mapa un
 * instante. Sale de un hash del tick y no del azar de la partida, así no mueve
 * nada más; y como es un evento, todos lo ven a la vez. No cambia quién ve a
 * quién (eso lo decide el servidor igual que siempre): es la oscuridad la que
 * se corre, y por un momento se ve al que estaba a la vista y no se notaba.
 */
function stepStorm(state: GameState, events: SimEvent[]): void {
  if (!state.night) return;
  const hash = Math.imul(state.tick ^ 0x5bd1e995, 2654435761) >>> 0;
  if (hash % LIGHTNING_EVERY === 0) events.push({ t: "lightning" });
}

/**
 * Los radares prendidos: una pasada cada RADAR_PING_EVERY ticks, la primera
 * en cuanto se prende. Marca dónde están los rivales cercanos en ese momento
 * —también los que están en un arbusto: para eso sirve— y nada más: entre
 * pasada y pasada no se los sigue.
 */
function stepRadars(state: GameState, events: SimEvent[]): void {
  for (const p of state.players) {
    if (p.radarTicks <= 0) continue;
    if (!p.alive) {
      p.radarTicks = 0;
      continue;
    }
    if ((RADAR_TICKS - p.radarTicks) % RADAR_PING_EVERY === 0) {
      const pings: [number, number][] = [];
      for (const o of state.players) {
        if (!o.alive || o.team === p.team) continue;
        if (Math.hypot(o.x - p.x, o.y - p.y) > RADAR_RANGE) continue;
        pings.push([Math.round(o.x), Math.round(o.y)]);
      }
      events.push({ t: "radar", byId: p.id, team: p.team, pings });
    }
    p.radarTicks--;
  }
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

  const rolled = state.goldenCrates.includes(crateId) ? rollGolden(state) : rollCrateContents(state.rng);
  state.rng = rolled.state;

  const cx = crate.x + crate.w / 2;
  const cy = crate.y + crate.h / 2;

  rolled.items = rolled.items.map((content) => ({ ...content, ...ruledLoot(state, content) }));
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
  if (!takeItem(state, p, item, events, arena)) return;

  state.items.splice(bestIndex, 1);
  events.push({ t: "pickup", itemId: item.id, byId: p.id });
}

/** Pisarlo alcanza: a esta distancia del centro del objeto se junta solo. */
const AUTO_PICKUP_RADIUS = 26;

/**
 * Curaciones y granadas se juntan solas al pasar por encima, si entran
 * enteras en la mochila (como la munición en surviv.io). Armas y chalecos
 * siguen pidiendo E: ahí hay que elegir y uno no quiere soltar el suyo sin
 * querer. Si no entran enteras, tampoco: E las junta igual, perdiendo lo que
 * sobra, pero eso tiene que ser una decisión.
 */
function autoPickup(state: GameState, p: PlayerState, events: SimEvent[], arena: ArenaMap): void {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (item.kind !== ITEM_CONSUMABLE && item.kind !== ITEM_GRENADE) continue;
    const dx = item.x - p.x;
    const dy = item.y - p.y;
    if (dx * dx + dy * dy > AUTO_PICKUP_RADIUS * AUTO_PICKUP_RADIUS) continue;
    if (!fitsWhole(p, item)) continue;
    if (!takeItem(state, p, item, events, arena)) continue;
    state.items.splice(i, 1);
    events.push({ t: "pickup", itemId: item.id, byId: p.id });
  }
}

/** ¿Entra todo el montón en la mochila? */
function fitsWhole(p: PlayerState, item: GroundItem): boolean {
  if (item.kind === ITEM_GRENADE) {
    const limit = carryLimit(p, item.kind, item.ref);
    if (item.ref === GRENADE_SMOKE) return p.smokes + item.count <= limit;
    if (item.ref === GRENADE_MOLOTOV) return p.molotovs + item.count <= limit;
    if (item.ref === GRENADE_MINE) return p.mines + item.count <= limit;
    return p.grenades + item.count <= limit;
  }
  const def = consumableAt(item.ref);
  return def !== undefined && (p.consumables[item.ref] ?? 0) + item.count <= carryLimit(p, item.kind, item.ref);
}

function handleAction(
  state: GameState,
  p: PlayerState,
  act: number,
  arena: ArenaMap,
  events: SimEvent[],
): void {
  // Caído no hace nada más que arrastrarse.
  if (p.downed) return;

  if (act === ACT_PICKUP) {
    // Si hay un compañero caído al lado, E lo levanta antes que recoger.
    const mate = downedMateNear(state, p);
    if (mate) {
      // Apretar E de nuevo mientras lo levanta no reinicia la cuenta.
      if (p.reviving === mate.id) return;
      p.reviving = mate.id;
      p.reviveTicks = REVIVE_TICKS;
      // Una cosa a la vez: levantar corta la curación en curso.
      p.useCd = 0;
      p.useIndex = -1;
      return;
    }
    tryPickup(state, p, arena, events);
    return;
  }

  if (act === ACT_THROW || act === ACT_SMOKE || act === ACT_MOLOTOV || act === ACT_MINE) {
    const kind = throwKind(act);
    if (!canThrow(p, kind)) return;
    spendThrowable(p, kind);
    p.thrown++;
    state.grenades.push({ id: state.nextGrenadeId++, ownerId: p.id, kind, ...grenadeLaunch(p) });
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
  if (p.downed) return;
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
    p.healed += p.hp - before;
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
  if (p.downed) return -1;

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
      team: p.team,
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
    weapon: weaponIndex,
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
  target.lastHurtTick = state.tick;
  if (byId === target.id) target.selfDamage += landed;
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

  // Cualquier golpe corta la curación en curso, y también levantar a alguien.
  if (target.useCd > 0) {
    target.useCd = 0;
    target.useIndex = -1;
  }
  target.reviving = -1;

  if (target.hp <= 0) downOrKill(state, target, byId, cause, events);
}

/** ¿Hay alguien de su equipo en pie (y no caído)? Entonces puede caer en vez de morir. */
function hasStandingMate(state: GameState, p: PlayerState): boolean {
  return state.players.some((q) => q !== p && q.team === p.team && q.alive && !q.downed);
}

/**
 * Llegó a cero. En dúos, con el compañero en pie, cae; si ya estaba caído (o
 * está solo), muere. Rematar a un caído es la kill del que remata; si lo
 * termina la zona, del que lo tiró.
 */
function downOrKill(state: GameState, target: PlayerState, byId: number, cause: number, events: SimEvent[]): void {
  if (!target.downed && hasStandingMate(state, target)) {
    target.downed = true;
    target.hp = DOWNED_HP;
    target.shield = 0;
    target.useCd = 0;
    target.useIndex = -1;
    target.reloadCd = 0;
    target.boostTicks = 0;
    target.reviving = -1;
    target.downedBy = byId;
    target.downedCause = cause;
    events.push({ t: "down", targetId: target.id, byId, cause });
    return;
  }
  const credit = target.downed && (byId < 0 || byId === target.id) ? target.downedBy : byId;
  killPlayer(state, target, credit, target.downed && byId < 0 ? target.downedCause : cause, events, credit === byId);
}

/** El compañero caído más cercano al alcance de `p`, o undefined. */
function downedMateNear(state: GameState, p: PlayerState): PlayerState | undefined {
  let best: PlayerState | undefined;
  let bestD = REVIVE_RANGE;
  for (const q of state.players) {
    if (q === p || !q.alive || !q.downed || q.team !== p.team) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

/**
 * Lo que pasa con los caídos y los que los levantan en cada tick: se
 * desangran, y el que levanta avanza si sigue al lado (moverse, disparar o
 * recibir un tiro lo corta, ver step()).
 */
function stepDowned(state: GameState, events: SimEvent[]): void {
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.reviving >= 0) {
      const target = findPlayer(state, p.reviving);
      if (
        p.downed ||
        !target ||
        !target.alive ||
        !target.downed ||
        Math.hypot(target.x - p.x, target.y - p.y) > REVIVE_RANGE + 12
      ) {
        p.reviving = -1;
      } else if (--p.reviveTicks <= 0) {
        target.downed = false;
        target.hp = REVIVE_HP;
        p.reviving = -1;
        events.push({ t: "revive", targetId: target.id, byId: p.id });
      }
    }
    if (p.downed) {
      p.hp -= DOWNED_HP / DOWNED_BLEED_TICKS;
      if (p.hp <= 0) killPlayer(state, p, p.downedBy, p.downedCause, events);
    }
  }
}

function killPlayer(
  state: GameState,
  victim: PlayerState,
  killerId: number,
  cause: number,
  events: SimEvent[],
  /** El que mata es el que pegó ahora (no un caído que se desangró): cuenta para el tiro más largo. */
  direct = false,
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
    dropItem(state, victim, ITEM_GRENADE, GRENADE_FRAG, 0, victim.grenades, events);
    victim.grenades = 0;
  }
  if (victim.smokes > 0) {
    dropItem(state, victim, ITEM_GRENADE, GRENADE_SMOKE, 0, victim.smokes, events);
    victim.smokes = 0;
  }
  if (victim.molotovs > 0) {
    dropItem(state, victim, ITEM_GRENADE, GRENADE_MOLOTOV, 0, victim.molotovs, events);
    victim.molotovs = 0;
  }
  if (victim.mines > 0) {
    dropItem(state, victim, ITEM_GRENADE, GRENADE_MINE, 2, victim.mines, events);
    victim.mines = 0;
  }
  for (let i = 0; i < victim.consumables.length; i++) {
    const count = victim.consumables[i] ?? 0;
    if (count > 0) dropItem(state, victim, ITEM_CONSUMABLE, i, i, count, events);
    victim.consumables[i] = 0;
  }
  if (victim.backpack) {
    dropItem(state, victim, ITEM_BACKPACK, 0, 2, 1, events);
    victim.backpack = false;
  }

  const killer = killerId >= 0 ? findPlayer(state, killerId) : undefined;
  if (killer && killer.id !== victim.id) {
    killer.kills++;
    // Con un arma, no con la zona ni el bombardeo: el tiro más largo es un tiro.
    // Sólo la del tiro que mató, con un arma: si se desangró mientras te ibas,
    // la distancia de ahora no es la del tiro.
    if (direct && cause >= 0) {
      killer.longestKill = Math.max(killer.longestKill, Math.hypot(killer.x - victim.x, killer.y - victim.y));
    }
  }

  // Segunda oportunidad: si murió temprano, vuelve una vez.
  const respawn = secondChanceOpen(state) && !victim.usedSecondChance && victim.connected;
  // (Se marca como usada al volver: si se cancela, no volvió.)
  if (respawn) victim.respawnTick = state.tick + RESPAWN_TICKS;

  // La recompensa por el más buscado: el que lo mata se cura entero.
  if (state.wanted?.id === victim.id) {
    state.wanted = null;
    // Si el que lo mató está caído (lo remató la zona, se desangró), no cobra.
    if (killer && killer.id !== victim.id && killer.alive && !killer.downed) {
      killer.hp = PLAYER_MAX_HP;
      events.push({ t: "bounty", byId: killer.id, targetId: victim.id });
    }
  }
  events.push({
    t: "kill",
    targetId: victim.id,
    byId: killerId,
    cause,
    ...(killer && killer.id !== victim.id && killer.alive
      ? { killerHp: Math.max(1, Math.ceil(killer.hp)), killerShield: Math.ceil(killer.shield) }
      : {}),
    ...(respawn ? { respawn: true } : {}),
  });
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
  /** Con qué se anota la muerte: CAUSE_EXPLOSION, o CAUSE_STRIKE para el bombardeo. */
  cause = CAUSE_EXPLOSION,
): void {
  events.push({ t: "explosion", x, y, byId, grenade });
  // A los compañeros no los lastima; al que la tiró, sí.
  const team = findPlayer(state, byId)?.team;

  for (const p of state.players) {
    if (!p.alive || p.airTicks > 0) continue;
    if (p.id !== byId && p.team === team) continue;
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
    applyDamage(state, p, damage, byId, cause, events);
  }

  const c = state.chicken;
  if (c) {
    const dist = Math.hypot(c.x - x, c.y - y);
    if (dist <= EXPLOSION_RADIUS && hasLineOfSight(x, y, c.x, c.y, arena)) {
      damageChicken(state, lerp(EXPLOSION_MAX_DAMAGE, EXPLOSION_MIN_DAMAGE, dist / EXPLOSION_RADIUS), byId, events);
    }
  }

  // Los barriles de alrededor también reciben: así se encadenan.
  damageBarrelsAround(state, x, y, byId, arena, events);
}

/** Scratch propio: esto corre a veces en medio del recorrido de las balas. */
const blastNearby: number[] = [];

function damageBarrelsAround(
  state: GameState,
  x: number,
  y: number,
  byId: number,
  arena: ArenaMap,
  events: SimEvent[],
): void {
  arena.grid.query(x, y, EXPLOSION_RADIUS, blastNearby);
  // Copia: cada barril que estalla vuelve a consultar la grilla.
  for (const index of [...blastNearby]) {
    const o = arena.obstacles[index]!;
    if (o.kind !== "barrel") continue;
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    const dist = Math.hypot(cx - x, cy - y);
    if (dist > EXPLOSION_RADIUS || !hasLineOfSight(x, y, cx, cy, arena)) continue;
    damageBarrel(state, index, lerp(EXPLOSION_MAX_DAMAGE, EXPLOSION_MIN_DAMAGE, dist / EXPLOSION_RADIUS), byId, arena, events);
  }
}

/**
 * Un barril recibe daño. Si se le acaba la vida, estalla como una granada y
 * queda quemado: sigue siendo cobertura pero ya no explota. El daño de la
 * explosión cuenta como del que lo hizo estallar.
 */
function damageBarrel(
  state: GameState,
  index: number,
  amount: number,
  byId: number,
  arena: ArenaMap,
  events: SimEvent[],
): void {
  if (state.explodedBarrels.includes(index)) return;
  const hp = (state.barrelHp.get(index) ?? BARREL_HP) - amount;
  if (hp > 0) {
    state.barrelHp.set(index, hp);
    return;
  }
  state.barrelHp.delete(index);
  state.explodedBarrels.push(index);
  events.push({ t: "barrel", index });
  const o = arena.obstacles[index]!;
  applyExplosion(state, o.x + o.w / 2, o.y + o.h / 2, byId, arena, events);
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

/** ¿Puede tirar una granada (o una de humo)? Curándose no: tiene las manos ocupadas. */
/** Cuántos de ese arrojable lleva. */
function throwables(p: PlayerState, kind: number): number {
  if (kind === GRENADE_SMOKE) return p.smokes;
  if (kind === GRENADE_MOLOTOV) return p.molotovs;
  if (kind === GRENADE_MINE) return p.mines;
  return p.grenades;
}

export function canThrow(p: PlayerState, kind: number = GRENADE_FRAG): boolean {
  // Caído tampoco: el servidor ni llega acá, pero la predicción del cliente sí.
  return throwables(p, kind) > 0 && p.useCd === 0 && !p.downed;
}

/** Descuenta uno del arrojable que se tiró. Lo usan el servidor y la predicción. */
export function spendThrowable(p: PlayerState, kind: number): void {
  if (kind === GRENADE_SMOKE) p.smokes--;
  else if (kind === GRENADE_MOLOTOV) p.molotovs--;
  else if (kind === GRENADE_MINE) p.mines--;
  else p.grenades--;
}

/** Qué arrojable tira cada acción. */
export function throwKind(act: number): number {
  if (act === ACT_SMOKE) return GRENADE_SMOKE;
  if (act === ACT_MOLOTOV) return GRENADE_MOLOTOV;
  if (act === ACT_MINE) return GRENADE_MINE;
  return GRENADE_FRAG;
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
      if (g.kind === GRENADE_SMOKE) {
        state.smokes.push({ id: g.id, x: g.x, y: g.y, ticksLeft: SMOKE_TICKS });
        events.push({ t: "smoke", x: g.x, y: g.y });
      } else if (g.kind === GRENADE_MOLOTOV) {
        state.fires.push({ id: g.id, ownerId: g.ownerId, x: g.x, y: g.y, ticksLeft: FIRE_TICKS });
        events.push({ t: "fire", x: g.x, y: g.y });
      } else if (g.kind === GRENADE_MINE) {
        // Se frenó: queda en el piso y se arma en un rato.
        const team = findPlayer(state, g.ownerId)?.team ?? g.ownerId;
        state.mines.push({
          id: g.id,
          ownerId: g.ownerId,
          team,
          x: g.x,
          y: g.y,
          armedAt: state.tick + MINE_ARM_TICKS,
          ticksLeft: MINE_TICKS,
        });
        events.push({ t: "mine", x: g.x, y: g.y, byId: g.ownerId });
      } else {
        applyExplosion(state, g.x, g.y, g.ownerId, arena, events, g.id);
      }
      continue;
    }
    kept.push(g);
  }

  state.grenades = kept;
}

/**
 * El fuego quema a los que están adentro, a cuenta del que tiró la molotov.
 * Sin eventos "hit" por tick (serían veinte por segundo): se ve en la vida que
 * baja y en las llamas.
 */
function stepFires(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  if (state.fires.length === 0) return;
  for (const f of state.fires) {
    f.ticksLeft--;
    const team = findPlayer(state, f.ownerId)?.team;
    for (const p of state.players) {
      if (!p.alive || p.airTicks > 0) continue;
      if (p.id !== f.ownerId && p.team === team) continue;
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      if (dx * dx + dy * dy > FIRE_RADIUS * FIRE_RADIUS) continue;
      // Las paredes frenan el fuego como frenan la vista: no quema del otro lado
      // de una casa. Detrás de una caja sí: para eso está la molotov.
      if (!hasLineOfSight(f.x, f.y, p.x, p.y, arena)) continue;
      applyDamage(state, p, FIRE_DPS * DT, f.ownerId, CAUSE_FIRE, events);
    }
  }
  state.fires = state.fires.filter((f) => f.ticksLeft > 0);
}

/**
 * Las minas armadas explotan cuando un rival pasa por encima (no uno del
 * equipo del que la puso, ni uno en paracaídas). La explosión es una de
 * granada, a cuenta del que la puso. Pasado su tiempo, se apagan solas.
 */
function stepMines(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  if (state.mines.length === 0) return;
  const kept: MineState[] = [];
  for (const m of state.mines) {
    if (--m.ticksLeft <= 0) continue;
    const armed = state.tick >= m.armedAt;
    const victim =
      armed &&
      state.players.find(
        (p) =>
          p.alive &&
          p.airTicks === 0 &&
          p.jumpTicks === 0 &&
          p.team !== m.team &&
          (p.x - m.x) * (p.x - m.x) + (p.y - m.y) * (p.y - m.y) <= MINE_TRIGGER * MINE_TRIGGER,
      );
    if (victim) {
      applyExplosion(state, m.x, m.y, m.ownerId, arena, events, -1, CAUSE_MINE);
      continue;
    }
    kept.push(m);
  }
  state.mines = kept;
}

function stepSmokes(state: GameState): void {
  if (state.smokes.length === 0) return;
  for (const s of state.smokes) s.ticksLeft--;
  state.smokes = state.smokes.filter((s) => s.ticksLeft > 0);
}

// ------------------------------------------------------------ balas

function stepBullets(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  const kept: BulletState[] = [];

  for (const b of state.bullets) {
    const dx = b.vx * DT;
    const dy = b.vy * DT;

    let bestT = 1;
    let hitPlayer: PlayerState | null = null;
    let hitChicken = false;

    // Impacto contra jugadores (test de segmento: la bala no puede atravesarlos),
    // cada uno donde lo veía el que disparó.
    for (const target of state.players) {
      // Ni al que disparó ni a sus compañeros: la bala los atraviesa. Ni al
      // que viene en paracaídas: está allá arriba.
      if (!target.alive || target.team === b.team || target.airTicks > 0) continue;
      pastPosition(target, state.tick, b.rewind, scratch);
      const t = segmentCircleT(b.x, b.y, dx, dy, scratch.x, scratch.y, PLAYER_RADIUS + BULLET_RADIUS);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = target;
      }
    }

    // La gallina, también donde la veía el que disparó.
    if (state.chicken) {
      pastPosition(state.chicken, state.tick, b.rewind, scratch);
      const t = segmentCircleT(b.x, b.y, dx, dy, scratch.x, scratch.y, CHICKEN_RADIUS + BULLET_RADIUS);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = null;
        hitChicken = true;
      }
    }

    // Impacto contra obstáculos.
    let hitBox = false;
    let boxIndex = -1;
    arena.grid.query(b.x + dx * 0.5, b.y + dy * 0.5, Math.abs(dx) + Math.abs(dy) + BULLET_RADIUS, nearby);
    nearby.sort((a, c) => a - c);
    for (let i = 0; i < nearby.length; i++) {
      const box = arena.obstacles[nearby[i]!]!;
      const t = segmentBoxT(b.x, b.y, dx, dy, BULLET_RADIUS, box);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = null;
        hitChicken = false;
        hitBox = true;
        boxIndex = nearby[i]!;
      }
    }

    const nx = b.x + dx * bestT;
    const ny = b.y + dy * bestT;

    // El cohete no pega: estalla donde toca, un poco antes de la pared para
    // que la pared no se trague su propia explosión.
    const def = weaponAt(b.weapon);
    if (def.explosive && (hitPlayer || hitChicken || hitBox || b.life <= 1 || outsideArena(nx, ny))) {
      const back = hitBox ? 10 / Math.max(1, Math.hypot(b.vx, b.vy)) : 0;
      events.push({ t: "impact", x: nx, y: ny, bullet: b.id });
      if (hitPlayer) {
        const owner = findPlayer(state, b.ownerId);
        if (owner) owner.shotsHit++;
      }
      // De lleno: estalla donde está el otro ahora, contra su costado. El impacto
      // se busca en el pasado (compensación de lag) pero el daño es del presente,
      // y si estallara donde estaba podría no tocarlo.
      const speed = Math.max(1, Math.hypot(b.vx, b.vy));
      if (hitPlayer) {
        applyExplosion(
          state,
          hitPlayer.x - (b.vx / speed) * PLAYER_RADIUS,
          hitPlayer.y - (b.vy / speed) * PLAYER_RADIUS,
          b.ownerId,
          arena,
          events,
          -1,
          b.weapon,
        );
      } else if (hitChicken && state.chicken) {
        // Lo mismo con la gallina, que corre más que nadie.
        const c = state.chicken;
        applyExplosion(
          state,
          c.x - (b.vx / speed) * CHICKEN_RADIUS,
          c.y - (b.vy / speed) * CHICKEN_RADIUS,
          b.ownerId,
          arena,
          events,
          -1,
          b.weapon,
        );
      } else {
        applyExplosion(state, nx - b.vx * back, ny - b.vy * back, b.ownerId, arena, events, -1, b.weapon);
      }
      continue;
    }

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

    if (hitChicken) {
      events.push({ t: "impact", x: nx, y: ny, bullet: b.id });
      damageChicken(state, b.damage, b.ownerId, events);
      continue;
    }

    if (hitBox) {
      events.push({ t: "impact", x: nx, y: ny, bullet: b.id });
      if (arena.obstacles[boxIndex]?.kind === "barrel") {
        damageBarrel(state, boxIndex, b.damage, b.ownerId, arena, events);
      }
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

/** ¿El punto ya está contra el muro circular de la arena? */
function outsideArena(x: number, y: number): boolean {
  const cx = x - WORLD_CENTER_X;
  const cy = y - WORLD_CENTER_Y;
  const limit = WORLD_RADIUS - BULLET_RADIUS;
  return cx * cx + cy * cy >= limit * limit;
}

// ------------------------------------------------------ paquetes aéreos

/**
 * Armas que puede traer un paquete: cualquiera menos la pistola, que es la de
 * arranque, y el lanzacohetes, que va aparte: es más raro que el resto.
 */
const ROCKET = WEAPON_IDS.indexOf("rocket");
const AIRDROP_WEAPONS = WEAPON_IDS.map((_, i) => i).filter((i) => i !== STARTING_WEAPON && i !== ROCKET);
/** Uno de cada ~8 paquetes trae el lanzacohetes (legendario) en vez de otra arma. */
const AIRDROP_ROCKET_CHANCE = 0.12;

/** Lo de una caja dorada: como un paquete aéreo, sin el lanzacohetes. */
function rollGolden(state: GameState): { state: number; items: { kind: number; ref: number; tier: number; count: number }[] } {
  const r1 = nextRandom(state.rng);
  const r2 = nextRandom(r1.state);
  const weapon = AIRDROP_WEAPONS[Math.floor(r1.value * AIRDROP_WEAPONS.length)]!;
  return {
    state: r2.state,
    items: [
      { kind: ITEM_WEAPON, ref: weapon, tier: clampTier(weapon, r2.value < 0.6 ? 3 : 4), count: 1 },
      { kind: ITEM_ARMOR, ref: ARMORS.length - 1, tier: 3, count: 1 },
      { kind: ITEM_CONSUMABLE, ref: 1, tier: 3, count: 1 },
    ],
  };
}

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

/**
 * Marca un bombardeo adentro de la zona actual, lejos de su borde, para que
 * moleste donde está la gente y no en el pasto de afuera.
 */
function launchStrike(state: GameState, events: SimEvent[]): void {
  const z = state.zone;
  const random = (): number => {
    const r = nextRandom(state.rng);
    state.rng = r.state;
    return r.value;
  };
  const angle = random() * Math.PI * 2;
  const d = Math.sqrt(random()) * Math.max(0, z.radius - STRIKE_RADIUS) * 0.8;
  const x = z.x + Math.cos(angle) * d;
  const y = z.y + Math.sin(angle) * d;
  state.strikes.push({
    id: state.nextStrikeId++,
    x,
    y,
    startTick: state.tick + STRIKE_WARN_TICKS,
    endTick: state.tick + STRIKE_WARN_TICKS + STRIKE_TICKS,
  });
  events.push({ t: "strike", x, y });
}

/**
 * Quién es el más buscado: el único primero en kills entre los que siguen en
 * pie, con al menos WANTED_MIN_KILLS. Su posición se refresca cada
 * WANTED_REVEAL_TICKS, y al aparecer uno nuevo se lo muestra en el acto.
 */
function stepWanted(state: GameState, events: SimEvent[]): void {
  let best = -1;
  let second = -1;
  let leader: PlayerState | null = null;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.kills > best) {
      second = best;
      best = p.kills;
      leader = p;
    } else if (p.kills > second) {
      second = p.kills;
    }
  }
  const current = state.wanted ? findPlayer(state, state.wanted.id) : undefined;
  // El que ya era lo sigue siendo mientras vaya primero solo.
  if (current?.alive && current === leader && best > second) {
    if (state.tick - state.wanted!.seenTick >= WANTED_REVEAL_TICKS) reveal(state, current);
    return;
  }
  // Uno nuevo, sólo si domina de verdad.
  if (leader && best >= WANTED_MIN_KILLS && best - Math.max(0, second) >= WANTED_LEAD) {
    events.push({ t: "wanted", id: leader.id });
    reveal(state, leader);
    return;
  }
  state.wanted = null;
}

function reveal(state: GameState, p: PlayerState): void {
  state.wanted = { id: p.id, x: p.x, y: p.y, seenTick: state.tick };
}

/** Cura de a poco al que está tranquilo al lado de una fogata. */
function stepCampfires(state: GameState, arena: ArenaMap): void {
  const fires = arena.campfires;
  if (!fires || fires.length === 0) return;
  for (const p of state.players) {
    if (!p.alive || p.downed || p.hp >= PLAYER_MAX_HP) continue;
    if (state.tick - p.lastHurtTick < CAMPFIRE_CALM_TICKS) continue;
    if (!nearCampfire(arena, p.x, p.y)) continue;
    const before = p.hp;
    p.hp = Math.min(PLAYER_MAX_HP, p.hp + CAMPFIRE_HEAL_PER_S * DT);
    p.healed += p.hp - before;
  }
}

/** ¿Está al alcance del calor de alguna fogata? */
export function nearCampfire(arena: ArenaMap, x: number, y: number): boolean {
  for (const f of arena.campfires ?? []) {
    const dx = f.x - x;
    const dy = f.y - y;
    if (dx * dx + dy * dy <= CAMPFIRE_RADIUS * CAMPFIRE_RADIUS) return true;
  }
  return false;
}

/** ¿El punto está bajo techo? Ahí no cae ninguna bomba. */
function underRoof(x: number, y: number, arena: ArenaMap): boolean {
  return arena.buildings.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

/** Las bombas de los bombardeos en curso, y los terminados se borran. */
function stepStrikes(state: GameState, arena: ArenaMap, events: SimEvent[]): void {
  if (state.strikes.length === 0) return;
  for (const s of state.strikes) {
    if (state.tick < s.startTick || state.tick >= s.endTick) continue;
    if ((state.tick - s.startTick) % STRIKE_BOMB_EVERY !== 0) continue;
    const a = nextRandom(state.rng);
    const b = nextRandom(a.state);
    state.rng = b.state;
    const angle = a.value * Math.PI * 2;
    const d = Math.sqrt(b.value) * STRIKE_RADIUS;
    const bx = s.x + Math.cos(angle) * d;
    const by = s.y + Math.sin(angle) * d;
    // Bajo techo no cae: la bomba que tocaría una casa revienta en el techo.
    if (underRoof(bx, by, arena)) continue;
    applyExplosion(state, bx, by, -1, arena, events, -1, CAUSE_STRIKE);
  }
  state.strikes = state.strikes.filter((s) => state.tick < s.endTick);
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
/**
 * Un paquete pedido con bengala: cae al lado del que la prendió, en el primer
 * lugar libre (anillos de 30 px, ocho direcciones, orden fijo), con el mismo
 * botín y el mismo tiempo de caída que los de la zona.
 */
function callAirdrop(state: GameState, p: PlayerState, arena: ArenaMap, events: SimEvent[]): void {
  let x = p.x;
  let y = p.y;
  search: for (let r = 40; r <= 400; r += 30) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const cx = p.x + Math.cos(a) * r;
      const cy = p.y + Math.sin(a) * r;
      if (insideArena(cx, cy, 60) && airdropClear(cx, cy, arena)) {
        x = cx;
        y = cy;
        break search;
      }
    }
  }
  state.airdrops.push({ id: state.nextAirdropId++, x, y, landTick: state.tick + AIRDROP_FALL_TICKS });
  events.push({ t: "flare", byId: p.id, x, y });
}

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
    const r3 = nextRandom(r2.state);
    state.rng = r3.state;
    const weapon =
      r3.value < AIRDROP_ROCKET_CHANCE ? ROCKET : AIRDROP_WEAPONS[Math.floor(r1.value * AIRDROP_WEAPONS.length)]!;
    const tier = clampTier(weapon, r2.value < 0.5 ? 3 : 4);

    const loot: Omit<GroundItem, "id" | "x" | "y">[] = [
      { kind: ITEM_WEAPON, count: 1, ...ruledLoot(state, { kind: ITEM_WEAPON, ref: weapon, tier }) },
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
      // A mitad de la espera, un bombardeo (en las fases del medio).
      const wait = Math.round(cfg.waitTicks * z.pace);
      if (z.phase >= STRIKE_FIRST_PHASE && z.phase <= STRIKE_LAST_PHASE && z.ticksLeft === Math.floor(wait / 2)) {
        launchStrike(state, events);
      }
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
        z.ticksLeft = next ? Math.round(next.waitTicks * z.pace) : 0;
      }
    }
  }

  const dps = (cfg ?? ZONE_PHASES[ZONE_PHASES.length - 1]!).dps;
  const damage = dps * DT;

  for (const p of state.players) {
    // En paracaídas la zona no quema: se está eligiendo dónde caer.
    if (!p.alive || p.airTicks > 0) continue;
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
    p.reviving = -1;
    p.lastHurtTick = state.tick;
    if (p.hp <= 0) downOrKill(state, p, -1, CAUSE_ZONE, events);
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
    const fromX = p.x;
    const fromY = p.y;
    const flyingAtStart = p.airTicks > 0 || p.jumpTicks > 0;

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
        // En el aire sólo se planea: ni tiros, ni granadas, ni curarse.
        const flying = p.airTicks > 0;
        stepPlayerMovement(p, one, arena);
        if (flying) continue;
        if (one.act !== 0) {
          const before = state.nextGrenadeId;
          handleAction(state, p, one.act, arena, events);
          // Como el "shot" de las balas: le dice al que la tiró cuál es la suya.
          if (state.nextGrenadeId > before) {
            const kind = state.grenades[state.grenades.length - 1]!.kind;
            events.push({ t: "throw", byId: p.id, seq: one.seq, grenade: before, kind });
          }
        }
        stepConsumable(p, one, events);
        stepWeapon(state, p, one, events);
        // Levantar a alguien es quedarse quieto a su lado sin hacer otra cosa:
        // moverse, tirar, recargar o cualquier otra acción lo corta.
        if (
          p.reviving >= 0 &&
          (one.moveX !== 0 || one.moveY !== 0 || one.shoot || one.reload || (one.act !== 0 && one.act !== ACT_PICKUP))
        ) {
          p.reviving = -1;
        }
      }
    } else if (p.airTicks > 0 || p.jumpTicks > 0) {
      fallWithoutInput(p, arena);
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
    // Lo volado (paracaídas, hongo, tirolesa) no cuenta como caminado: el
    // título de "Maratonista" es a pie.
    if (!flyingAtStart) p.traveled += Math.hypot(p.x - fromX, p.y - fromY);
  }

  // Antes de las balas: las de este tick se prueban contra la historia, y el
  // tramo más reciente es el de ahora.
  for (const p of state.players) {
    if (!p.alive) continue;
    if (!p.downed && p.airTicks === 0) autoPickup(state, p, events, arena);
    recordTrail(p, state.tick);
    p.inBush = p.airTicks === 0 && bushAt(arena, p.x, p.y);
  }

  stepDowned(state, events);
  stepSmokes(state);
  stepFires(state, arena, events);
  stepGrenades(state, arena, events);
  stepMines(state, arena, events);
  stepChicken(state, arena);
  stepBullets(state, arena, events);
  stepZone(state, arena, events);
  stepCampfires(state, arena);
  stepStrikes(state, arena, events);
  stepWanted(state, events);
  stepAirdrops(state, events);
  stepRespawns(state, arena, events);
  stepRadars(state, events);
  stepStorm(state, events);

  // Una pareja con los dos caídos ya no tiene quién la levante: se terminan.
  const standing = new Set(state.players.filter((p) => p.alive && !p.downed).map((p) => p.team));
  for (const p of state.players) {
    if (p.alive && p.downed && !standing.has(p.team)) killPlayer(state, p, p.downedBy, p.downedCause, events);
  }

  const alive = state.players.filter((p) => p.alive);
  const aliveTeams = new Set(alive.map((p) => p.team));
  // El que espera su segunda oportunidad sigue en carrera: su equipo no quedó
  // afuera, y la partida no termina mientras tanto.
  const waiting = state.players.filter((p) => !p.alive && p.respawnTick >= 0);
  for (const p of waiting) aliveTeams.add(p.team);

  // Puestos: el que cae queda detrás de todos los que siguen en pie. Se mira
  // acá y no al morir para cubrir también al que se desconecta, y para que dos
  // que caen en el mismo tick (una granada, la zona) empaten. En dúos el
  // puesto es de la pareja: se decide cuando cae el último de los dos.
  for (const p of state.players) {
    if (p.place !== 0 || p.alive) continue;
    // El que se desconecta no pasa por killPlayer: su tiempo vivo termina acá.
    if (p.diedAtTick < 0) p.diedAtTick = state.tick;
    if (!aliveTeams.has(p.team)) p.place = aliveTeams.size + 1;
  }

  // Los dos últimos (contando a los que esperan volver): un aviso, una vez, y
  // sólo si arrancaron más de dos (en un mano a mano no es noticia).
  if (!state.finalTwo && state.startTeams > 2 && aliveTeams.size === 2) {
    state.finalTwo = true;
    events.push({ t: "finalTwo" });
  }

  // Si los únicos que quedan están esperando para volver, se los espera.
  if (aliveTeams.size <= 1 && !(alive.length === 0 && waiting.length > 0)) {
    state.phase = "ended";
    state.phaseTicksLeft = ENDED_TICKS;
    state.winnerId = alive.length > 0 ? alive[0]!.id : -1;
    // Gana la pareja entera, también el que cayó antes.
    for (const p of state.players) {
      if (alive.length > 0 && p.team === alive[0]!.team && p.place >= 0) p.place = 1;
    }
  }
}
