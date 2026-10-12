import type { GroundItem } from "../items.js";

export type MatchPhase = "lobby" | "countdown" | "playing" | "ended";

/** Input de un jugador en un tick. `seq` es lo que permite la reconciliación. */
export interface PlayerInput {
  seq: number;
  /** -1, 0 o 1. Enteros para que la normalización dé lo mismo en ambos lados. */
  moveX: number;
  moveY: number;
  /** Ángulo de apuntado en radianes. */
  aim: number;
  shoot: boolean;
  reload: boolean;
  sprint: boolean;
  /**
   * Tick del servidor que el jugador tenía en pantalla al mandar este input,
   * con fracción (los demás se dibujan interpolados entre dos snapshots). Con
   * esto el servidor sabe dónde veía a los demás al disparar. -1 = sin dato.
   */
  view: number;
  /**
   * Acción puntual de este tick (ver ACT_*). Va como un número y no como bits
   * porque son excluyentes: no podés recoger y curarte en el mismo tick.
   * El WebSocket es TCP, así que no se pierde y alcanza con mandarla una vez.
   */
  act: number;
}

export const ACT_NONE = 0;
export const ACT_PICKUP = 1;
export const ACT_SLOT_0 = 2;
export const ACT_SLOT_1 = 3;
/** ACT_USE_BASE + índice de consumible. */
export const ACT_USE_BASE = 4;
/** Tirar una granada. Va después del rango de consumibles (4, 5 y 6). */
export const ACT_THROW = 7;

/** Causas de muerte que no son un arma, para el kill feed. */
export const CAUSE_ZONE = -1;
export const CAUSE_EXPLOSION = -2;

export function emptyInput(seq = 0): PlayerInput {
  return {
    seq,
    moveX: 0,
    moveY: 0,
    aim: 0,
    shoot: false,
    reload: false,
    sprint: false,
    view: -1,
    act: ACT_NONE,
  };
}

/** Estado dinámico de un jugador. Lo estático (nombre, color) va en PlayerMeta. */
export interface PlayerState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  hp: number;
  alive: boolean;
  /** Sigue en la sala. Un desconectado en partida queda como cadáver. */
  connected: boolean;
  kills: number;
  /** Índice de arma en cada ranura, -1 si está vacía. */
  slots: number[];
  /** Rareza del arma de cada ranura. Sin esto, guardar un arma la degradaría. */
  slotTier: number[];
  /** Munición en el cargador de cada ranura. */
  slotAmmo: number[];
  activeSlot: number;
  /** Barra aparte que absorbe el daño antes que la vida. */
  shield: number;
  /** Cantidad por índice de consumible. */
  consumables: number[];
  /** Ticks que faltan para terminar de usar un consumible. 0 = nada en curso. */
  useCd: number;
  /** Consumible que se está usando, -1 si ninguno. */
  useIndex: number;
  /** Ticks restantes del efecto de la adrenalina. */
  boostTicks: number;
  /**
   * Estamina para correr. Se calcula DENTRO de stepPlayerMovement porque afecta
   * la velocidad: si sólo la llevara el servidor, la predicción del cliente se
   * desviaría en cuanto se te acabara.
   */
  stamina: number;
  /** Ticks que faltan para empezar a recuperar estamina. */
  staminaDelay: number;
  grenades: number;
  /** Ticks restantes de cooldown de disparo. */
  fireCd: number;
  /** Ticks restantes de recarga. 0 = no está recargando. */
  reloadCd: number;
  /** Último input procesado por el servidor. El cliente re-aplica desde acá. */
  lastSeq: number;
  /** Tick en que murió, para el kill feed y la cámara de espectador. -1 si vive. */
  diedAtTick: number;
  killerId: number;
  /** Metido en un arbusto: ver `concealedFrom`. Se calcula en cada tick. */
  inBush: boolean;
  /** Tick del último disparo. Disparar te delata aunque estés en un arbusto. */
  lastShotTick: number;
  /**
   * Estadísticas de la partida, para el resultado final. El daño es el que de
   * verdad entró (vida más escudo, sin pasarse de lo que le quedaba al otro):
   * un escopetazo de 64 a alguien con 10 de vida cuenta 10.
   */
  damageDealt: number;
  damageTaken: number;
  /** Proyectiles disparados y los que le pegaron a alguien. La escopeta cuenta cada perdigón. */
  shotsFired: number;
  shotsHit: number;
  /**
   * Puesto final en la partida: 1 el ganador, 2 el último en caer, etc. 0
   * mientras sigue en pie y -1 si no jugó esta partida (entró a mirar).
   */
  place: number;
  /**
   * Dónde estuvo en los últimos ticks, como pares x,y en un anillo indexado por
   * tick. Es lo que permite rebobinarlo para la compensación de lag. Sólo lo
   * usa el servidor y no viaja en el snapshot.
   */
  trail: number[];
}

