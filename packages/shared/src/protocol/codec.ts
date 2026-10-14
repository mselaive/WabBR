import type {
  ClientMsg,
  ServerMsg,
  SnapBullet,
  SnapGrenade,
  SnapItem,
  SnapAirdrop,
  SnapPlayer,
  SnapResult,
  SnapSmoke,
  SnapStrike,
  SnapZone,
} from "./messages.js";
import {
  FLAG_ALIVE,
  FLAG_CONNECTED,
  FLAG_DOWNED,
  FLAG_RELOADING,
  SP_ACTIVE_SLOT,
  SP_AIM,
  SP_AMMO,
  SP_AMMO_OTHER,
  SP_BOOST,
  SP_CONSUMABLES,
  SP_FIRE_CD,
  SP_FLAGS,
  SP_HP,
  SP_ID,
  SP_KILLS,
  SP_LAST_SEQ,
  SP_RELOAD_CD,
  SP_SHIELD,
  SP_SLOT_0,
  SP_SLOT_0_TIER,
  SP_SLOT_1,
  SP_SLOT_1_TIER,
  SP_GRENADES,
  SP_SMOKES,
  SP_MOLOTOVS,
  SP_JUMP,
  SP_JUMP_VX,
  SP_JUMP_VY,
  SP_REVIVE_TICKS,
  SP_REVIVING,
  SP_STAMINA,
  SP_STAMINA_DELAY,
  SP_USE_CD,
  SP_USE_INDEX,
  SP_X,
  SP_Y,
} from "./messages.js";
import { weaponAt, type GroundItem } from "../items.js";
import type {
  BulletState,
  GameState,
  GrenadeState,
  PlayerState,
  SmokeState,
  ZoneState,
} from "../sim/types.js";

/**
 * Toda la (de)serialización pasa por acá. Hoy es JSON: Cloudflare cobra por
 * CANTIDAD de mensajes, no por tamaño, así que JSON no cuesta plata. Si algún
 * día molesta el ancho de banda, se reemplaza por DataView sin tocar nada más.
 */

/** Posiciones a 0.1 px. El error es despreciable y acorta bastante el JSON. */
const P = 10;
/** Ángulos en milirradianes. */
const A = 1000;

const q = (v: number, f: number): number => Math.round(v * f) / f;
export const packAim = (rad: number): number => Math.round(rad * A);
export const unpackAim = (mrad: number): number => mrad / A;

