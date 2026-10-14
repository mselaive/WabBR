import { ACT_PICKUP } from "@wabbr/shared";
import { actionForKey, type InputController } from "./input.js";

/** Radio del recorrido de cada stick, en píxeles de pantalla. */
const STICK_RADIUS = 56;
/** Menos que esto (en fracción del radio) no cuenta: el dedo nunca está quieto. */
const DEAD_ZONE = 0.25;
/** Más que esto con el izquierdo, se corre. */
const SPRINT_AT = 0.95;
/** Más que esto con el derecho, se dispara; menos, sólo se apunta. */
const FIRE_AT = 0.55;

interface Stick {
  /** identifier del Touch que lo maneja. */
  id: number;
  originX: number;
  originY: number;
  base: HTMLElement;
  knob: HTMLElement;
}

/**
 * Controles para pantallas táctiles: dos sticks que aparecen donde apoyás el
 * dedo (el izquierdo mueve, el derecho apunta y, empujado a fondo, dispara) y
 * el mismo HUD tocable: la ranura cambia de arma, la fila de la mochila usa lo
 * suyo y el cartel de "recoger" recoge. Se encienden con el primer toque, así
 * que en una compu con mouse no aparecen nunca.
 *
 * Usa eventos táctiles y no de puntero porque cancelarlos es lo único que evita
 * que el navegador, además, simule un click del mouse: cada toque sería un tiro.
 */
export class TouchControls {
  private move: Stick | null = null;
  private aim: Stick | null = null;
  private active = false;
  private readonly layer = document.createElement("div");
  private readonly buttons = document.createElement("div");

  constructor(private readonly input: InputController) {
    this.layer.className = "touch-layer";
    this.buttons.className = "touch-buttons";
    this.buttons.append(
      this.button("Recargar", () => this.input.queueReload()),
      this.button("Tabla", () => this.input.setScoreboard(!this.input.scoreboardOpen)),
      this.button("¡GG!", () => this.input.queueEmote(0)),
    );
  }

  /**
   * `stage` recibe los sticks; los elementos del HUD, los toques de sus filas.
   * Los botones van adentro del HUD, así se esconden con él fuera de partida.
   */
  attach(
    stage: HTMLElement,
    hud: { root: HTMLElement; slots: HTMLElement; consumables: HTMLElement; pickup: HTMLElement },
  ): () => void {
    const abort = new AbortController();
    const opts = { signal: abort.signal, passive: false };
    document.body.append(this.layer);
    hud.root.append(this.buttons);
    // Cualquier toque, también en el menú: así el aviso de girar el teléfono
    // ya está cuando arranca la partida.
    window.addEventListener("touchstart", () => this.activate(), { signal: abort.signal, passive: true });

    stage.addEventListener("touchstart", (e) => this.onStart(e), opts);
    stage.addEventListener("touchmove", (e) => this.onMove(e), opts);
    stage.addEventListener("touchend", (e) => this.onEnd(e), opts);
    stage.addEventListener("touchcancel", (e) => this.onEnd(e), opts);

    // Tocar una fila del HUD es apretar la tecla que muestra.
    const byKey = (e: TouchEvent) => {
      const row = (e.target as HTMLElement).closest(".slot, .consumable");
      const label = row?.querySelector(".key")?.textContent ?? "";
      const action = actionForKey(label);
      if (action === undefined) return;
      e.preventDefault();
      this.input.queueAction(action);
    };
    hud.slots.addEventListener("touchstart", byKey, opts);
    hud.consumables.addEventListener("touchstart", byKey, opts);
    hud.pickup.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.input.queueAction(ACT_PICKUP);
      },
      opts,
    );

    return () => {
      abort.abort();
      this.layer.remove();
      this.buttons.remove();
      document.body.classList.remove("touch");
    };
  }

  private activate(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add("touch");
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    this.activate();
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < window.innerWidth / 2;
      if (this.input.watching && !this.input.enabled) {
        // Mirando: tocar a la izquierda o a la derecha cambia de jugador.
        this.input.queueSpectate(left ? "left" : "right");
        continue;
      }
      if (left && !this.move) this.move = this.makeStick(t);
      else if (!left && !this.aim) this.aim = this.makeStick(t);
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.move?.id === t.identifier) this.updateMove(t);
      if (this.aim?.id === t.identifier) this.updateAim(t);
    }
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.move?.id === t.identifier) {
        this.dropStick(this.move);
        this.move = null;
        this.input.touch.moveX = 0;
        this.input.touch.moveY = 0;
        this.input.touch.sprint = false;
      }
      if (this.aim?.id === t.identifier) {
        this.dropStick(this.aim);
        this.aim = null;
        // La puntería queda donde estaba: soltar no es mirar para otro lado.
        this.input.touch.shooting = false;
      }
    }
  }

  private updateMove(t: Touch): void {
    const s = this.move!;
    const { dx, dy, amount } = this.place(s, t);
    if (amount < DEAD_ZONE) {
      this.input.touch.moveX = 0;
      this.input.touch.moveY = 0;
      this.input.touch.sprint = false;
      return;
    }
    // Ocho direcciones, como el teclado: el servidor recibe -1, 0 o 1 por eje.
    const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const angle = (octant * Math.PI) / 4;
    this.input.touch.moveX = Math.round(Math.cos(angle));
    this.input.touch.moveY = Math.round(Math.sin(angle));
    this.input.touch.sprint = amount >= SPRINT_AT;
  }

  private updateAim(t: Touch): void {
    const s = this.aim!;
    const { dx, dy, amount } = this.place(s, t);
    if (amount < DEAD_ZONE) {
      this.input.touch.shooting = false;
      return;
    }
    this.input.touch.aim = Math.atan2(dy, dx);
    this.input.touch.shooting = amount >= FIRE_AT;
    s.knob.classList.toggle("firing", this.input.touch.shooting);
  }

  /** Mueve la perilla tras el dedo, sin salirse del recorrido. */
  private place(s: Stick, t: Touch): { dx: number; dy: number; amount: number } {
    const dx = t.clientX - s.originX;
    const dy = t.clientY - s.originY;
    const dist = Math.hypot(dx, dy);
    const k = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    s.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    return { dx, dy, amount: Math.min(1, dist / STICK_RADIUS) };
  }

  private makeStick(t: Touch): Stick {
    const base = document.createElement("div");
    base.className = "stick";
    base.style.left = `${t.clientX}px`;
    base.style.top = `${t.clientY}px`;
    const knob = document.createElement("div");
    knob.className = "stick-knob";
    base.append(knob);
    this.layer.append(base);
    return { id: t.identifier, originX: t.clientX, originY: t.clientY, base, knob };
  }

  private dropStick(s: Stick): void {
    s.base.remove();
  }

  private button(label: string, onTap: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "touch-button";
    b.textContent = label;
    b.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        onTap();
      },
      { passive: false },
    );
    return b;
  }
}
