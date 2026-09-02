import type {
  ClientMsg,
  ServerMsg,
  SnapBullet,
  SnapGrenade,
  SnapItem,
  SnapPlayer,
  SnapZone,
} from "./messages.js";
import {
  FLAG_ALIVE,
  FLAG_CONNECTED,
  FLAG_RELOADING,
  SP_ACTIVE_SLOT,
  SP_AIM,
  SP_AMMO,
  SP_AMMO_OTHER,
  SP_BOOST,
  SP_CONSUMABLES,
  SP_FLAGS,
  SP_HP,
  SP_ID,
  SP_KILLS,
  SP_LAST_SEQ,
  SP_SHIELD,
  SP_SLOT_0,
  SP_SLOT_0_TIER,
  SP_SLOT_1,
  SP_SLOT_1_TIER,
  SP_GRENADES,
  SP_STAMINA,
  SP_STAMINA_DELAY,
  SP_USE_CD,
  SP_USE_INDEX,
  SP_X,
  SP_Y,
} from "./messages.js";
import type { GroundItem } from "../items.js";
import type {
  BulletState,
  GameState,
  GrenadeState,
  PlayerState,
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

export function packPlayer(p: PlayerState): SnapPlayer {
  let flags = 0;
  if (p.alive) flags |= FLAG_ALIVE;
  if (p.reloadCd > 0) flags |= FLAG_RELOADING;
  if (p.connected) flags |= FLAG_CONNECTED;
  const other = p.activeSlot === 0 ? 1 : 0;
  return [
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
  ];
}

export function packItem(i: GroundItem): SnapItem {
  return [i.id, i.kind, i.ref, i.tier, q(i.x, P), q(i.y, P), i.count];
}

export function unpackItem(s: SnapItem): GroundItem {
  return { id: s[0], kind: s[1], ref: s[2], tier: s[3], x: s[4], y: s[5], count: s[6] };
}

export function packGrenade(g: GrenadeState): SnapGrenade {
  return [g.id, q(g.x, P), q(g.y, P), g.fuse];
}

export function unpackGrenade(s: SnapGrenade): UnpackedGrenade {
  return { id: s[0], x: s[1], y: s[2], fuse: s[3] };
}

export interface UnpackedGrenade {
  id: number;
  x: number;
  y: number;
  fuse: number;
}

export function packBullet(b: BulletState): SnapBullet {
  return [b.id, q(b.x, P), q(b.y, P), q(b.vx, 1), q(b.vy, 1)];
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
}

export interface UnpackedBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
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
  };
}

export function unpackBullet(s: SnapBullet): UnpackedBullet {
  return { id: s[0], x: s[1], y: s[2], vx: s[3], vy: s[4] };
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
