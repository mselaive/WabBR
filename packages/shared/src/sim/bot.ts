import {
  DT,
  EXPLOSION_RADIUS,
  GRENADE_FRICTION,
  GRENADE_FUSE_TICKS,
  GRENADE_MAX_STACK,
  PLAYER_RADIUS,
} from "../constants.js";
import {
  ARMORS,
  CRATE_REACH,
  ITEM_ARMOR,
  ITEM_CONSUMABLE,
  ITEM_GRENADE,
  ITEM_WEAPON,
  PICKUP_RADIUS,
  consumableAt,
  weaponStats,
  type GroundItem,
} from "../items.js";
import { lootCrates, type ArenaMap, type Obstacle } from "../map/arena.js";
import { makeRng } from "../math.js";
import { segmentBoxT } from "./collision.js";
import { findPath, navGridFor, walkableLine } from "./nav.js";
import { concealedFrom, hasLineOfSight } from "./sight.js";
import { advanceGrenade, canThrow, grenadeLaunch } from "./step.js";
import {
  ACT_NONE,
  ACT_PICKUP,
  ACT_SLOT_0,
  ACT_SLOT_1,
  ACT_THROW,
  ACT_USE_BASE,
  GRENADE_FRAG,
  type GameState,
  type PlayerInput,
  type PlayerState,
} from "./types.js";

/**
 * Bots que corre el servidor dentro de la sala, para jugar cuando son pocos o
 * para practicar solo. Mandan inputs como cualquier jugador: no hacen nada que
 * un jugador no pueda hacer, y la simulación no sabe que son bots.
 *
 * Juegan razonable sin ser perfectos: buscan cajas y armas mejores, se curan
 * cuando no hay nadie, pelean moviéndose de costado y respetan la zona. Para
 * que se les pueda ganar, tardan un poco en reaccionar al ver a alguien y
 * apuntan con un error que va cambiando.
 */
export interface BotMemory {
  random: () => number;
  seq: number;
  /**
   * A dónde va. `crate` es el índice de la caja que va a abrir e `item` el id
   * del objeto que va a buscar, o -1.
   */
  waypoint: { x: number; y: number; crate: number; item: number } | null;
  /** Lado hacia el que se corre peleando (-1 o 1) y cuánto le queda. */
  strafe: number;
  strafeTicks: number;
  /** Contra quién pelea y cuánto le falta para empezar a tirarle. */
  targetId: number;
  reaction: number;
  /** Error de puntería en radianes. Deriva despacio: no es ruido de cada tick. */
  aimError: number;
  /** Para darse cuenta de que está trabado contra una pared. */
  checkX: number;
  checkY: number;
  checkTicks: number;
  /** Ticks que le quedan caminando en una dirección al azar para destrabarse. */
  unstick: number;
  unstickAngle: number;
  /** Camino que está siguiendo hacia `pathGoal`, y cuándo recalcularlo. */
  path: { x: number; y: number }[];
  pathGoalX: number;
  pathGoalY: number;
  replanIn: number;
  /** Cajas a las que no encontró cómo llegar: no las vuelve a elegir. */
  unreachable: Set<number>;
  /** Ticks hasta volver a pensar en tirar una granada. */
  throwCd: number;
  /** Ticks en que no se acerca al blanco: acaba de tirarle una granada. */
  grenadeHold: number;
}

/** A qué distancia ve y pelea. Más que la pantalla no tiene sentido. */
const SIGHT = 700;
/** Distancia que le gusta para pelear con cada arma, por índice. */
const PREFERRED_RANGE = [260, 230, 320, 110, 480, 380];
/**
 * Búsquedas de camino por tick entre todos los bots. Al arrancar la partida
 * todos quieren su primer camino a la vez, y doce búsquedas juntas pasan los
 * 50 ms del tick. El que no entra camina derecho y prueba en el siguiente.
 */
const SEARCHES_PER_TICK = 2;
/** Cupo por partida: varias salas pueden compartir el mismo proceso. */
const budgets = new WeakMap<GameState, { tick: number; used: number }>();

