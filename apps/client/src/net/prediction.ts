import {
  ACT_NONE,
  ACT_SMOKE,
  ACT_THROW,
  GRENADE_FRAG,
  GRENADE_SMOKE,
  PLAYER_MAX_HP,
  activeTier,
  applySelfAction,
  canThrow,
  createPlayer,
  grenadeLaunch,
  shotPellets,
  stepConsumable,
  stepPlayerMovement,
  stepWeaponState,
  type ArenaMap,
  type Pellet,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
  type UnpackedPlayer,
} from "@wabbr/shared";

/** Más que esto y no vale la pena disimular: fue un teletransporte real. */
const SNAP_THRESHOLD = 60;
/** Diferencias por debajo de esto se ignoran (ruido de redondeo del snapshot). */
const IGNORE_THRESHOLD = 0.25;
/** Constante de tiempo con la que se disuelve el error de predicción. */
const ERROR_DECAY_TAU = 0.06;

/** Un disparo propio, decidido acá sin esperar al servidor. */
export interface PredictedShot {
  /** Input que lo disparó: es lo que lo empareja con el del servidor. */
  seq: number;
  weapon: number;
  /** Rareza del arma: cambia el daño, y con él el retroceso que se siente. */
  tier: number;
  pellets: Pellet[];
}

/** Una granada tirada desde acá: con qué input y cómo sale. */
export interface PredictedThrow {
  seq: number;
  /** GRENADE_FRAG o GRENADE_SMOKE. */
  kind: number;
  launch: ReturnType<typeof grenadeLaunch>;
}

/** Los eventos que generan las funciones compartidas no le importan a la predicción. */
const discard: SimEvent[] = [];

/**
 * Predicción y reconciliación del jugador local.
 *
 * La idea: aplicar el input al toque para que moverse se sienta instantáneo, y
 * cuando llega el snapshot del servidor, volver a su posición y re-ejecutar los
 * inputs que todavía no había procesado. Si el servidor pensaba lo mismo que
 * nosotros, el resultado coincide y no se ve nada.
 */
export class Predictor {
  readonly state: PlayerState;
  private pending: PlayerInput[] = [];
  /** Corrección pendiente de absorber, para que la reconciliación no se vea como un tirón. */
  private errX = 0;
  private errY = 0;
  /**
   * Posición antes del último paso de simulación. La simulación avanza 20 veces
   * por segundo y la pantalla dibuja 60: sin interpolar entre estas dos, dos de
   * cada tres cuadros repiten la posición anterior y moverse se ve a los saltos.
   */
  private prevX = 0;
  private prevY = 0;
  /** Granada tirada en el último apply(), pendiente de que el juego la levante. */
  private thrown: PredictedThrow | null = null;
  /** Re-aplicando inputs ya dibujados: lo que salga acá no es nuevo. */
  private replaying = false;

  constructor(id: number) {
    this.state = createPlayer(id);
    this.state.alive = true;
  }

  reset(x: number, y: number): void {
    this.state.x = x;
    this.state.y = y;
    this.state.vx = 0;
    this.state.vy = 0;
    this.state.hp = PLAYER_MAX_HP;
    this.pending.length = 0;
    this.errX = 0;
    this.errY = 0;
    this.prevX = x;
    this.prevY = y;
  }

  /**
   * Un input nuevo: se aplica ya mismo y se guarda hasta que el servidor lo
   * confirme. Si con él sale un disparo, lo devuelve para dibujarlo ya.
   */
  apply(input: PlayerInput, arena: ArenaMap): PredictedShot | null {
    this.pending.push(input);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    const weapon = this.step(input, arena);
    if (weapon < 0) return null;
    return {
      seq: input.seq,
      weapon,
      tier: activeTier(this.state),
      pellets: shotPellets(this.state, weapon, input.seq),
    };
  }

  /**
   * Lo mismo que corre el servidor para este jugador en un tick, en el mismo
   * orden, menos lo que necesita el mundo (recoger, granadas). El arma va
   * incluida porque de ella depende si el disparo sale: con la cadencia, la
   * munición o la curación mal predichas, se dibujarían balas que no existen.
   */
  private step(input: PlayerInput, arena: ArenaMap): number {
    stepPlayerMovement(this.state, input, arena);
    if (input.act === ACT_THROW || input.act === ACT_SMOKE) {
      // El mismo orden que el servidor: después de moverse, antes del arma.
      const kind = input.act === ACT_SMOKE ? GRENADE_SMOKE : GRENADE_FRAG;
      if (canThrow(this.state, kind)) {
        if (kind === GRENADE_SMOKE) this.state.smokes--;
        else this.state.grenades--;
        if (!this.replaying) this.thrown = { seq: input.seq, kind, launch: grenadeLaunch(this.state) };
      }
    } else if (input.act !== ACT_NONE) {
      applySelfAction(this.state, input.act);
    }
    stepConsumable(this.state, input, discard);
    const weapon = stepWeaponState(this.state, input, discard);
    discard.length = 0;
    return weapon;
  }

