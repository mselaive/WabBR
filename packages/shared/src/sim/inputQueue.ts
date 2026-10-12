import { MAX_INPUT_BUFFER } from "../constants.js";
import type { PlayerInput } from "./types.js";

/**
 * Inputs que se dejan esperando sin hacer nada. Con más que esto, en ese tick
 * se procesa uno extra para ponerse al día.
 */
const QUEUE_TARGET = 1;

/**
 * La cola de inputs de un jugador en el servidor.
 *
 * Cada input se procesa exactamente una vez y en orden, que es lo mismo que
 * hace la predicción del cliente con ellos: así el servidor llega a la misma
 * posición y dispara en los mismos inputs, sin nada que corregir.
 *
 * - Si no llegó nada, el jugador espera. Antes se repetía el último input,
 *   pensando en paquetes perdidos, pero el WebSocket es TCP y no pierde nada:
 *   sólo los atrasa. Repetir hacía que el servidor diera un paso, o un disparo,
 *   que el cliente no había dado.
 * - Si se juntaron varios, se procesa uno extra para ponerse al día. Antes se
 *   sacaba exactamente uno por tick, y como el cliente también manda
 *   exactamente uno, cada pico de la red que juntaba inputs dejaba la cola más
 *   larga para siempre. Simulando 5 minutos de WiFi normal, el input se
 *   procesaba 200 ms después de mandarse en vez de 56; con una mala, 400 ms.
 *   Tu movimiento no lo notaba —está predicho—, pero tus disparos, tus
 *   recogidas y lo que los demás ven de vos llegaban con todo ese atraso.
 */
export class InputQueue {
  private queue: PlayerInput[] = [];
  private lastSeq = 0;
  /**
   * Ticks en que no llegó nada y que todavía se pueden recuperar. Ponerse al
   * día gasta de acá: sin este tope, un cliente modificado que mandara inputs
   * al doble de ritmo caminaría al doble de velocidad.
   */
  private credit = 0;

  /** Agrega un input. Los repetidos o fuera de orden se descartan: el seq sólo avanza. */
  push(input: PlayerInput): void {
    const tail = this.queue[this.queue.length - 1]?.seq ?? this.lastSeq;
    if (input.seq <= tail) return;
    this.queue.push(input);
    // Si la cola se desborda es que el cliente manda de más o vamos atrasados:
    // se tiran los más viejos, que ya no le importan a nadie.
    while (this.queue.length > MAX_INPUT_BUFFER) this.queue.shift();
  }

  /** Los inputs a procesar en este tick: ninguno, uno, o dos si hay atraso. */
  take(): PlayerInput[] {
    this.credit = Math.min(this.credit + 1, MAX_INPUT_BUFFER);
    const batch: PlayerInput[] = [];

    const next = this.queue.shift();
    if (next) batch.push(next);
    if (this.queue.length > QUEUE_TARGET && this.credit > 1) batch.push(this.queue.shift()!);

    this.credit -= batch.length;
    const last = batch[batch.length - 1];
    if (last) this.lastSeq = last.seq;
    return batch;
  }

  get length(): number {
    return this.queue.length;
  }

  /** Ronda nueva: el cliente vuelve a numerar desde 1. */
  clear(): void {
    this.queue.length = 0;
    this.lastSeq = 0;
    this.credit = 0;
  }
}