export function createBotMemory(seed: number): BotMemory {
  return {
    random: makeRng(seed),
    seq: 0,
    waypoint: null,
    strafe: 1,
    strafeTicks: 0,
    targetId: -1,
    reaction: 0,
    aimError: 0,
    checkX: 0,
    checkY: 0,
    checkTicks: 0,
    unstick: 0,
    unstickAngle: 0,
    path: [],
    pathGoalX: 0,
    pathGoalY: 0,
    replanIn: 0,
    unreachable: new Set(),
    throwCd: 0,
    grenadeHold: 0,
  };
}

/** Qué tan buena es un arma, para decidir si vale la pena cambiarla: daño por tick. */
export function weaponScore(index: number, tier: number): number {
  if (index < 0) return 0;
  const def = weaponStats(index, tier);
  return (def.damage * def.pellets) / def.fireCd;
}

/** Las cajas del mapa, calculadas una vez por mapa: su índice es su id. */
const cratesByArena = new WeakMap<ArenaMap, Obstacle[]>();
function cratesOf(arena: ArenaMap): Obstacle[] {
  let crates = cratesByArena.get(arena);
  if (!crates) {
    crates = lootCrates(arena);
    cratesByArena.set(arena, crates);
  }
  return crates;
}

/** El input de un bot para este tick. */
export function botInput(state: GameState, me: PlayerState, mem: BotMemory, arena: ArenaMap): PlayerInput {
  mem.seq++;
  const crates = cratesOf(arena);
  const input: PlayerInput = {
    seq: mem.seq,
    moveX: 0,
    moveY: 0,
    aim: me.aim,
    shoot: false,
    reload: false,
    sprint: false,
    view: -1,
    act: ACT_NONE,
  };
  if (!me.alive || state.phase !== "playing") return input;

  const target = nearestEnemy(state, me, arena);
  // Curándose no se mueve ni dispara: moverse cancela la curación.
  if (me.useCd > 0 && !target) return input;

  let goal: { x: number; y: number } | null = null;

  if (target) {
    if (target.id !== mem.targetId) {
      mem.targetId = target.id;
      // Un instante para reaccionar: si dispara en el mismo tick en que te ve,
      // no hay forma de ganarle.
      mem.reaction = 7 + Math.floor(mem.random() * 9);
    }
    if (mem.reaction > 0) mem.reaction--;

    mem.aimError = mem.aimError * 0.92 + (mem.random() - 0.5) * 0.05;
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    const dist = Math.hypot(dx, dy);
    input.aim = Math.atan2(dy, dx) + mem.aimError;

    const weapon = me.slots[me.activeSlot] ?? -1;
    if (weapon >= 0) {
      const def = weaponStats(weapon, me.slotTier[me.activeSlot] ?? 0);
      const range = def.bulletSpeed * def.lifeTicks * DT * 0.9;
      // Un barril al lado en la línea de tiro estallaría encima suyo.
      input.shoot = mem.reaction === 0 && dist < range && !barrelInTheWay(state, me, target, arena);
    }

    if (mem.throwCd > 0) mem.throwCd--;
    if (mem.reaction === 0 && mem.throwCd === 0 && canThrow(me)) {
      const aim = grenadeAim(me, target, arena);
      if (aim !== null) {
        input.act = ACT_THROW;
        input.aim = aim;
        // Una cada varios segundos: tirar todas juntas es regalarlas.
        mem.throwCd = 100 + Math.floor(mem.random() * 80);
        mem.grenadeHold = GRENADE_FUSE_TICKS + 5;
      } else {
        // Probar de nuevo en un rato, no en cada tick: simular la granada cuesta.
        mem.throwCd = 8;
      }
    }

    // Pelear moviéndose: de costado, y acercándose o alejándose hasta la
    // distancia que le gusta a su arma.
    if (--mem.strafeTicks <= 0) {
      mem.strafe = mem.random() < 0.5 ? -1 : 1;
      mem.strafeTicks = 15 + Math.floor(mem.random() * 25);
    }
    const preferred = PREFERRED_RANGE[weapon] ?? 260;
    let toward = dist > preferred + 60 ? 1 : dist < preferred - 60 ? -1 : 0;
    // Recién tiró una granada: acercarse sería caminar hacia donde va a estallar.
    if (mem.grenadeHold > 0) {
      mem.grenadeHold--;
      toward = Math.min(0, toward);
    }
    const ux = dx / (dist || 1);
    const uy = dy / (dist || 1);
    goal = {
      x: me.x + (ux * toward - uy * mem.strafe) * 100,
      y: me.y + (uy * toward + ux * mem.strafe) * 100,
    };
  } else {
    mem.targetId = -1;
    const act = idleAction(state, me, crates);
    if (act !== ACT_NONE) {
      input.act = act;
      // Curarse arranca acá: quedarse quieto para no cancelarlo.
      if (act >= ACT_USE_BASE) return input;
    }
    goal = pickGoal(state, me, mem, crates);
    if (goal) input.aim = Math.atan2(goal.y - me.y, goal.x - me.x);
  }

  // La zona manda por sobre todo menos un tiro: afuera se corre para adentro.
  const zoneGoal = zonePull(state, me);
  if (zoneGoal) {
    goal = zoneGoal;
    input.sprint = me.stamina > 10;
  }

  // Una granada a punto de estallar al lado: correr, aunque sea afuera de la
  // zona. Dos segundos de zona duelen menos que una granada.
  const flee = grenadeEscape(state, me);
  if (flee) {
    goal = flee;
    input.sprint = me.stamina > 0;
  }

  // Peleando se mueve de costado a pocos pasos: eso va directo. Para todo lo
  // demás —una caja, la zona, pasear— se busca el camino.
  steer(me, mem, goal, input, target !== null && zoneGoal === null ? null : arena, state);
  return input;
}

