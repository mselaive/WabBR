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

/**
 * Hasta cuántos ticks atrás rebobina el servidor a los demás para ver si tu
 * bala les pegó (ver `pastPosition` en step.ts). Hace falta el atraso de la
 * interpolación (2 ticks) más el ping: 8 ticks = 400 ms alcanzan para pings de
 * hasta unos 200 ms. Más alto ayudaría a conexiones peores a costa del que
 * recibe: le pueden pegar hasta ese tiempo después de haberse cubierto.
 */
export const LAG_COMP_MAX_TICKS = 8;

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

/**
 * Granada de humo: rueda igual que la otra y en vez de estallar suelta una nube
 * que tapa la vista (no las balas). Se lleva aparte y se tira con H.
 */
export const SMOKE_MAX_STACK = 2;
/** Radio de la nube ya formada. Alcanza para tapar una calle o una puerta. */
export const SMOKE_RADIUS = 115;
/** Cuánto dura la nube: diez segundos. */
export const SMOKE_TICKS = 10 * 20;
/** Lo que tarda en formarse y en disiparse: tapa de a poco, no de golpe. */
export const SMOKE_GROW_TICKS = 15;
export const SMOKE_FADE_TICKS = 40;
/** Más cerca que esto se ven igual adentro del humo: lo tenés encima. */
export const SMOKE_SPOT_DISTANCE = 70;

// -------------------------------------------------------- paquetes aéreos

/**
 * Cuando la zona empieza a cerrarse en las primeras fases cae un paquete con
 * botín de lujo dentro de la próxima zona. Con pocos jugadores en un mapa
 * grande es lo que los junta: todos saben dónde va a caer.
 */
export const AIRDROP_PHASES = 2;
/** Lo que tarda en llegar al piso desde que se anuncia: tiempo para ir a buscarlo. */
export const AIRDROP_FALL_TICKS = 10 * TICK_RATE;

/**
 * Vida de un barril: dos o tres tiros de pistola. Al llegar a cero estalla
 * como una granada (applyExplosion) y queda quemado, todavía de cobertura.
 */
export const BARREL_HP = 30;

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

/**
 * Con pocos jugadores en un mapa pensado para 16 se camina mucho antes de
 * cruzarse con alguien. Las esperas de la zona (no las contracciones) se
 * acortan: con 2 duran ZONE_MIN_PACE de lo normal, y desde
 * ZONE_FULL_PACE_PLAYERS en adelante, lo normal.
 */
export const ZONE_MIN_PACE = 0.5;
export const ZONE_FULL_PACE_PLAYERS = 8;

// ------------------------------------------------------------ caído (dúos)

/**
 * En dúos, el que llega a cero con el compañero en pie no muere: cae. Se
 * arrastra despacio, no puede disparar ni usar nada y se desangra; el
 * compañero lo levanta quedándose a su lado con E.
 */
export const DOWNED_HP = 100;
/** Lo que tarda en desangrarse si nadie lo levanta ni lo remata: 30 segundos. */
export const DOWNED_BLEED_TICKS = 30 * 20;
/** Velocidad arrastrándose, como fracción de la normal. */
export const DOWNED_SPEED_MULT = 0.3;
/** Lo que tarda en levantarlo: cuatro segundos quieto a su lado. */
export const REVIVE_TICKS = 4 * 20;
/** A qué distancia hay que estar para levantarlo. */
export const REVIVE_RANGE = 56;
/** Con cuánta vida se levanta. */
export const REVIVE_HP = 30;

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
/**
 * Cuánto se le guarda el lugar en la partida al que se le cortó la conexión.
 * Mientras tanto su muñeco se queda quieto donde estaba (y lo pueden matar).
 * Alcanza para un corte de WiFi o un cambio de red del celular.
 */
export const RECONNECT_GRACE_MS = 15_000;
export const ROOM_CODE_LENGTH = 6;
/**
 * Versión del protocolo. Subila cuando un cliente viejo y un servidor nuevo (o
 * al revés) ya no puedan jugar juntos: el que tiene la pestaña abierta durante
 * un despliegue ve "recargá la página" en vez de un juego que falla raro.
 */
export const PROTOCOL_VERSION = 2;
export const MAX_NAME_LENGTH = 14;
