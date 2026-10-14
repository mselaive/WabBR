import { describe, expect, it } from "vitest";
import { PLAYER_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid, circleHitsBox } from "./collision.js";
import { createPlayer, stepPlayerMovement } from "./step.js";
import { emptyInput, type PlayerInput } from "./types.js";

/** Una tirolesa de 600 px hacia la derecha, con una pared en el medio. */
const a = { x: WORLD_CENTER_X - 300, y: WORLD_CENTER_Y };
const b = { x: WORLD_CENTER_X + 300, y: WORLD_CENTER_Y };
const wall = { kind: "wall" as const, x: WORLD_CENTER_X - 20, y: WORLD_CENTER_Y - 200, w: 40, h: 400, variant: 0 };
const map: ArenaMap = {
  obstacles: [wall],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([wall]),
  ziplines: [{ ax: a.x, ay: a.y, bx: b.x, by: b.y }],
};

const move = (seq: number, moveX: number, moveY = 0): PlayerInput => ({ ...emptyInput(seq), moveX, moveY });

describe("las tirolesas", () => {
  it("desde un poste, caminando hacia el cable, te lleva al otro por encima de la pared", () => {
    const p = createPlayer(1, a.x, a.y);
    let t = 1;
    stepPlayerMovement(p, move(t++, 1), map);
    expect(p.zip).toBe(true);
    while (p.jumpTicks > 0) stepPlayerMovement(p, move(t++, 1), map);
    expect(p.zip).toBe(false);
    expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeLessThan(40);
    expect(circleHitsBox(p.x, p.y, PLAYER_RADIUS - 1, wall)).toBe(false);
  });

  it("caminando para otro lado, no", () => {
    const p = createPlayer(1, a.x, a.y);
    stepPlayerMovement(p, move(1, -1), map);
    stepPlayerMovement(p, move(2, 0, 1), map);
    expect(p.zip).toBe(false);
    expect(p.jumpTicks).toBe(0);
  });

  it("al llegar, seguir para el mismo lado no te devuelve; darse vuelta, sí", () => {
    const p = createPlayer(1, a.x, a.y);
    let t = 1;
    stepPlayerMovement(p, move(t++, 1), map);
    while (p.jumpTicks > 0) stepPlayerMovement(p, move(t++, 1), map);
    p.x = b.x;
    p.y = b.y;
    stepPlayerMovement(p, move(t++, 1), map);
    expect(p.jumpTicks).toBe(0);
    p.x = b.x;
    stepPlayerMovement(p, move(t++, -1), map);
    expect(p.zip).toBe(true);
    expect(p.jumpVx).toBeLessThan(0);
  });
});
