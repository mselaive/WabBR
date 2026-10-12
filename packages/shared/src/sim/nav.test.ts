import { describe, expect, it } from "vitest";
import { WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { buildingInterior, generateArena, lootCrates, type ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { findPath, navGridFor, walkableLine } from "./nav.js";

const arena = generateArena();

/** Recorre el camino tramo por tramo: ninguno puede atravesar algo sólido. */
function walkable(path: { x: number; y: number }[], fromX: number, fromY: number, map: ArenaMap): boolean {
  const grid = navGridFor(map);
  let x = fromX;
  let y = fromY;
  // El último punto puede ser una caja (el destino), que no se pisa.
  for (const p of path.slice(0, -1)) {
    if (!walkableLine(grid, x, y, p.x, p.y)) return false;
    x = p.x;
    y = p.y;
  }
  return true;
}

describe("caminos de los bots", () => {
  it("se llega a casi todas las cajas del mapa", () => {
    // Con celdas de 20 px quedaban casas enteras afuera: hay puertas con un
    // tabique justo detrás que dejan pasillos de 26 y 34 px. La que falta tiene
    // un barril tapando a medias el paso del tabique (un detalle del mapa).
    const grid = navGridFor(arena);
    const crates = lootCrates(arena);
    const reachable = crates.filter((c) => findPath(grid, WORLD_CENTER_X, WORLD_CENTER_Y, c.x + c.w / 2, c.y + c.h / 2));
    expect(reachable.length / crates.length).toBeGreaterThanOrEqual(0.95);
  });

  it("de afuera hasta una caja adentro de una casa, entrando por la puerta", () => {
    const b = arena.buildings[0]!;
    const inside = buildingInterior(b);
    const crate = lootCrates(arena).find(
      (c) => c.x >= inside.x && c.x <= inside.x + inside.w && c.y >= inside.y && c.y <= inside.y + inside.h,
    )!;
    expect(crate).toBeDefined();

    // Desde un punto afuera, lejos de la casa.
    const fromX = b.x - 200;
    const fromY = b.y + b.h / 2;
    const path = findPath(navGridFor(arena), fromX, fromY, crate.x + crate.w / 2, crate.y + crate.h / 2);
    expect(path).not.toBeNull();
    expect(walkable(path!, fromX, fromY, arena)).toBe(true);
  });

  it("rodea una pared en vez de chocarla", () => {
    const wall = { kind: "wall" as const, x: 1400, y: 1300, w: 30, h: 400, variant: 0 };
    const map: ArenaMap = {
      obstacles: [wall],
      decor: [],
      buildings: [],
      paths: [],
      ponds: [],
      districts: [],
      grid: new ObstacleGrid([wall]),
    };
    const path = findPath(navGridFor(map), 1300, 1500, 1550, 1500);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    expect(walkable([...path!, { x: 1550, y: 1500 }], 1300, 1500, map)).toBe(true);
  });

  it("si no hay forma de llegar, lo dice en vez de inventar un camino", () => {
    // Un corral cerrado: adentro no se llega de ninguna manera.
    const walls = [
      { kind: "wall" as const, x: 1700, y: 1700, w: 200, h: 20, variant: 0 },
      { kind: "wall" as const, x: 1700, y: 1880, w: 200, h: 20, variant: 0 },
      { kind: "wall" as const, x: 1700, y: 1700, w: 20, h: 200, variant: 0 },
      { kind: "wall" as const, x: 1880, y: 1700, w: 20, h: 200, variant: 0 },
    ];
    const map: ArenaMap = {
      obstacles: walls,
      decor: [],
      buildings: [],
      paths: [],
      ponds: [],
      districts: [],
      grid: new ObstacleGrid(walls),
    };
    expect(findPath(navGridFor(map), WORLD_CENTER_X, WORLD_CENTER_Y, 1800, 1800)).toBeNull();
  });
});
