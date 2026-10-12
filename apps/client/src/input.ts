import {
  ACT_NONE,
  ACT_PICKUP,
  ACT_SLOT_0,
  ACT_SLOT_1,
  ACT_THROW,
  ACT_USE_BASE,
  type PlayerInput,
} from "@wabbr/shared";

/** Tecla -> acción puntual. Se manda una sola vez, en el tick en que se aprieta. */
const ACTION_KEYS: Record<string, number> = {
  KeyE: ACT_PICKUP,
  KeyG: ACT_THROW,
  Digit1: ACT_SLOT_0,
  Digit2: ACT_SLOT_1,
  Digit3: ACT_USE_BASE + 0, // vendas
  Digit4: ACT_USE_BASE + 1, // botiquín
  Digit5: ACT_USE_BASE + 2, // adrenalina
};

/** Teclas de movimiento: WASD y flechas, más el layout francés por si acaso. */
const UP = new Set(["KeyW", "ArrowUp", "KeyZ"]);
const DOWN = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft", "KeyQ"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const SPRINT = new Set(["ShiftLeft", "ShiftRight"]);

export class InputController {
  private keys = new Set<string>();
  private shooting = false;
  /**
   * Se arma al apretar el botón y se consume en el próximo input. El input sale
   * cada 50 ms y un click rápido dura menos: si sólo se mirara si el botón
   * sigue apretado, ese click se perdería sin disparar.
   */
  private shotQueued = false;
  /** Se arma al apretar R y se consume en el próximo input enviado. */
  private reloadQueued = false;
  /** Última acción apretada, pendiente de mandar. */
  private pendingAction = ACT_NONE;

  /** Posición del mouse en píxeles de pantalla. */
  mouseX = 0;
  mouseY = 0;
  scoreboardOpen = false;
  /** Activo solo mientras la partida está en curso. */
  enabled = false;

  attach(target: HTMLElement): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (e.code === "Tab") {
        e.preventDefault();
        this.scoreboardOpen = true;
        return;
      }
      if (e.code === "KeyR") this.reloadQueued = true;
      // Sólo en el keydown: repetir la acción mientras la tecla está apretada
      // gastaría vendas de a montones.
      const action = ACTION_KEYS[e.code];
      if (action !== undefined && !e.repeat) this.pendingAction = action;
      this.keys.add(e.code);
      // Evitar que la página se desplace con las flechas o el espacio.
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") this.scoreboardOpen = false;
      this.keys.delete(e.code);
    };

    const onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        this.shooting = true;
        this.shotQueued = true;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.shooting = false;
    };

    // Si la ventana pierde el foco, soltar todo: si no, el personaje sigue
    // corriendo solo cuando volvés a la pestaña.
    const onBlur = () => {
      this.keys.clear();
      this.shooting = false;
      this.scoreboardOpen = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    target.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    target.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      target.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
    };
  }

  /** Correr se mantiene apretado, así que se lee del estado, no de un evento. */
  private isSprinting(): boolean {
    for (const key of this.keys) if (SPRINT.has(key)) return true;
    return false;
  }

  private axis(neg: Set<string>, pos: Set<string>): number {
    let v = 0;
    for (const key of this.keys) {
      if (neg.has(key)) v -= 1;
      if (pos.has(key)) v += 1;
    }
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  /**
   * Arma el input de este tick. `aim` viene del juego, que sabe dónde está la
   * cámara, y `view` también: es el tick del servidor que se está dibujando.
   */
  sample(seq: number, aim: number, view: number): PlayerInput {
    const input: PlayerInput = {
      seq,
      moveX: this.axis(LEFT, RIGHT),
      moveY: this.axis(UP, DOWN),
      aim,
      shoot: this.shooting || this.shotQueued,
      reload: this.reloadQueued,
      sprint: this.isSprinting(),
      view,
      act: this.pendingAction,
    };
    this.reloadQueued = false;
    this.shotQueued = false;
    this.pendingAction = ACT_NONE;
    return input;
  }

  releaseAll(): void {
    this.keys.clear();
    this.shooting = false;
    this.shotQueued = false;
    this.pendingAction = ACT_NONE;
  }
}
