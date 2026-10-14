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
/** Tirar una granada de humo. */
export const ACT_SMOKE = 8;
/** Tirar una molotov. */
export const ACT_MOLOTOV = 9;

/** Causas de muerte que no son un arma, para el kill feed. */
export const CAUSE_ZONE = -1;
export const CAUSE_EXPLOSION = -2;
export const CAUSE_STRIKE = -3;
export const CAUSE_FIRE = -4;

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
  /** Granadas de humo. */
  smokes: number;
  /** Molotovs. */
  molotovs: number;
  /**
   * Caído en dúos: sigue en el mapa (`alive`) pero se arrastra y se desangra;
   * su `hp` es lo que le queda antes de morir. Ver DOWNED_*.
   */
  downed: boolean;
  /** Quién lo tiró y con qué: si se desangra, la kill es de ése. */
  downedBy: number;
  downedCause: number;
  /**
   * Volando de un hongo saltarín: ticks que le quedan y velocidad. Viajan en
   * el snapshot (la velocidad, sólo al dueño), para que la predicción vuele igual.
   */
  jumpTicks: number;
  jumpVx: number;
  jumpVy: number;
  /** Último tick en que recibió daño: la fogata sólo cura al que está tranquilo. */
  lastHurtTick: number;
  /** La kill más lejana de la partida, en px (para el premio y los récords). */
  longestKill: number;
  /** Más números para los premios de cada uno: vida curada, daño que se hizo solo, px caminados y granadas tiradas. */
  healed: number;
  selfDamage: number;
  traveled: number;
  thrown: number;
  /** A quién está levantando (id), o -1. */
  reviving: number;
  /** Ticks que le faltan para terminar de levantarlo. */
  reviveTicks: number;
  /** Ticks restantes de cooldown de disparo. */
  fireCd: number;
  /** Ticks restantes de recarga. 0 = no está recargando. */
  reloadCd: number;
  /** Último input procesado por el servidor. El cliente re-aplica desde acá. */
  lastSeq: number;
  /** Tick en que murió, para el kill feed y la cámara de espectador. -1 si vive. */
  diedAtTick: number;
  /**
   * Ticks de caída en paracaídas que le quedan (0: en el piso). En el aire
   * planea sin chocar, no puede hacer otra cosa y nadie le puede pegar.
   */
  airTicks: number;
  /** Lleva mochila: carga más curaciones y granadas (ver carryLimit). */
  backpack: boolean;
  /** Ticks de radar que le quedan (0: apagado). */
  radarTicks: number;
  /** Tick en que vuelve con la segunda oportunidad, o -1 si no está esperando. */
  respawnTick: number;
  /** Ya usó la segunda oportunidad de esta partida. */
  usedSecondChance: boolean;
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
   * Equipo. En solitario es el propio id; en dúos, el mismo para los dos
   * compañeros. Los compañeros no se lastiman y siempre se ven.
   */
  team: number;
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
  /**
   * Lo que lleva en esta sala, sumando las partidas que jugó: un marcador
   * para la noche entre amigos. Vive en la sala y se pierde al salir de ella.
   */
  played?: number;
  wins?: number;
  totalKills?: number;
  /** Apuestas de espectador acertadas (muerto, apostó por el que terminó ganando). */
  betsWon?: number;
  /** Con quién quiere jugar en dúos (id), si eligió. La pareja es mutua. */
  partner?: number;
  /** El gorro que lleva (0 la gorra de siempre). Se desbloquean con logros. */
  hat?: number;
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
  /** Equipo del que disparó: la bala atraviesa a sus compañeros. */
  team: number;
}

/** Paquete aéreo cayendo. Al tocar el piso suelta su botín y desaparece. */
export interface AirdropState {
  id: number;
  x: number;
  y: number;
  /** Tick en que aterriza. */
  landTick: number;
}

/** Un bombardeo marcado en el mapa (ver STRIKE_*). */
export interface StrikeState {
  id: number;
  x: number;
  y: number;
  /** Tick en que cae la primera bomba, y en que termina. */
  startTick: number;
  endTick: number;
}

export const GRENADE_FRAG = 0;
export const GRENADE_SMOKE = 1;
export const GRENADE_MOLOTOV = 2;

/** Un charco de fuego de molotov (ver FIRE_*). */
export interface FireState {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  ticksLeft: number;
}

/** Granada en vuelo o rodando. Rebota contra las paredes y estalla por tiempo. */
export interface GrenadeState {
  id: number;
  ownerId: number;
  /** GRENADE_FRAG estalla; GRENADE_SMOKE suelta una nube. */
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks que le quedan de mecha. */
  fuse: number;
}