/**
 * Hacia dónde tirar una granada para que estalle al lado del objetivo, o null
 * si no hay tiro bueno. La granada no se tira "a" un punto: sale siempre igual
 * y rueda unos 320 px, así que en vez de calcular se simula, con la misma
 * física que el servidor, desde unas pocas direcciones alrededor de la buena.
 * Así también se ve si rebota contra algo y vuelve: un bot que se granadea
 * solo no parece una persona.
 */
function grenadeAim(me: PlayerState, target: PlayerState, arena: ArenaMap): number | null {
  const base = Math.atan2(target.y - me.y, target.x - me.x);
  for (const offset of [0, -0.12, 0.12]) {
    const aim = base + offset;
    const g = grenadeLaunch({ ...me, aim });
    while (advanceGrenade(g, arena));
    const nearTarget = Math.hypot(g.x - target.x, g.y - target.y) < EXPLOSION_RADIUS * 0.55;
    const farFromMe = Math.hypot(g.x - me.x, g.y - me.y) > EXPLOSION_RADIUS + 30;
    if (nearTarget && farFromMe) return aim;
  }
  return null;
}

/**
 * A dónde correr si hay una granada cerca que va a estallar pronto, o null.
 * Se mira dónde va a quedar (rueda), no dónde está ahora.
 */
function grenadeEscape(state: GameState, me: PlayerState): { x: number; y: number } | null {
  for (const g of state.grenades) {
    if (g.kind !== GRENADE_FRAG || g.fuse > 30) continue;
    // Más o menos dónde se frena: lo que le queda de rodar con el rozamiento.
    const roll = DT / (1 - GRENADE_FRICTION);
    const gx = g.x + g.vx * roll;
    const gy = g.y + g.vy * roll;
    const dx = me.x - gx;
    const dy = me.y - gy;
    const d = Math.hypot(dx, dy);
    if (d > EXPLOSION_RADIUS + 20) continue;
    const ux = d > 1 ? dx / d : 1;
    const uy = d > 1 ? dy / d : 0;
    return { x: me.x + ux * 160, y: me.y + uy * 160 };
  }
  return null;
}

const segmentScratch: number[] = [];