  /** Llega el estado autoritativo: rebobinar y volver a aplicar lo no confirmado. */
  reconcile(server: UnpackedPlayer, arena: ArenaMap): void {
    while (this.pending.length > 0 && this.pending[0]!.seq <= server.lastSeq) {
      this.pending.shift();
    }

    const prevX = this.state.x;
    const prevY = this.state.y;

    this.state.x = server.x;
    this.state.y = server.y;
    // La estamina afecta la velocidad, así que se rebobina igual que la
    // posición: sin esto la predicción sprintaría cuando el servidor ya no.
    this.state.stamina = server.stamina;
    this.state.staminaDelay = server.staminaDelay;
    this.state.boostTicks = server.boostTicks;

    // El arma y lo que la condiciona se rebobinan igual, por el mismo motivo:
    // de esto depende si el próximo disparo sale o no.
    const s = this.state;
    s.hp = server.hp;
    s.slots[0] = server.slots[0] ?? -1;
    s.slots[1] = server.slots[1] ?? -1;
    s.slotTier[0] = server.slotTiers[0] ?? 0;
    s.slotTier[1] = server.slotTiers[1] ?? 0;
    s.activeSlot = server.activeSlot;
    s.slotAmmo[server.activeSlot] = server.ammo;
    s.slotAmmo[server.activeSlot === 0 ? 1 : 0] = server.ammoOther;
    s.consumables = [...server.consumables];
    s.useCd = server.useCd;
    s.useIndex = server.useIndex;
    s.grenades = server.grenades;
    s.smokes = server.smokes;
    s.fireCd = server.fireCd;
    s.reloadCd = server.reloadCd;

    this.replaying = true;
    for (const input of this.pending) {
      // Igual que en apply(): el tramo a interpolar es el del último paso.
      this.prevX = this.state.x;
      this.prevY = this.state.y;
      // Los disparos y granadas que salgan acá ya se dibujaron al apretar.
      this.step(input, arena);
    }
    this.replaying = false;

    const dx = prevX - this.state.x;
    const dy = prevY - this.state.y;
    const d2 = dx * dx + dy * dy;

    if (d2 > SNAP_THRESHOLD * SNAP_THRESHOLD) {
      // Respawn, empujón fuerte o desincronización grande: mostrar la verdad y listo.
      this.errX = 0;
      this.errY = 0;
      // Un teletransporte no es un tramo recorrido: si quedara el punto de
      // partida viejo, el muñeco se vería deslizar desde donde ya no está.
      this.prevX = this.state.x;
      this.prevY = this.state.y;
    } else if (d2 > IGNORE_THRESHOLD * IGNORE_THRESHOLD) {
      // Guardamos la diferencia como offset visual y la vamos licuando.
      this.errX = dx;
      this.errY = dy;
    }
  }

  /**
   * Posición a dibujar: interpolada entre el paso anterior y el actual, más lo
   * que queda del error de reconciliación, que se va licuando a cero.
   *
   * `alpha` es cuánto se avanzó del tick en curso (0 a 1). Dibujar así deja la
   * imagen hasta un tick por detrás del estado predicho —50 ms como mucho—, que
   * es imperceptible al lado del salto de dibujar sólo 20 posiciones por
   * segundo. Extrapolar hacia adelante evitaría ese retraso, pero mete el
   * muñeco dentro de las paredes cada vez que el input se corta de golpe.
   */
  renderPosition(dtSeconds: number, alpha: number): { x: number; y: number } {
    const k = Math.exp(-dtSeconds / ERROR_DECAY_TAU);
    this.errX *= k;
    this.errY *= k;
    if (Math.abs(this.errX) < 0.05) this.errX = 0;
    if (Math.abs(this.errY) < 0.05) this.errY = 0;

    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return {
      x: this.prevX + (this.state.x - this.prevX) * t + this.errX,
      y: this.prevY + (this.state.y - this.prevY) * t + this.errY,
    };
  }

  /** La granada que se tiró en el último input, si hubo una. Se vacía al leerla. */
  takeThrow(): PredictedThrow | null {
    const t = this.thrown;
    this.thrown = null;
    return t;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
