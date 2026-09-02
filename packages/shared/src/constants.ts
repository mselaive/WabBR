/**
 * Todas las constantes de simulación viven acá porque cliente y servidor
 * DEBEN correr con exactamente los mismos números: si divergen, la predicción
 * del cliente se pelea con el servidor y el juego "tironea".
 */

/** Ticks de simulación por segundo. Ver el plan: 20 Hz también acota el costo en Cloudflare. */
export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const MS_PER_TICK = 1000 / TICK_RATE;

/** Cuántos ticks atrás se dibujan las entidades remotas (interpolación). */
export const INTERP_DELAY_MS = 100;

// ---------------------------------------------------------------- mundo

/**
 * Radio de la arena. Subirlo agranda el mapa entero: el generador, el minimapa
 * y el límite de cámara salen todos de acá. Con 16 jugadores, 1500 da algo de
 * espacio para perderse sin que caminar se vuelva tedioso.
 */
export const WORLD_RADIUS = 1500;
export const WORLD_CENTER_X = 1500;
export const WORLD_CENTER_Y = 1500;
export const WORLD_SIZE = WORLD_RADIUS * 2;

// ---------------------------------------------------------------- jugador

export const PLAYER_RADIUS = 12;
export const PLAYER_SPEED = 215;
export const PLAYER_MAX_HP = 100;
export const RESPAWN_NONE = -1;

// -------------------------------------------------------------- correr

/** Multiplicador de velocidad al esprintar. */
export const SPRINT_MULT = 1.45;
export const STAMINA_MAX = 100;
/** Estamina por segundo que se gasta corriendo: da unos 3,3 s de sprint. */
export const STAMINA_DRAIN = 30;
/** Y por segundo que se recupera: 5 s para llenar de cero. */
export const STAMINA_REGEN = 20;
/**
 * Ticks de espera antes de empezar a recuperar. Sin esta pausa, dar toquecitos
 * a la tecla te deja correr para siempre.
 */
export const STAMINA_REGEN_DELAY = 20;

// ------------------------------------------------------------- granadas

export const GRENADE_RADIUS = 6;
export const GRENADE_SPEED = 420;
/** Rozamiento por tick. Junto con la velocidad da unos 350 px de alcance. */
export const GRENADE_FRICTION = 0.94;
/** Ticks hasta que estalla. Dos segundos: alcanza para devolverla. */
export const GRENADE_FUSE_TICKS = 40;
/** Cuánta velocidad conserva al rebotar contra una pared. */
export const GRENADE_BOUNCE = 0.45;
export const GRENADE_MAX_STACK = 3;

export const EXPLOSION_RADIUS = 130;
export const EXPLOSION_MAX_DAMAGE = 95;
/** Daño en el borde del radio. Entre medio interpola lineal. */
export const EXPLOSION_MIN_DAMAGE = 22;

// ---------------------------------------------------------------- arma

export const BULLET_RADIUS = 3;

// Daño, cadencia, cargador, recarga, velocidad, dispersión y alcance ahora
// viven por arma en items.ts: buscá WEAPONS.

// ---------------------------------------------------------------- zona

/**
 * Fases de la zona. `radiusFactor` es relativo a WORLD_RADIUS.
 * Cada fase espera `waitTicks` y después se contrae durante `shrinkTicks`.
 */
export interface ZonePhaseConfig {
  readonly radiusFactor: number;
  readonly waitTicks: number;
  readonly shrinkTicks: number;
  /** Daño por segundo fuera de la zona durante esta fase. */
  readonly dps: number;
}

export const ZONE_PHASES: readonly ZonePhaseConfig[] = [
  { radiusFactor: 0.62, waitTicks: 55 * TICK_RATE, shrinkTicks: 35 * TICK_RATE, dps: 2 },
  { radiusFactor: 0.38, waitTicks: 40 * TICK_RATE, shrinkTicks: 30 * TICK_RATE, dps: 4 },
  { radiusFactor: 0.2, waitTicks: 30 * TICK_RATE, shrinkTicks: 25 * TICK_RATE, dps: 7 },
  { radiusFactor: 0.08, waitTicks: 25 * TICK_RATE, shrinkTicks: 22 * TICK_RATE, dps: 11 },
  { radiusFactor: 0.0, waitTicks: 20 * TICK_RATE, shrinkTicks: 20 * TICK_RATE, dps: 16 },
];

// ---------------------------------------------------------------- partida

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const COUNTDOWN_TICKS = 5 * TICK_RATE;
/** Tiempo de la pantalla de resultado antes de volver al lobby. */
export const ENDED_TICKS = 12 * TICK_RATE;
/** Si la sala queda vacía, el DO deja de tickear después de esto. */
export const EMPTY_ROOM_SHUTDOWN_TICKS = 30 * TICK_RATE;

// ---------------------------------------------------------------- red

/** Un input más viejo que esto se descarta (anti-cheat básico / anti-lag-abuse). */
export const MAX_INPUT_BUFFER = 8;
export const ROOM_CODE_LENGTH = 6;
export const MAX_NAME_LENGTH = 14;