/**
 * ¿Hay un barril sin estallar en la línea de tiro, tan cerca que la explosión
 * lo alcanzaría? Sin esto los bots se volaban solos: en ocho partidas de seis,
 * 27 veces se lastimaron con un barril que tenían al lado, y 4 se murieron.
 */
function barrelInTheWay(state: GameState, me: PlayerState, target: PlayerState, arena: ArenaMap): boolean {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  arena.grid.querySegment(me.x, me.y, target.x, target.y, segmentScratch);
  for (const i of segmentScratch) {
    const o = arena.obstacles[i];
    if (!o || o.kind !== "barrel" || state.explodedBarrels.includes(i)) continue;
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    if (Math.hypot(cx - me.x, cy - me.y) > EXPLOSION_RADIUS + 35) continue;
    // Con margen: la puntería del bot tiene error y la bala se abre un poco.
    if (segmentBoxT(me.x, me.y, dx, dy, 14, o) >= 0) return true;
  }
  return false;
}

function nearestEnemy(state: GameState, me: PlayerState, arena: ArenaMap): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDist = SIGHT * SIGHT;
  for (const p of state.players) {
    if (!p.alive || p.id === me.id) continue;
    const d2 = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
    if (d2 >= bestDist) continue;
    // Lo mismo que vería un jugador: ni a través de paredes ni adentro de un arbusto.
    if (concealedFrom(state, p, me.x, me.y)) continue;
    if (!hasLineOfSight(me.x, me.y, p.x, p.y, arena)) continue;
    best = p;
    bestDist = d2;
  }
  return best;
}

/**
 * Lo que hace sin nadie a la vista: curarse, recoger lo que tiene al lado o
 * abrir la caja que tiene enfrente, y sacar el arma mejor.
 */
function idleAction(state: GameState, me: PlayerState, crates: Obstacle[]): number {
  if (me.useCd > 0) return ACT_NONE;

  // Curarse con lo que corresponda: el botiquín llena todo, las vendas hasta 75.
  if (me.hp < 60 && (me.consumables[1] ?? 0) > 0) return ACT_USE_BASE + 1;
  if (me.hp < 60 && (me.consumables[0] ?? 0) > 0) return ACT_USE_BASE;

  // La misma prioridad que tryPickup: si la caja está más cerca que el objeto,
  // E abre la caja.
  const item = nearestItem(state, me, PICKUP_RADIUS - 4);
  const crate = nearestCrate(state, crates, me, CRATE_REACH - 6);
  if (crate && (!item || crate.d2 <= item.d2)) return ACT_PICKUP;
  if (item && wants(me, item.item)) return ACT_PICKUP;

  // Con nadie cerca, en la mano el arma mejor de las dos.
  const other = me.activeSlot === 0 ? 1 : 0;
  const here = weaponScore(me.slots[me.activeSlot] ?? -1, me.slotTier[me.activeSlot] ?? 0);
  const there = weaponScore(me.slots[other] ?? -1, me.slotTier[other] ?? 0);
  if (there > here) return other === 0 ? ACT_SLOT_0 : ACT_SLOT_1;

  return ACT_NONE;
}

/** ¿Le sirve este objeto? Un arma peor que la que tiene la cambiaría por nada. */
export function wants(me: PlayerState, item: GroundItem): boolean {
  if (item.kind === ITEM_WEAPON) {
    if (me.slots.includes(-1)) return true;
    const current = weaponScore(me.slots[me.activeSlot] ?? -1, me.slotTier[me.activeSlot] ?? 0);
    return weaponScore(item.ref, item.tier) > current * 1.15;
  }
  if (item.kind === ITEM_CONSUMABLE) {
    const def = consumableAt(item.ref);
    return def !== undefined && (me.consumables[item.ref] ?? 0) < def.maxStack;
  }
  // El humo no lo usan: juntarlo sería sólo sacárselo a otro.
  if (item.kind === ITEM_GRENADE) return item.ref === 0 && me.grenades < GRENADE_MAX_STACK;
  if (item.kind === ITEM_ARMOR) return (ARMORS[item.ref]?.shield ?? 0) > me.shield;
  return false;
}