/** La gallina dorada (ver CHICKEN_HP). */
export interface ChickenState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** Ticks de carrera que le quedan desde el último susto. */
  panic: number;
  /** Ticks hasta elegir otro rumbo paseando. */
  turnIn: number;
  /** Su propio azar: así no mueve el de la partida. */
  rng: number;
  /** Dónde estuvo los últimos ticks, para la compensación de lag (como los jugadores). */
  trail: number[];
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

/** Una nube de humo. Tapa la vista, no las balas. */
export interface SmokeState {
  /** El id de la granada que la soltó. */
  id: number;
  x: number;
  y: number;
  /** Ticks que le quedan. Empieza en SMOKE_TICKS. */
  ticksLeft: number;
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
  /** Nubes de humo que tapan la vista. */
  smokes: SmokeState[];
  /** Charcos de fuego. */
  fires: FireState[];
  /** 1 todos contra todos, 2 dúos. Lo elige el host en el lobby. */
  teamSize: number;
  /**
   * El que más partidas ganó en la sala (lo decide el servidor antes de
   * empezar), o -1. Como desventaja, todos lo ven en el minimapa.
   */
  championId: number;
  /** Partida de noche: se ve poco alrededor (los bots también ven menos). */
  night: boolean;
  /** Reglas especiales (ver RULES). */
  rules: number;
  /**
   * Segunda oportunidad: el que muere temprano (antes de que la zona se cierre
   * por segunda vez) vuelve una vez, con lo de arranque. Lo elige el host.
   */
  secondChance: boolean;
  /** Se empieza cayendo en paracaídas (ver AIR_TICKS). Lo elige el host. */
  skydive: boolean;
  /** La gallina dorada, mientras ande suelta. */
  chicken: ChickenState | null;
  /** Ya apareció en esta partida (aparece una sola vez). */
  chickenSpawned: boolean;
  /** Parejas elegidas en el lobby (ids). Los demás se emparejan por sorteo. */
  pairs: [number, number][];
  airdrops: AirdropState[];
  nextAirdropId: number;
  /** Bombardeos anunciados o en curso. */
  strikes: StrikeState[];
  nextStrikeId: number;
  /**
   * El más buscado y dónde se lo vio por última vez (se actualiza cada
   * WANTED_REVEAL_TICKS, no en cada tick: es una pista, no un radar). null si no hay.
   */
  wanted: { id: number; x: number; y: number; seenTick: number } | null;
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
  /** Las cajas doradas de esta partida (ids), sorteadas al empezar. */
  goldenCrates: number[];
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
      /**
       * Cómo quedó el que mató (vida y chaleco), para el resumen de "te mató
       * X". Sólo si lo mató otro jugador.
       */
      killerHp?: number;
      killerShield?: number;
      /** Vuelve con la segunda oportunidad: no quedó afuera. */
      respawn?: boolean;
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
  | { t: "throw"; byId: number; seq: number; grenade: number; kind: number }
  /** Una granada de humo soltó su nube. */
  | { t: "smoke"; x: number; y: number }
  /** Una molotov se rompió y dejó fuego. */
  | { t: "fire"; x: number; y: number }
  /** Cayó (dúos): no murió, lo puede levantar el compañero. */
  | { t: "down"; targetId: number; byId: number; cause: number }
  /** Lo levantó el compañero. */
  | { t: "revive"; targetId: number; byId: number }
  /** Aterrizó un paquete aéreo: su botín llega con eventos "drop". */
  | { t: "airdrop"; x: number; y: number }
  /** Se anunció un bombardeo: las bombas empiezan en STRIKE_WARN_TICKS. */
  | { t: "strike"; x: number; y: number }
  /** Hay un nuevo más buscado. */
  | { t: "wanted"; id: number }
  /** Alguien mató al más buscado y cobró la recompensa. */
  | { t: "bounty"; byId: number; targetId: number }
  /** Volvió con la segunda oportunidad. */
  | { t: "respawn"; id: number }
  /**
   * Una pasada del radar de alguien: dónde estaban los rivales cercanos. Sólo
   * le llega a su equipo (el servidor lo filtra).
   */
  | { t: "radar"; byId: number; team: number; pings: [number, number][] }
  /**
   * Un tiro que no se ve pero se oye: lo arma el servidor (no la simulación)
   * a partir de un "shot" detrás de una pared, con el lugar redondeado a
   * HEARD_GRID. Dice "por allá", no "acá".
   */
  | { t: "heard"; x: number; y: number; weapon: number }
  /** De noche, un relámpago: ilumina todo un instante (ver stepStorm). */
  | { t: "lightning" }
  /** Le pegaron a la gallina dorada. */
  | { t: "cluck"; x: number; y: number; byId: number }
  /** Cazaron a la gallina dorada: el botín ya está en el piso. */
  | { t: "chicken"; x: number; y: number; byId: number };
