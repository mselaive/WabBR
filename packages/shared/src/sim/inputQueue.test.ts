import { describe, expect, it } from "vitest";
import { MAX_INPUT_BUFFER } from "../constants.js";
import { InputQueue } from "./inputQueue.js";
import { emptyInput } from "./types.js";

const seqs = (batch: { seq: number }[]): number[] => batch.map((i) => i.seq);

describe("cola de inputs del servidor", () => {
  it("con la red pareja procesa uno por tick, en orden", () => {
    const q = new InputQueue();
    for (let seq = 1; seq <= 5; seq++) {
      q.push(emptyInput(seq));
      expect(seqs(q.take())).toEqual([seq]);
    }
  });

  it("si no llegó nada el jugador espera: no se repite el último", () => {
    // Repetirlo hacía que el servidor diera un paso, o un disparo, que el
    // cliente nunca dio.
    const q = new InputQueue();
    q.push(emptyInput(1));
    expect(seqs(q.take())).toEqual([1]);
    expect(q.take()).toEqual([]);
  });

  it("después de un pico de la red se pone al día en vez de quedar atrasado para siempre", () => {
    const q = new InputQueue();
    q.push(emptyInput(1));
    q.take();

    // 200 ms sin noticias y después llegan los cuatro inputs juntos.
    for (let i = 0; i < 4; i++) q.take();
    for (let seq = 2; seq <= 5; seq++) q.push(emptyInput(seq));

    // Siguen llegando de a uno por tick, como siempre.
    let seq = 6;
    for (let tick = 0; tick < 6; tick++) {
      q.push(emptyInput(seq++));
      q.take();
    }
    // Sacando exactamente uno por tick, la cola habría quedado en 4 para
    // siempre: 200 ms de atraso en cada disparo desde ese pico en adelante.
    expect(q.length).toBeLessThanOrEqual(1);
  });

  it("mandar inputs al doble de ritmo no te hace caminar más rápido", () => {
    // Ponerse al día sólo recupera ticks en que no llegó nada. Sin ese tope,
    // un cliente modificado se movería al doble de velocidad.
    const q = new InputQueue();
    let seq = 1;
    let processed = 0;
    for (let tick = 0; tick < 200; tick++) {
      q.push(emptyInput(seq++));
      q.push(emptyInput(seq++));
      processed += q.take().length;
    }
    expect(processed).toBe(200);
    expect(q.length).toBeLessThanOrEqual(MAX_INPUT_BUFFER);
  });

  it("descarta los repetidos y los que llegan fuera de orden", () => {
    const q = new InputQueue();
    q.push(emptyInput(2));
    q.push(emptyInput(2));
    q.push(emptyInput(1));
    expect(seqs(q.take())).toEqual([2]);
    q.push(emptyInput(2));
    expect(q.take()).toEqual([]);
  });

  it("una ronda nueva vuelve a aceptar desde el seq 1", () => {
    const q = new InputQueue();
    q.push(emptyInput(40));
    q.take();
    q.clear();
    q.push(emptyInput(1));
    expect(seqs(q.take())).toEqual([1]);
  });
});