function nearestItem(
  state: GameState,
  me: PlayerState,
  radius: number,
  filter: (item: GroundItem) => boolean = () => true,
): { item: GroundItem; d2: number } | null {
  let best: { item: GroundItem; d2: number } | null = null;
  for (const item of state.items) {
    const d2 = (item.x - me.x) ** 2 + (item.y - me.y) ** 2;
    if (d2 > radius * radius || (best && d2 >= best.d2) || !filter(item)) continue;
    best = { item, d2 };
  }
  return best;
}

function nearestCrate(
  state: GameState,
  crates: Obstacle[],
  from: { x: number; y: number },
  radius: number,
  skip?: Set<number>,
): { index: number; x: number; y: number; d2: number } | null {
  let best: { index: number; x: number; y: number; d2: number } | null = null;
  for (let i = 0; i < crates.length; i++) {
    if (state.openedCrates.includes(i) || skip?.has(i)) continue;
    const c = crates[i]!;
    const x = c.x + c.w / 2;
    const y = c.y + c.h / 2;
    const d2 = (x - from.x) ** 2 + (y - from.y) ** 2;
    if (d2 > radius * radius || (best && d2 >= best.d2)) continue;
    best = { index: i, x, y, d2 };
  }
  return best;
}

/** A dónde ir sin nadie a la vista: una caja cerca, algo que le sirva, o a pasear por la zona. */
function pickGoal(
  state: GameState,
  me: PlayerState,
  mem: BotMemory,
  crates: Obstacle[],
): { x: number; y: number } | null {
  // Sigue con el destino que tenía mientras valga: no llegó y, si era una caja,
  // nadie la abrió mientras tanto.
  const wp = mem.waypoint;
  if (wp) {
    const reach = wp.crate >= 0 ? CRATE_REACH - 12 : 18;
    // Si la caja ya la abrió otro, o el objeto ya lo levantó otro, no tiene
    // sentido seguir yendo.
    const gone =
      (wp.crate >= 0 && state.openedCrates.includes(wp.crate)) ||
      (wp.item >= 0 && !state.items.some((i) => i.id === wp.item));
    if (!gone && Math.hypot(wp.x - me.x, wp.y - me.y) > reach) return wp;
  }

  const crate = nearestCrate(state, crates, me, 900, mem.unreachable);
  if (crate) {
    mem.waypoint = { x: crate.x, y: crate.y, crate: crate.index, item: -1 };
    return mem.waypoint;
  }
  const item = nearestItem(state, me, 500, (i) => wants(me, i));
  if (item) {
    mem.waypoint = { x: item.item.x, y: item.item.y, crate: -1, item: item.item.id };
    return mem.waypoint;
  }

  // A pasear: un punto al azar adentro de la zona (de la próxima, si ya cierra).
  const z = state.zone;
  const cx = z.shrinking ? z.targetX : z.x;
  const cy = z.shrinking ? z.targetY : z.y;
  const r = (z.shrinking ? z.targetRadius : z.radius) * 0.6;
  const angle = mem.random() * Math.PI * 2;
  const d = Math.sqrt(mem.random()) * r;
  mem.waypoint = { x: cx + Math.cos(angle) * d, y: cy + Math.sin(angle) * d, crate: -1, item: -1 };
  return mem.waypoint;
}

/** Si está afuera de la zona, o por quedar afuera de la próxima, hacia dónde correr. */
function zonePull(state: GameState, me: PlayerState): { x: number; y: number } | null {
  const z = state.zone;
  if (Math.hypot(me.x - z.x, me.y - z.y) > z.radius - 50) return { x: z.x, y: z.y };
  if (z.shrinking && Math.hypot(me.x - z.targetX, me.y - z.targetY) > z.targetRadius - 40) {
    return { x: z.targetX, y: z.targetY };
  }
  return null;
}

/**
 * Convierte el objetivo en teclas (-1/0/1 por eje, como un jugador). Si lleva
 * un rato sin avanzar es que está trabado contra algo: camina un poco hacia un
 * lado al azar y elige otro destino.
 */
