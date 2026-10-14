import { describe, expect, it } from "vitest";
import { JUMP_TICKS, PLAYER_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y, WORLD_RADIUS } from "../constants.js";
import { MAPS, buildingInterior, getArena, lootCrates, mapArena, spawnPoint, type ArenaMap } from "../map/arena.js";
import { circleHitsBox, insideArena } from "./collision.js";
import { findPath, navGridFor } from "./nav.js";
import { createPlayer, stepPlayerMovement } from "./step.js";
import { emptyInput } from "./types.js";

/** Las celdas de 10 px que se pueden pisar desde la aparición, por inundación. */
function reachable(map: ArenaMap): (x: number, y: number) => boolean {
  const cell = 10;
  const min = WORLD_CENTER_X - WORLD_RADIUS;
  const n = Math.ceil((WORLD_RADIUS * 2) / cell);
  const walkable = new Uint8Array(n * n);
  const near: number[] = [];
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const x = min + gx * cell + cell / 2;
      const y = min + gy * cell + cell / 2;
      if (!insideArena(x, y, PLAYER_RADIUS)) continue;
      map.grid.query(x, y, PLAYER_RADIUS, near);
      if (!near.some((i) => circleHitsBox(x, y, PLAYER_RADIUS, map.obstacles[i]!))) walkable[gy * n + gx] = 1;
    }
  }
  const index = (x: number, y: number): number => Math.floor((y - min) / cell) * n + Math.floor((x - min) / cell);
  const seen = new Uint8Array(n * n);
  const spawn = spawnPoint(0, 8, 4242, map);
  const queue = [index(spawn.x, spawn.y)];
  seen[queue[0]!] = 1;
  while (queue.length > 0) {
    const at = queue.pop()!;
    const gx = at % n;
    const gy = Math.floor(at / n);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const i = ny * n + nx;
      if (seen[i] || !walkable[i]) continue;
      seen[i] = 1;
      queue.push(i);
    }
  }
  return (x, y) => seen[index(x, y)] === 1;
}

describe("los mapas de \"Nuevo cada partida\"", () => {
  it("el primero es el de siempre, y no se repiten", () => {
    expect(mapArena(0)).toBe(getArena());
    expect(new Set(MAPS.map((m) => m.seed)).size).toBe(MAPS.length);
    expect(new Set(MAPS.map((m) => m.name)).size).toBe(MAPS.length);
  });

  // Uno por uno: un mapa roto arruina la partida del que cae ahí, y a ojo no se ve.
  for (const [index, { name }] of MAPS.entries()) {
    it(`${name}: tiene de todo, se entra a todas las casas, los bots llegan a las cajas y los saltos caen bien`, () => {
      const map = mapArena(index);
      expect(map.districts.filter((d) => !d.minor)).toHaveLength(6);
      expect(map.buildings.length).toBeGreaterThanOrEqual(6);
      expect(map.campfires!.length).toBeGreaterThanOrEqual(4);
      expect(map.jumpPads).toHaveLength(10);
      const kinds = new Set(map.obstacles.map((o) => o.kind));
      for (const kind of ["silo", "hayBale", "fence", "wall", "container", "lootCrate"] as const) {
        expect(kinds.has(kind), `falta ${kind}`).toBe(true);
      }

      for (let i = 0; i < 16; i++) {
        const sp = spawnPoint(i, 16, 4242 + index, map);
        expect(map.obstacles.some((o) => circleHitsBox(sp.x, sp.y, PLAYER_RADIUS, o)), `aparición ${i}`).toBe(false);
      }

      const walk = reachable(map);
      for (const b of map.buildings) {
        const inner = buildingInterior(b);
        let inside = false;
        for (let y = inner.y + 10; y < inner.y + inner.h - 10 && !inside; y += 10) {
          for (let x = inner.x + 10; x < inner.x + inner.w - 10 && !inside; x += 10) inside = walk(x, y);
        }
        expect(inside, `casa en ${Math.round(b.x)},${Math.round(b.y)}`).toBe(true);
      }

      const grid = navGridFor(map);
      const crates = lootCrates(map);
      const reached = crates.filter((c) => findPath(grid, WORLD_CENTER_X, WORLD_CENTER_Y, c.x + c.w / 2, c.y + c.h / 2));
      expect(reached.length / crates.length).toBeGreaterThanOrEqual(0.95);

      // Cada hongo, en 32 direcciones: nunca se cae adentro de algo.
      for (const pad of map.jumpPads!) {
        for (let k = 0; k < 32; k++) {
          const p = createPlayer(1, pad.x, pad.y);
          for (let t = 1; t <= JUMP_TICKS + 1; t++) stepPlayerMovement(p, { ...emptyInput(t), aim: (k / 32) * Math.PI * 2 }, map);
          expect(map.obstacles.some((o) => circleHitsBox(p.x, p.y, PLAYER_RADIUS - 1, o)), `hongo ${Math.round(pad.x)},${Math.round(pad.y)}`).toBe(false);
        }
      }
    });
  }
});
