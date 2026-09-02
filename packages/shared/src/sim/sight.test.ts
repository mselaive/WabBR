import { describe, expect, it } from "vitest";
import { WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { generateArena, type ArenaMap, type ObstacleKind } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { BLOCKS_SIGHT, MAX_SIGHT, hasLineOfSight } from "./sight.js";

/** Arena con un solo obstáculo: aísla la prueba de todo lo demás del mapa. */
function arenaWith(kind: ObstacleKind, w: number, h: number): ArenaMap {
  const obstacles = [
    { kind, x: WORLD_CENTER_X - w / 2, y: WORLD_CENTER_Y - h / 2, w, h, variant: 0 },
  ];
  return {
    obstacles,
    decor: [],
    buildings: [],
    paths: [],
    ponds: [],
    districts: [],
    grid: new ObstacleGrid(obstacles),
  };
}

const above = { x: WORLD_CENTER_X, y: WORLD_CENTER_Y - 120 };
const below = { x: WORLD_CENTER_X, y: WORLD_CENTER_Y + 120 };

describe("línea de vista", () => {
  it("una pared tapa", () => {
    const arena = arenaWith("buildingWall", 300, 24);
    expect(hasLineOfSight(above.x, above.y, below.x, below.y, arena)).toBe(false);
  });

  it("un contenedor y un silo también", () => {
    for (const kind of ["container", "silo"] as const) {
      const arena = arenaWith(kind, 200, 80);
      expect(hasLineOfSight(above.x, above.y, below.x, below.y, arena), kind).toBe(false);
    }
  });

  it("la cobertura baja NO tapa", () => {
    // La regla del juego: una caja te salva de un tiro pero mirás por encima.
    // Si esto cambiara, el depósito y la granja se volverían laberintos ciegos.
    for (const kind of ["crate", "lootCrate", "barrel", "rock", "hayBale", "fence", "tree"] as const) {
      expect(BLOCKS_SIGHT.has(kind), kind).toBe(false);
      const arena = arenaWith(kind, 120, 60);
      expect(hasLineOfSight(above.x, above.y, below.x, below.y, arena), kind).toBe(true);
    }
  });

  it("en campo abierto se ve", () => {
    const arena = arenaWith("buildingWall", 40, 40);
    // De lado a lado, pasando bien lejos del obstáculo.
    expect(
      hasLineOfSight(
        WORLD_CENTER_X - 300,
        WORLD_CENTER_Y + 400,
        WORLD_CENTER_X + 300,
        WORLD_CENTER_Y + 400,
        arena,
      ),
    ).toBe(true);
  });

  it("más allá del alcance no se ve, aunque no haya nada en el medio", () => {
    const arena = arenaWith("buildingWall", 40, 40);
    // La línea corre por un costado: el obstáculo del helper está en el centro
    // y si el rayo arrancara ahí adentro mediría otra cosa.
    const x = WORLD_CENTER_X + 400;
    const y = WORLD_CENTER_Y - 700;

    expect(hasLineOfSight(x, y, x, y + MAX_SIGHT + 50, arena)).toBe(false);
    expect(hasLineOfSight(x, y, x, y + MAX_SIGHT - 50, arena)).toBe(true);
  });

  it("la visión es simétrica", () => {
    // Si A ve a B pero B no ve a A, uno de los dos pelea contra un fantasma.
    // Se prueba sobre el mapa real, que es donde puede romperse.
    const arena = generateArena();
    let rng = 12345;
    const next = (): number => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };

    for (let i = 0; i < 3000; i++) {
      const ax = WORLD_CENTER_X + (next() * 2 - 1) * 1200;
      const ay = WORLD_CENTER_Y + (next() * 2 - 1) * 1200;
      const bx = ax + (next() * 2 - 1) * 700;
      const by = ay + (next() * 2 - 1) * 700;
      expect(
        hasLineOfSight(ax, ay, bx, by, arena),
        `${Math.round(ax)},${Math.round(ay)} -> ${Math.round(bx)},${Math.round(by)}`,
      ).toBe(hasLineOfSight(bx, by, ax, ay, arena));
    }
  });

  it("desde adentro de una casa no se ve el campo abierto, pero sí por la puerta", () => {
    // La pregunta que originó todo esto: ¿te ven desde afuera?
    const arena = generateArena();
    const house = arena.buildings[0]!;
    const inside = { x: house.x + house.w / 2, y: house.y + house.h / 2 };

    // Un anillo alrededor de la casa: la mayoría de las direcciones tienen que
    // estar tapadas por sus paredes. Algunas no, y esas son las puertas.
    let blocked = 0;
    const samples = 72;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const outside = {
        x: inside.x + Math.cos(a) * (house.w / 2 + 220),
        y: inside.y + Math.sin(a) * (house.h / 2 + 220),
      };
      if (!hasLineOfSight(inside.x, inside.y, outside.x, outside.y, arena)) blocked++;
    }

    // Bastante tapado, pero no hermético: las puertas dejan pasar la vista.
    expect(blocked).toBeGreaterThan(samples * 0.5);
    expect(blocked).toBeLessThan(samples);
  });
});