function steer(
  me: PlayerState,
  mem: BotMemory,
  goal: { x: number; y: number } | null,
  input: PlayerInput,
  /** Con el mapa, busca el camino; sin él, va en línea recta. */
  arena: ArenaMap | null,
  state: GameState,
): void {
  let angle: number | null = null;
  const next = goal && arena ? nextStep(me, mem, goal, arena, state) : goal;

  if (mem.unstick > 0) {
    mem.unstick--;
    angle = mem.unstickAngle;
  } else if (next && Math.hypot(next.x - me.x, next.y - me.y) > PLAYER_RADIUS) {
    angle = Math.atan2(next.y - me.y, next.x - me.x);
  }
  if (angle === null) return;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  input.moveX = Math.abs(cos) > 0.38 ? Math.sign(cos) : 0;
  input.moveY = Math.abs(sin) > 0.38 ? Math.sign(sin) : 0;
  if (!input.sprint && goal && Math.hypot(goal.x - me.x, goal.y - me.y) > 350 && me.stamina > 50) {
    input.sprint = true;
  }

  if (++mem.checkTicks >= 12) {
    const moved = Math.hypot(me.x - mem.checkX, me.y - mem.checkY);
    mem.checkX = me.x;
    mem.checkY = me.y;
    mem.checkTicks = 0;
    if (moved < 8 && mem.unstick === 0) {
      mem.unstick = 10 + Math.floor(mem.random() * 10);
      mem.unstickAngle = angle + Math.PI / 2 + (mem.random() - 0.5) * Math.PI;
      mem.waypoint = null;
      mem.path = [];
    }
  }
}

/**
 * El próximo punto hacia `goal`. Si se ve en línea recta, directo; si no, el
 * siguiente punto del camino, que se recalcula si el destino cambió o cada
 * tanto (los demás se mueven, las cajas se abren).
 */
function nextStep(
  me: PlayerState,
  mem: BotMemory,
  goal: { x: number; y: number },
  arena: ArenaMap,
  state: GameState,
): { x: number; y: number } {
  const grid = navGridFor(arena);
  if (walkableLine(grid, me.x, me.y, goal.x, goal.y)) {
    mem.path = [];
    return goal;
  }

  // El centro de la zona se corre de a poco mientras cierra: replanear por
  // cada paso sería buscar el camino casi en cada tick.
  const moved = Math.hypot(goal.x - mem.pathGoalX, goal.y - mem.pathGoalY) > 120;
  let budget = budgets.get(state);
  if (!budget) {
    budget = { tick: -1, used: 0 };
    budgets.set(state, budget);
  }
  if (budget.tick !== state.tick) {
    budget.tick = state.tick;
    budget.used = 0;
  }
  if ((moved || mem.replanIn <= 0) && budget.used >= SEARCHES_PER_TICK) {
    // Sin cupo este tick: seguir con lo que tenía, o derecho.
    return mem.path[0] ?? goal;
  }
  if (moved || mem.replanIn <= 0) {
    budget.used++;
    const path = findPath(grid, me.x, me.y, goal.x, goal.y);
    mem.pathGoalX = goal.x;
    mem.pathGoalY = goal.y;
    mem.replanIn = 30 + Math.floor(mem.random() * 20);
    if (!path) {
      // No hay forma de llegar (un punto al azar que cayó encerrado, una caja
      // con el paso tapado): se elige otro destino, y si era una caja, no se la
      // vuelve a elegir. Sin esto se reintentaba la búsqueda en cada tick.
      if (mem.waypoint && mem.waypoint.crate >= 0) mem.unreachable.add(mem.waypoint.crate);
      mem.path = [];
      mem.waypoint = null;
      return goal;
    }
    mem.path = path;
  }
  mem.replanIn--;

  while (mem.path.length > 1 && Math.hypot(mem.path[0]!.x - me.x, mem.path[0]!.y - me.y) < 16) {
    mem.path.shift();
  }
  return mem.path[0] ?? goal;
}
