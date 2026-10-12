import type { MatchPhase, PlayerMeta, SimEvent } from "../sim/types.js";

/**
 * Contrato cliente/servidor. Regla: los mensajes de control son objetos
 * legibles; los datos "calientes" (snapshots) van como tuplas, que es lo que
 * se manda 20 veces por segundo.
 */

// ------------------------------------------------------------ cliente -> servidor

export interface JoinMsg {
  t: "join";
  name: string;
}

export interface ReadyMsg {
  t: "ready";
  ready: boolean;
}

export interface InputMsg {
  t: "in";
  seq: number;
  /** -1 | 0 | 1 */
  mx: number;
  my: number;
  /** Ángulo de apuntado, en milirradianes, para achicar el mensaje. */
  aim: number;
  /** Bit 0 = disparar, bit 1 = recargar. */
  btn: number;
  /** Acción puntual del tick: recoger, cambiar de ranura, usar un consumible. */
  act: number;
  /**
   * Tick que tenías en pantalla, en décimas (para mandar un entero). Es lo que
   * usa la compensación de lag. Sin él, el servidor no rebobina nada.
   */
  vt?: number;
}

export interface PingMsg {
  t: "ping";
  /** Reloj del cliente; vuelve tal cual en el pong. */
  c: number;
}

/** Solo el host puede forzar el arranque sin esperar a que todos estén listos. */
export interface StartMsg {
  t: "start";
}

/** Solo el host, y sólo desde el lobby: en partida sería un arma más. */
export interface KickMsg {
  t: "kick";
  /** A quién echar. */
  id: number;
}

/** El host agrega un bot a la sala (sólo en el lobby). */
export interface AddBotMsg {
  t: "bot";
}

/** El host elige el modo (sólo en el lobby): 1 todos contra todos, 2 dúos. */
export interface ModeMsg {
  t: "mode";
  teamSize: number;
}

export type ClientMsg = JoinMsg | ReadyMsg | InputMsg | PingMsg | StartMsg | KickMsg | AddBotMsg | ModeMsg;

export const BTN_SHOOT = 1;
export const BTN_RELOAD = 2;
export const BTN_SPRINT = 4;

// ------------------------------------------------------------ servidor -> cliente

/**
 * [id, x, y, aim(mrad), hp, flags, ammo, kills, lastSeq,
 *  shield, activeSlot, slot0, slot1, ammoOtroSlot, consumiblesEmpaquetados,
 *  useCd, boostTicks, …] — la lista completa está en los índices SP_* de abajo.
 * La tupla del propio jugador trae además fireCd y reloadCd al final.
 *
 * Va como tupla y no como objeto porque esto se manda 20 veces por segundo por
 * cada jugador: las claves pesarían más que los datos.
 */
export type SnapPlayer = number[];

/**
 * [id, kills, vivo(0|1), puesto, equipo] para TODOS los jugadores, se vean o
 * no. El puesto es el de `PlayerState.place`: 0 mientras sigue en pie, -1 si no
 * jugó. El equipo, el de `PlayerState.team`: con él cada uno sabe quién es su
 * compañero en dúos.
 *
 * Va aparte de `players` porque desde que el servidor oculta lo que no ves, la
 * lista de posiciones ya no sirve para el marcador: alguien detrás de una pared
 * aparecería como muerto y con cero kills. Esto no filtra nada que no sea ya
 * público (el contador de vivos está en el HUD desde el primer día).
 */
export type SnapStanding = [number, number, number, number, number];

/**
 * [id, dañoHecho, dañoRecibido, disparos, aciertos, ticksVivo] de cada uno que
 * jugó la partida. Sólo viaja con la partida terminada: mientras se juega no le
 * sirve a nadie y el daño de los demás sería información de más.
 */
export type SnapResult = [number, number, number, number, number, number];

/**
 * [id, x, y, ticksParaAterrizar] de cada paquete aéreo cayendo. Va a todos, no
 * sólo a los que lo ven: dónde cae no es un secreto, se anuncia.
 */
export type SnapAirdrop = [number, number, number, number];

/** [id, kind, ref, tier, x, y, count] */
export type SnapItem = [number, number, number, number, number, number, number];

/** [id, x, y, fuse, kind] — la mecha se dibuja como cuenta regresiva. */
export type SnapGrenade = [number, number, number, number, number];

