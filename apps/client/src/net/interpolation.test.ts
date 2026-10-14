import { describe, expect, it } from "vitest";
import { createGameState, createPlayer, packSnapshotArrays, type SnapshotMsg } from "@wabbr/shared";
import { SnapshotBuffer } from "./interpolation.js";

/** Un snapshot con un solo jugador vivo en (x, 1500). */
function snapshot(tick: number, x: number, alive = true): SnapshotMsg {
  const state = createGameState(1);
  state.phase = "playing";
  state.tick = tick;
  const p = createPlayer(1, x, 1500);
  p.alive = alive;
  state.players.push(p);
  const packed = packSnapshotArrays(state);
  return {
    t: "s",
    tick,
    now: 0,
    phase: "playing",
    left: 0,
    players: packed.players,
    st: [],
    bullets: packed.bullets,
    gr: [],
    zone: packed.zone,
    alive: packed.alive,
    winner: -1,
  };
}

describe("interpolación", () => {
  it("entre dos snapshots, a mitad de camino", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, 1000), 0);
    buffer.push(snapshot(2, 1010), 50);
    expect(buffer.sample(25)!.players[0]!.x).toBeCloseTo(1005, 1);
  });

  it("un teletransporte se muestra de una, sin deslizarse", () => {
    // Volvió con la segunda oportunidad lejos de donde cayó.
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, 1000, false), 0);
    buffer.push(snapshot(2, 1800), 50);
    expect(buffer.sample(25)!.players[0]!.x).toBe(1800);

    // Y aunque los dos digan "vivo", un salto imposible tampoco se interpola.
    const jump = new SnapshotBuffer();
    jump.push(snapshot(1, 1000), 0);
    jump.push(snapshot(2, 1600), 50);
    expect(jump.sample(25)!.players[0]!.x).toBe(1600);
  });

  it("la copia para la repetición no cambia con lo que sigue llegando", () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 10; i++) buffer.push(snapshot(i + 1, 1000 + i * 10), i * 50);
    const copy = buffer.copy();
    // Llegan cuatro segundos más: al buffer vivo se le van los primeros.
    for (let i = 10; i < 100; i++) buffer.push(snapshot(i + 1, 1000 + i * 10), i * 50);
    expect(copy.sample(75)!.players[0]!.x).toBeCloseTo(1015, 1);
    expect(buffer.sample(75)!.players[0]!.x).not.toBeCloseTo(1015, 1);
  });
});
