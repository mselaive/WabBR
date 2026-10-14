import {
  ACT_NONE,
  ACT_PICKUP,
  ACT_SMOKE,
  ACT_MOLOTOV,
  ACT_MINE,
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
  KeyH: ACT_SMOKE,
  KeyJ: ACT_MOLOTOV,
  KeyK: ACT_MINE,
  Digit1: ACT_SLOT_0,
  Digit2: ACT_SLOT_1,
  Digit3: ACT_USE_BASE + 0, // vendas
  Digit4: ACT_USE_BASE + 1, // botiquín
  Digit5: ACT_USE_BASE + 2, // adrenalina
};

/**
 * La acción de la tecla que muestra el HUD ("1", "G", "E"...). Con esto, en una
 * pantalla táctil, tocar la ranura o la fila de la mochila hace lo mismo que
 * apretar su tecla.
 */
export function actionForKey(label: string): number | undefined {
  return ACTION_KEYS[/^\d$/.test(label) ? `Digit${label}` : `Key${label}`];
}

/** Lo que mandan los controles táctiles (ver touch.ts). */
export interface TouchState {
  /** -1/0/1 por eje, como las teclas: el servidor no acepta otra cosa. */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** Hacia dónde apunta el stick derecho, o null si nunca se tocó. */
  aim: number | null;
  shooting: boolean;
}

/** Las frases rápidas, en el orden de EMOTES. */
const EMOTE_KEYS = ["Digit6", "Digit7", "Digit8", "Digit9"];

/** Teclas de movimiento: WASD y flechas, más el layout francés por si acaso. */
const UP = new Set(["KeyW", "ArrowUp", "KeyZ"]);
const DOWN = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft", "KeyQ"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const SPRINT = new Set(["ShiftLeft", "ShiftRight"]);

/**
 * Lo que se puede pedir mirando la partida después de morir. Va como intención
 * y no como acción porque depende del modo: siguiendo a alguien, izquierda y
 * derecha cambian de jugador; en cámara libre, las mismas teclas la mueven.
 */
export type SpectateIntent = "left" | "right" | "next" | "prev" | "toggle";

const SPECTATE_KEYS: Record<string, SpectateIntent> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "toggle",
};

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
  /**
   * Muerto pero con la partida en curso: no se controla al muñeco, pero sí la
   * cámara de espectador y la tabla. Antes, al morir se apagaba todo y ni
   * siquiera se podía abrir la tabla con Tab.
   */
  watching = false;
  private spectateIntents: SpectateIntent[] = [];
  /** Se apretó F: marcar donde apunta el cursor. Se consume con takeMark(). */
  private markQueued = false;
  /** Frase rápida pedida (índice en EMOTES), o -1. */
  private emoteQueued = -1;
  /** Estado de los controles táctiles. Se suma al del teclado y el mouse. */
  readonly touch: TouchState = { moveX: 0, moveY: 0, sprint: false, aim: null, shooting: false };

  /** Una acción pedida desde afuera (un botón táctil), como si se apretara su tecla. */
  queueAction(action: number): void {
    if (this.enabled) this.pendingAction = action;
  }

  queueReload(): void {
    if (this.enabled) this.reloadQueued = true;
  }

  /** Para tocar la pantalla mirando la partida: lo mismo que las flechas o el click. */
  queueSpectate(intent: SpectateIntent): void {
    if (this.watching) this.spectateIntents.push(intent);
  }

  setScoreboard(open: boolean): void {
    this.scoreboardOpen = open;
  }

  attach(target: HTMLElement): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled && !this.watching) return;
      if (this.watching) {
        const intent = SPECTATE_KEYS[e.code];
        if (intent && !e.repeat) this.spectateIntents.push(intent);
        // Las teclas se siguen registrando: la cámara libre se mueve con ellas.
        this.keys.add(e.code);
        if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      }
      if (e.code === "Tab") {
        e.preventDefault();
        this.scoreboardOpen = true;
        return;
      }
      // Marcar se puede también muerto, mirando: el compañero sigue jugando.
      if (e.code === "KeyF" && !e.repeat) this.markQueued = true;
      // Frases rápidas: 6, 7, 8 y 9.
      const emote = EMOTE_KEYS.indexOf(e.code);
      if (emote >= 0 && !e.repeat && this.enabled) this.emoteQueued = emote;
      if (!this.enabled) return;
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
      // Volvió el mouse (una compu con pantalla táctil): manda él otra vez.
      this.touch.aim = null;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (this.watching) {
        if (e.button === 0) this.spectateIntents.push("next");
        if (e.button === 2) this.spectateIntents.push("prev");
        return;
      }
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

  /** Una frase rápida pedida desde afuera (el botón táctil). */
  queueEmote(id: number): void {
    if (this.enabled) this.emoteQueued = id;
  }

  /** La frase rápida pedida desde el último cuadro, o -1. */
  takeEmote(): number {
    const e = this.emoteQueued;
    this.emoteQueued = -1;
    return e;
  }

  /** ¿Se pidió marcar desde el último cuadro? */
  takeMark(): boolean {
    const queued = this.markQueued;
    this.markQueued = false;
    return queued;
  }

  /** Lo que se pidió mirando desde el último cuadro. Se vacía al leerlo. */
  takeSpectateIntents(): SpectateIntent[] {
    if (this.spectateIntents.length === 0) return [];
    const intents = this.spectateIntents;
    this.spectateIntents = [];
    return intents;
  }

  /** Dirección de las teclas de movimiento, -1/0/1 por eje. Para la cámara libre. */
  moveAxes(): { x: number; y: number; fast: boolean } {
    return { x: this.moveX(), y: this.moveY(), fast: this.isSprinting() };
  }

  private moveX(): number {
    return this.axis(LEFT, RIGHT) || this.touch.moveX;
  }

  private moveY(): number {
    return this.axis(UP, DOWN) || this.touch.moveY;
  }

  /** Correr se mantiene apretado, así que se lee del estado, no de un evento. */
  private isSprinting(): boolean {
    if (this.touch.sprint) return true;
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
      moveX: this.moveX(),
      moveY: this.moveY(),
      aim,
      shoot: this.shooting || this.shotQueued || this.touch.shooting,
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
    this.touch.moveX = 0;
    this.touch.moveY = 0;
    this.touch.sprint = false;
    this.touch.shooting = false;
    this.shotQueued = false;
    this.pendingAction = ACT_NONE;
  }
}