/** Datos estáticos del jugador: se mandan solo cuando cambia el roster. */
export interface PlayerMeta {
  id: number;
  name: string;
  /** Índice de paleta, no un color RGB: ahorra bytes y centraliza la paleta. */
  colorIndex: number;
  ready: boolean;
  /** Se le cortó la conexión y el servidor le está guardando el lugar. */
  away?: boolean;
  /** Lo maneja el servidor. */
  bot?: boolean;
}

export interface BulletState {
  id: number;
  ownerId: number;
  /** El daño viaja con la bala: si no, cambiar de arma cambiaría el de las que ya volaban. */
  damage: number;
  /** Con qué se disparó, para poder decirlo en el kill feed. */
  weapon: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks que le quedan de vida. */
  life: number;
  /**
   * Cuántos ticks atrás se rebobina a los blancos para esta bala: el atraso
   * con que el que disparó los veía. Ver `pastPosition`.
   */
  rewind: number;
}

/** Paquete aéreo cayendo. Al tocar el piso suelta su botín y desaparece. */
export interface AirdropState {
  id: number;
  x: number;
  y: number;
  /** Tick en que aterriza. */
  landTick: number;
}

/** Granada en vuelo o rodando. Rebota contra las paredes y estalla por tiempo. */
export interface GrenadeState {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks que le quedan de mecha. */
  fuse: number;
}

export interface ZoneState {
  x: number;
  y: number;
  radius: number;
  /** Índice en ZONE_PHASES. */
  phase: number;
  /** true mientras se está contrayendo. */
  shrinking: boolean;
  /** Ticks restantes de la sub-fase actual (espera o contracción). */
  ticksLeft: number;
  /** Centro y radio a los que se dirige la contracción actual. */
  targetX: number;
  targetY: number;
  targetRadius: number;
  fromRadius: number;
  fromX: number;
  fromY: number;
  /** Multiplica las esperas de cada fase: menos de 1 con pocos jugadores. */
  pace: number;
}

export interface GameState {
  tick: number;
  phase: MatchPhase;
  /** Ticks restantes de countdown / pantalla final. */
  phaseTicksLeft: number;
  players: PlayerState[];
  bullets: BulletState[];
  grenades: GrenadeState[];
  nextGrenadeId: number;
  airdrops: AirdropState[];
  nextAirdropId: number;
  /** Vida que les queda a los barriles tocados, por índice de obstáculo. */
  barrelHp: Map<number, number>;
  /** Barriles que ya estallaron, por índice de obstáculo. Quedan quemados. */
  explodedBarrels: number[];
  items: GroundItem[];
  nextItemId: number;
  /**
   * Ids de las cajas ya abiertas, en orden. Las posiciones no hacen falta: las
   * cajas son parte del mapa, que las dos puntas generan igual.
   */
  openedCrates: number[];
  zone: ZoneState;
  nextBulletId: number;
  rng: number;
  winnerId: number;
}

/** Evento producido por un tick. No es estado: se envía una vez y se olvida. */
export type SimEvent =
  | {
      t: "hit";
      x: number;
      y: number;
      targetId: number;
      byId: number;
      /** Daño aplicado, para los números flotantes. */
      amount: number;
      /** Dirección de la que vino, en radianes. */
      dir: number;
      /** Id de la bala que pegó, o -1 si fue una explosión. */
      bullet: number;
    }
  | {
      t: "kill";
      targetId: number;
      byId: number;
      /** Índice de arma, o CAUSE_ZONE / CAUSE_EXPLOSION. */
      cause: number;
    }
  | {
      t: "shot";
      x: number;
      y: number;
      aim: number;
      byId: number;
      /**
       * Input que lo disparó y qué balas salieron (`firstBullet` y las
       * siguientes, una por perdigón). Con esto el que disparó reconoce su
       * propio tiro, que ya venía dibujando desde que apretó el gatillo, y no
       * lo dibuja dos veces.
       */
      seq: number;
      firstBullet: number;
      pellets: number;
      /** Arma silenciosa: sin fogonazo ni sonido para los demás. */
      silent?: boolean;
      /** Con qué arma, para que suene como esa arma. */
      weapon: number;
    }
  | { t: "impact"; x: number; y: number; bullet: number }
  | { t: "reload"; byId: number }
  | { t: "pickup"; itemId: number; byId: number }
  | { t: "drop"; item: GroundItem }
  | { t: "heal"; byId: number; amount: number }
  | { t: "crate"; crateId: number; x: number; y: number; byId: number }
  | {
      t: "explosion";
      x: number;
      y: number;
      byId: number;
      /** Granada que estalló, o -1 si fue otra cosa. */
      grenade: number;
    }
  /** Estalló un barril (índice de obstáculo): se dibuja quemado desde ahora. */
  | { t: "barrel"; index: number }
  /** Tiró una granada: con el seq del input, el que la tiró reconoce la suya. */
  | { t: "throw"; byId: number; seq: number; grenade: number }
  /** Aterrizó un paquete aéreo: su botín llega con eventos "drop". */
  | { t: "airdrop"; x: number; y: number };
