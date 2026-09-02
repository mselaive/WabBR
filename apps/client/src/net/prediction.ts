import {
  PLAYER_MAX_HP,
  createPlayer,
  stepPlayerMovement,
  type ArenaMap,
  type PlayerInput,
  type PlayerState,
  type UnpackedPlayer,
} from "@wabbr/shared";

/** Más que esto y no vale la pena disimular: fue un teletransporte real. */
const SNAP_THRESHOLD = 60;
/** Diferencias por debajo de esto se ignoran (ruido de redondeo del snapshot). */
const IGNORE_THRESHOLD = 0.25;
/** Constante de tiempo con la que se disuelve el error de predicción. */
const ERROR_DECAY_TAU = 0.06;

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
  }

  /** Un input nuevo: se aplica ya mismo y se guarda hasta que el servidor lo confirme. */
  apply(input: PlayerInput, arena: ArenaMap): void {
    this.pending.push(input);
    stepPlayerMovement(this.state, input, arena);
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

    for (const input of this.pending) {
      stepPlayerMovement(this.state, input, arena);
    }

    const dx = prevX - this.state.x;
    const dy = prevY - this.state.y;
    const d2 = dx * dx + dy * dy;

    if (d2 > SNAP_THRESHOLD * SNAP_THRESHOLD) {
      // Respawn, empujón fuerte o desincronización grande: mostrar la verdad y listo.
      this.errX = 0;
      this.errY = 0;
    } else if (d2 > IGNORE_THRESHOLD * IGNORE_THRESHOLD) {
      // Guardamos la diferencia como offset visual y la vamos licuando.
      this.errX = dx;
      this.errY = dy;
    }
  }

  /** Posición a dibujar: la predicha más lo que queda del error, que se va a cero. */
  renderPosition(dtSeconds: number): { x: number; y: number } {
    const k = Math.exp(-dtSeconds / ERROR_DECAY_TAU);
    this.errX *= k;
    this.errY *= k;
    if (Math.abs(this.errX) < 0.05) this.errX = 0;
    if (Math.abs(this.errY) < 0.05) this.errY = 0;
    return { x: this.state.x + this.errX, y: this.state.y + this.errY };
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