/**
 * [id, x, y, ticksLeft] de cada nube de humo. Van a todos: el humo se ve de
 * lejos, y es lo que explica por qué de golpe no ves a nadie.
 */
export type SnapSmoke = [number, number, number, number];

/** [id, x, y, vx, vy] — la velocidad permite extrapolar entre snapshots. */
export type SnapBullet = [number, number, number, number, number];

/** [x, y, radius, targetX, targetY, targetRadius, phase, shrinking(0|1), ticksLeft] */
export type SnapZone = [number, number, number, number, number, number, number, number, number];

/** Índices dentro de SnapPlayer, para no escribir números sueltos por ahí. */
export const SP_ID = 0;
export const SP_X = 1;
export const SP_Y = 2;
export const SP_AIM = 3;
export const SP_HP = 4;
export const SP_FLAGS = 5;
export const SP_AMMO = 6;
export const SP_KILLS = 7;
export const SP_LAST_SEQ = 8;
export const SP_SHIELD = 9;
export const SP_ACTIVE_SLOT = 10;
export const SP_SLOT_0 = 11;
export const SP_SLOT_1 = 12;
export const SP_AMMO_OTHER = 13;
export const SP_CONSUMABLES = 14;
export const SP_USE_CD = 15;
export const SP_BOOST = 16;
export const SP_USE_INDEX = 17;
export const SP_SLOT_0_TIER = 18;
export const SP_SLOT_1_TIER = 19;
export const SP_STAMINA = 20;
export const SP_STAMINA_DELAY = 21;
export const SP_GRENADES = 22;
export const SP_SMOKES = 23;
/** Sólo en la tupla del propio jugador: ver `packPlayer(p, own)`. */
export const SP_FIRE_CD = 24;
export const SP_RELOAD_CD = 25;

export const FLAG_ALIVE = 1;
export const FLAG_RELOADING = 2;
export const FLAG_CONNECTED = 4;

export interface WelcomeMsg {
  t: "welcome";
  /** Tu id de jugador en esta sala. */
  you: number;
  room: string;
  hostId: number;
  roster: PlayerMeta[];
  phase: MatchPhase;
}

export interface RosterMsg {
  t: "roster";
  roster: PlayerMeta[];
  hostId: number;
  /** Modo elegido para la próxima partida: 1 todos contra todos, 2 dúos. */
  teamSize?: number;
}

export interface SnapshotMsg {
  t: "s";
  tick: number;
  /** Reloj del servidor (ms) para estimar el offset y el jitter. */
  now: number;
  phase: MatchPhase;
  /** Ticks restantes de countdown / pantalla final. */
  left: number;
  /** Sólo los que este jugador puede ver. */
  players: SnapPlayer[];
  /** Marcador de todos, visibles o no. */
  st: SnapStanding[];
  bullets: SnapBullet[];
  /** Granadas que este jugador puede ver. */
  gr: SnapGrenade[];
  zone: SnapZone;
  alive: number;
  winner: number;
  /** Eventos ocurridos en este tick (efectos, kill feed). */
  ev?: SimEvent[];
  /** Estadísticas finales. Sólo con la partida terminada (fase "ended"). */
  res?: SnapResult[];
  /** Paquetes aéreos cayendo. Sólo cuando hay alguno. */
  ad?: SnapAirdrop[];
  /** Nubes de humo. Sólo cuando hay alguna. */
  sm?: SnapSmoke[];
}

export interface ItemsMsg {
  t: "items";
  items: SnapItem[];
  /** Ids de las cajas ya abiertas: lo único que hace falta para el que se une. */
  crates: number[];
  /** Barriles que ya estallaron (índice de obstáculo), para dibujarlos quemados. */
  barrels?: number[];
}

export interface MatchStartMsg {
  t: "start";
  seed: number;
}

export interface PongMsg {
  t: "pong";
  /** El mismo valor que mandó el cliente. */
  c: number;
  /** Reloj del servidor al responder. */
  s: number;
}

export interface ErrorMsg {
  t: "err";
  code: "room_full" | "bad_name" | "in_progress" | "bad_msg" | "kicked" | "version";
  message: string;
}

export type ServerMsg =
  | WelcomeMsg
  | RosterMsg
  | SnapshotMsg
  | ItemsMsg
  | MatchStartMsg
  | PongMsg
  | ErrorMsg;
