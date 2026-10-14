import { describe, expect, it } from "vitest";
import { DT, JUMP_SPEED, JUMP_TICKS, PLAYER_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { generateArena, type ArenaMap } from "../map/arena.js";
import { ObstacleGrid, circleHitsBox } from "./collision.js";
import { createPlayer, stepPlayerMovement } from "./step.js";
import { emptyInput, type PlayerInput } from "./types.js";

const pad = { x: WORLD_CENTER_X, y: WORLD_CENTER_Y };
/** Un mapa con un hongo y una pared 150 px a la derecha, en el camino del salto. */
const wall = { kind: "wall" as const, x: pad.x + 150, y: pad.y - 100, w: 30, h: 200, variant: 0 };
const map: ArenaMap = {
  obstacles: [wall],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([wall]),
  jumpPads: [pad],
};

const right = (seq: number): PlayerInput => ({ ...emptyInput(seq), moveX: 1 });

describe("hongos saltarines", () => {
  it("pisarlo te lanza para donde ibas, por encima de la pared", () => {
    const p = createPlayer(1, pad.x - 10, pad.y);
    for (let t = 1; t <= JUMP_TICKS + 2; t++) stepPlayerMovement(p, right(t), map);
    // Salió volando y pasó la pared: caminando no se puede.
    expect(p.x).toBeGreaterThan(wall.x + wall.w + PLAYER_RADIUS);
    expect(p.x - pad.x).toBeGreaterThan(JUMP_SPEED * JUMP_TICKS * DT * 0.9);
    expect(p.jumpTicks).toBe(0);
  });

  it("caminando, sin hongo, la pared frena (control)", () => {
    const noPad: ArenaMap = { ...map, jumpPads: [] };
    const p = createPlayer(1, pad.x - 10, pad.y);
    for (let t = 1; t <= JUMP_TICKS + 30; t++) stepPlayerMovement(p, right(t), noPad);
    expect(p.x).toBeLessThan(wall.x);
  });

  it("quieto, sale para donde apunta", () => {
    const p = createPlayer(1, pad.x, pad.y);
    for (let t = 1; t <= JUMP_TICKS + 1; t++) stepPlayerMovement(p, { ...emptyInput(t), aim: Math.PI / 2 }, map);
    expect(p.y - pad.y).toBeGreaterThan(300);
    expect(Math.abs(p.x - pad.x)).toBeLessThan(1);
  });

  it("caído no salta", () => {
    const p = createPlayer(1, pad.x - 5, pad.y);
    p.downed = true;
    stepPlayerMovement(p, right(1), map);
    expect(p.jumpTicks).toBe(0);
  });

  it("en el mapa de verdad hay diez, y caer de cualquiera en cualquier dirección no te deja adentro de nada", () => {
    const arena = generateArena();
    expect(arena.jumpPads).toHaveLength(10);
    for (const pad of arena.jumpPads!) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const p = createPlayer(1, pad.x, pad.y);
        for (let t = 1; t <= JUMP_TICKS + 1; t++) stepPlayerMovement(p, { ...emptyInput(t), aim: a }, arena);
        const inside = arena.obstacles.some((o) => circleHitsBox(p.x, p.y, PLAYER_RADIUS - 1, o));
        expect(inside).toBe(false);
      }
    }
  });

  it("un ángulo que no es un número no lo manda a NaN", () => {
    const p = createPlayer(1, pad.x, pad.y);
    stepPlayerMovement(p, { ...emptyInput(1), aim: Infinity }, map);
    for (let t = 2; t < 30; t++) stepPlayerMovement(p, emptyInput(t), map);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