export function encodeClient(msg: ClientMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const v = JSON.parse(raw) as ClientMsg;
    return v && typeof v === "object" && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

export function encodeServer(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const v = JSON.parse(raw) as ServerMsg;
    return v && typeof v === "object" && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ snapshots

/** Las tres cantidades de consumibles entran en un solo número (cada una < 100). */
function packConsumables(counts: number[]): number {
  const a = Math.min(99, counts[0] ?? 0);
  const b = Math.min(99, counts[1] ?? 0);
  const c = Math.min(99, counts[2] ?? 0);
  return a + b * 100 + c * 10000;
}

function unpackConsumables(v: number): number[] {
  return [v % 100, Math.floor(v / 100) % 100, Math.floor(v / 10000) % 100];
}

/**
 * `own` agrega al final los relojes del arma (cadencia y recarga). Sólo le
 * sirven al dueño, que los necesita para predecir sus propios disparos, así que
 * no se le mandan a nadie más.
 */
export function packPlayer(p: PlayerState, own = false): SnapPlayer {
  let flags = 0;
  if (p.alive) flags |= FLAG_ALIVE;
  if (p.reloadCd > 0) flags |= FLAG_RELOADING;
  if (p.connected) flags |= FLAG_CONNECTED;
  if (p.downed) flags |= FLAG_DOWNED;
  const other = p.activeSlot === 0 ? 1 : 0;
  const packed = [
    p.id,
    q(p.x, P),
    q(p.y, P),
    packAim(p.aim),
    Math.max(0, Math.ceil(p.hp)),
    flags,
    p.slotAmmo[p.activeSlot] ?? 0,
    p.kills,
    p.lastSeq,
    Math.max(0, Math.ceil(p.shield)),
    p.activeSlot,
    p.slots[0] ?? -1,
    p.slots[1] ?? -1,
    p.slotAmmo[other] ?? 0,
    packConsumables(p.consumables),
    p.useCd,
    p.boostTicks,
    p.useIndex,
    p.slotTier[0] ?? 0,
    p.slotTier[1] ?? 0,
    Math.round(p.stamina),
    p.staminaDelay,
    p.grenades,
    p.smokes,
    p.reviving,
    p.reviveTicks,
    p.molotovs,
    p.jumpTicks,
  ];
  // Del propio, además los relojes del arma y la velocidad del salto: la
  // predicción los necesita para seguir igual que el servidor.
  if (own) packed.push(p.fireCd, p.reloadCd, q(p.jumpVx, P), q(p.jumpVy, P));
  return packed;
}

export function packItem(i: GroundItem): SnapItem {
  return [i.id, i.kind, i.ref, i.tier, q(i.x, P), q(i.y, P), i.count];
}

export function unpackItem(s: SnapItem): GroundItem {
  return { id: s[0], kind: s[1], ref: s[2], tier: s[3], x: s[4], y: s[5], count: s[6] };
}

export function packGrenade(g: GrenadeState): SnapGrenade {
  return [g.id, q(g.x, P), q(g.y, P), g.fuse, g.kind];
}

export function unpackGrenade(s: SnapGrenade): UnpackedGrenade {
  return { id: s[0], x: s[1], y: s[2], fuse: s[3], kind: s[4] ?? 0 };
}

export interface UnpackedGrenade {
  id: number;
  x: number;
  y: number;
  fuse: number;
  /** GRENADE_FRAG o GRENADE_SMOKE. */
  kind: number;
}

export function packStrikes(state: GameState): SnapStrike[] {
  return state.strikes.map((s) => [
    s.id,
    q(s.x, P),
    q(s.y, P),
    Math.max(0, s.startTick - state.tick),
    Math.max(0, s.endTick - state.tick),
  ]);
}

export interface UnpackedStrike {
  id: number;
  x: number;
  y: number;
  /** Ticks hasta la primera bomba (0 si ya empezó) y hasta que termina. */
  untilStart: number;
  untilEnd: number;
}

export function unpackStrike(s: SnapStrike): UnpackedStrike {
  return { id: s[0], x: s[1], y: s[2], untilStart: s[3], untilEnd: s[4] };
}

export function packSmokes(state: GameState): SnapSmoke[] {
  return state.smokes.map((s) => [s.id, q(s.x, P), q(s.y, P), s.ticksLeft]);
}

export function unpackSmoke(s: SnapSmoke): SmokeState {
  return { id: s[0], x: s[1], y: s[2], ticksLeft: s[3] };
}

export function packBullet(b: BulletState): SnapBullet {
  const base: SnapBullet = [b.id, q(b.x, P), q(b.y, P), q(b.vx, 1), q(b.vy, 1)];
  return weaponAt(b.weapon).explosive ? [...base, 1] as SnapBullet : base;
}

export function packZone(z: ZoneState): SnapZone {
  return [
    q(z.x, P),
    q(z.y, P),
    q(z.radius, P),
    q(z.targetX, P),
    q(z.targetY, P),
    q(z.targetRadius, P),
    z.phase,
    z.shrinking ? 1 : 0,
    z.ticksLeft,
  ];
}

/** Vista del snapshot ya desempaquetada, lista para interpolar y dibujar. */
export interface SnapView {
  tick: number;
  /** Reloj local (performance-independiente) en que llegó. */
  recvAt: number;
  players: Map<number, UnpackedPlayer>;
  bullets: UnpackedBullet[];
  zone: UnpackedZone;
}

export interface UnpackedPlayer {
  id: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  alive: boolean;
  reloading: boolean;
  connected: boolean;
  ammo: number;
  kills: number;
  lastSeq: number;
  shield: number;
  activeSlot: number;
  slots: number[];
  /** Rareza del arma de cada ranura. */
  slotTiers: number[];
  ammoOther: number;
  consumables: number[];
  /** Ticks que le faltan para terminar de curarse. 0 = no está curándose. */
  useCd: number;
  /** Consumible que está usando, -1 si ninguno. */
  useIndex: number;
  boostTicks: number;
  stamina: number;
  staminaDelay: number;
  grenades: number;
  smokes: number;
  molotovs: number;
  /** Volando de un hongo: ticks que le quedan y velocidad (ésta, sólo en el propio). */
  jumpTicks: number;
  jumpVx: number;
  jumpVy: number;
  /** Caído en dúos. */
  downed: boolean;
  /** A quién está levantando (-1 si a nadie) y cuánto le falta. */
  reviving: number;
  reviveTicks: number;
  /** Ticks de cadencia y de recarga que faltan. Sólo vienen en el propio; en los demás, 0. */
  fireCd: number;
  reloadCd: number;
}

export interface UnpackedBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Un cohete: se dibuja más grande y con estela. */
  rocket: boolean;
}

export interface UnpackedZone {
  x: number;
  y: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetRadius: number;
  phase: number;
  shrinking: boolean;
  ticksLeft: number;
}

export function unpackPlayer(s: SnapPlayer): UnpackedPlayer {
  const flags = s[SP_FLAGS] ?? 0;
  return {
    id: s[SP_ID] ?? 0,
    x: s[SP_X] ?? 0,
    y: s[SP_Y] ?? 0,
    aim: unpackAim(s[SP_AIM] ?? 0),
    hp: s[SP_HP] ?? 0,
    alive: (flags & FLAG_ALIVE) !== 0,
    reloading: (flags & FLAG_RELOADING) !== 0,
    connected: (flags & FLAG_CONNECTED) !== 0,
    ammo: s[SP_AMMO] ?? 0,
    kills: s[SP_KILLS] ?? 0,
    lastSeq: s[SP_LAST_SEQ] ?? 0,
    shield: s[SP_SHIELD] ?? 0,
    activeSlot: s[SP_ACTIVE_SLOT] ?? 0,
    slots: [s[SP_SLOT_0] ?? -1, s[SP_SLOT_1] ?? -1],
    slotTiers: [s[SP_SLOT_0_TIER] ?? 0, s[SP_SLOT_1_TIER] ?? 0],
    ammoOther: s[SP_AMMO_OTHER] ?? 0,
    consumables: unpackConsumables(s[SP_CONSUMABLES] ?? 0),
    useCd: s[SP_USE_CD] ?? 0,
    useIndex: s[SP_USE_INDEX] ?? -1,
    boostTicks: s[SP_BOOST] ?? 0,
    stamina: s[SP_STAMINA] ?? 0,
    staminaDelay: s[SP_STAMINA_DELAY] ?? 0,
    grenades: s[SP_GRENADES] ?? 0,
    smokes: s[SP_SMOKES] ?? 0,
    molotovs: s[SP_MOLOTOVS] ?? 0,
    jumpTicks: s[SP_JUMP] ?? 0,
    jumpVx: s[SP_JUMP_VX] ?? 0,
    jumpVy: s[SP_JUMP_VY] ?? 0,
    downed: (flags & FLAG_DOWNED) !== 0,
    reviving: s[SP_REVIVING] ?? -1,
    reviveTicks: s[SP_REVIVE_TICKS] ?? 0,
    fireCd: s[SP_FIRE_CD] ?? 0,
    reloadCd: s[SP_RELOAD_CD] ?? 0,
  };
}

export function unpackBullet(s: SnapBullet): UnpackedBullet {
  return { id: s[0], x: s[1], y: s[2], vx: s[3], vy: s[4], rocket: s[5] === 1 };
}

export function unpackZone(s: SnapZone): UnpackedZone {
  return {
    x: s[0],
    y: s[1],
    radius: s[2],
    targetX: s[3],
    targetY: s[4],
    targetRadius: s[5],
    phase: s[6],
    shrinking: s[7] === 1,
    ticksLeft: s[8],
  };
}

export function packAirdrops(state: GameState): SnapAirdrop[] {
  return state.airdrops.map((a) => [a.id, q(a.x, P), q(a.y, P), Math.max(0, a.landTick - state.tick)]);
}

export interface UnpackedAirdrop {
  id: number;
  x: number;
  y: number;
  /** Ticks que le faltan para tocar el piso. */
  ticksLeft: number;
}

export function unpackAirdrop(s: SnapAirdrop): UnpackedAirdrop {
  return { id: s[0], x: s[1], y: s[2], ticksLeft: s[3] };
}

/** Las estadísticas de los que jugaron, para el resultado final. */
export function packResults(state: GameState): SnapResult[] {
  return state.players
    .filter((p) => p.place > 0)
    .map((p) => [
      p.id,
      Math.round(p.damageDealt),
      Math.round(p.damageTaken),
      p.shotsFired,
      p.shotsHit,
      p.diedAtTick >= 0 ? p.diedAtTick : state.tick,
      Math.round(p.longestKill),
      Math.round(p.healed),
      Math.round(p.selfDamage),
      Math.round(p.traveled),
      p.thrown,
      p.usedSecondChance ? 1 : 0,
    ]);
}

export interface UnpackedResult {
  id: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  /** Ticks que aguantó vivo desde que arrancó la partida. */
  survivedTicks: number;
  /** La kill más lejana, en px. */
  longestKill: number;
  healed: number;
  selfDamage: number;
  /** Px caminados. */
  traveled: number;
  thrown: number;
  /** Volvió con la segunda oportunidad. */
  cameBack: boolean;
}

export function unpackResult(s: SnapResult): UnpackedResult {
  return {
    id: s[0],
    damageDealt: s[1],
    damageTaken: s[2],
    shotsFired: s[3],
    shotsHit: s[4],
    survivedTicks: s[5],
    longestKill: s[6] ?? 0,
    healed: s[7] ?? 0,
    selfDamage: s[8] ?? 0,
    traveled: s[9] ?? 0,
    thrown: s[10] ?? 0,
    cameBack: s[11] === 1,
  };
}

export function packSnapshotArrays(state: GameState): {
  players: SnapPlayer[];
  bullets: SnapBullet[];
  zone: SnapZone;
  alive: number;
} {
  let alive = 0;
  const players: SnapPlayer[] = [];
  for (const p of state.players) {
    if (p.alive) alive++;
    players.push(packPlayer(p));
  }
  return {
    players,
    bullets: state.bullets.map(packBullet),
    zone: packZone(state.zone),
    alive,
  };
}
