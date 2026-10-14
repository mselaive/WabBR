import { clamp, makeRng } from "../math.js";
import { WORLD_CENTER_X, WORLD_CENTER_Y, WORLD_RADIUS } from "../constants.js";
import { ObstacleGrid, type AABB } from "../sim/collision.js";

/**
 * El mapa se genera proceduralmente pero con semilla fija: cliente y servidor
 * corren esta misma función y obtienen bit por bit el mismo layout, así que no
 * hace falta transmitirlo por la red y el cliente puede predecir las colisiones.
 *
 * La unidad de diseño es el DISTRITO. Un mapa con casas repartidas parejo se
 * juega igual en todos lados; con distritos aparece la pregunta de a dónde ir,
 * y con nombres aparecen las llamadas entre amigos ("voy a la granja").
 *
 * Orden de generación, y el orden importa:
 *   1. los distritos y su contenido (son los lugares con nombre),
 *   2. los caminos que los unen,
 *   3. la maleza, que esquiva caminos e interiores.
 */
export const ARENA_SEED = 0x7ab_b12;

export type ObstacleKind =
  | "crate"
  | "wall"
  | "tree"
  | "rock"
  | "barrel"
  | "container"
  | "buildingWall"
  /** Caja de botín: bloquea como una caja, pero se abre con E. */
  | "lootCrate"
  | "silo"
  | "hayBale"
  | "fence"
  | "pump";

export type DecorKind = "bush" | "grass" | "flower" | "pebble";

export interface Obstacle extends AABB {
  kind: ObstacleKind;
  /** Variante de sprite, para que no se vean todos iguales. */
  variant: number;
}

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  variant: number;
  scale: number;
}

/** Una casa: rectángulo con paredes en el perímetro y huecos de puerta. */
export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 = madera, 1 = hormigón. Sólo cambia el piso que se dibuja. */
  floor: number;
}

/** Camino de tierra. Es sólo visual: no colisiona con nada. */
export interface Path {
  points: { x: number; y: number }[];
  width: number;
}

/** Charco. Se camina por encima: es paisaje, no obstáculo. */
export interface Pond {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export type DistrictKind =
  | "ciudad"
  | "granja"
  | "parque"
  | "deposito"
  | "campamento"
  | "ruinas"
  // Puntos menores: rellenan el campo abierto sin competir con los distritos.
  | "gasolinera"
  | "caserio"
  | "chatarreria";

export interface District {
  kind: DistrictKind;
  /** Nombre para el minimapa: es lo que la gente grita por voz. */
  name: string;
  x: number;
  y: number;
  radius: number;
  /**
   * Índice de textura del suelo, o -1 para dejar el pasto. Las manchas de
   * `blobs` son la forma real que se pinta: un círculo perfecto se ve generado.
   */
  ground: number;
  /** true en los puntos menores: el minimapa los rotula más chico. */
  minor: boolean;
  blobs: { x: number; y: number; rx: number; ry: number }[];
}

export interface ArenaMap {
  obstacles: Obstacle[];
  decor: Decor[];
  buildings: Building[];
  paths: Path[];
  ponds: Pond[];
  districts: District[];
  grid: ObstacleGrid;
  /** Fogatas: al lado de una, sin que te peguen, te curás de a poco. Una por distrito. */
  campfires?: { x: number; y: number }[];
}

/** Los colliders de árboles/rocas son más chicos que el sprite: se camina "por debajo" de la copa. */
const KIND_SIZES: Record<Exclude<ObstacleKind, "buildingWall">, { w: number; h: number }> = {
  crate: { w: 46, h: 46 },
  wall: { w: 64, h: 34 },
  tree: { w: 34, h: 26 },
  rock: { w: 30, h: 24 },
  barrel: { w: 30, h: 30 },
  container: { w: 150, h: 76 },
  lootCrate: { w: 48, h: 48 },
  silo: { w: 76, h: 76 },
  hayBale: { w: 58, h: 44 },
  fence: { w: 96, h: 14 },
  pump: { w: 36, h: 34 },
};

const WALL_THICKNESS = 24;
/** Hueco de puerta. Tiene que dejar pasar cómodo a un jugador de radio 12. */
const DOOR_WIDTH = 84;
/** Pared que queda como mínimo a cada lado del hueco. */
const DOOR_MARGIN = 26;
/** Por debajo de esto la puerta se siente un embudo y no vale la pena abrirla. */
const MIN_DOOR_WIDTH = 44;

/**
 * Margen libre entre el mobiliario y la pared interior. Tiene que ser mayor que
 * el diámetro del jugador (24 px) más el medio ancho de una caja (24 px): así
 * queda un pasillo transitable pegado a la pared y ningún mueble puede tapar
 * una puerta desde adentro. El test de alcanzabilidad lo verifica.
 */
const INDOOR_MARGIN = 52;

/** Texturas de suelo: 0 asfalto, 1 tierra arada, 2 gravilla, 3 tierra. */
const GROUND_ASPHALT = 0;
const GROUND_FIELD = 1;
const GROUND_GRAVEL = 2;
const GROUND_DIRT = 3;

// ------------------------------------------------------------- geometría

function overlaps(a: AABB, b: AABB, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

/** Distancia del punto al camino más cercano. Infinita si no hay caminos. */
export function distToPaths(x: number, y: number, paths: readonly Path[]): number {
  let best = Infinity;
  for (const path of paths) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const a = path.points[i]!;
      const b = path.points[i + 1]!;
      const d = distToSegment(x, y, a.x, a.y, b.x, b.y) - path.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

/** Punto justo afuera del borde de la casa, en la dirección de un objetivo. */
function edgePoint(b: Building, towardX: number, towardY: number): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const margin = 34;
  const sx = dx !== 0 ? (b.w / 2 + margin) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (b.h / 2 + margin) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Rectángulo caminable de adentro de una casa, ya descontadas las paredes. */
export function buildingInterior(b: Building): AABB {
  return {
    x: b.x + WALL_THICKNESS,
    y: b.y + WALL_THICKNESS,
    w: b.w - WALL_THICKNESS * 2,
    h: b.h - WALL_THICKNESS * 2,
  };
}

/**
 * Cajas de botín en orden fijo. El índice ES el id: como el mapa se genera igual
 * en las dos puntas, alcanza con transmitir "se abrió la 7" y no dónde está.
 */
export function lootCrates(map: ArenaMap): Obstacle[] {
  return map.obstacles.filter((o) => o.kind === "lootCrate");
}

/** Distrito que contiene el punto, si hay alguno. */
export function districtAt(map: ArenaMap, x: number, y: number): District | undefined {
  return map.districts.find((d) => Math.hypot(x - d.x, y - d.y) <= d.radius);
}

// --------------------------------------------------------------- paredes

/** Parte una pared recta en los tramos que quedan a los lados de los huecos. */
function splitWall(
  from: number,
  to: number,
  gaps: { from: number; to: number }[],
  make: (a: number, b: number) => void,
): void {
  let cursor = from;
  const sorted = [...gaps].sort((a, b) => a.from - b.from);
  for (const gap of sorted) {
    if (gap.from > cursor) make(cursor, Math.min(gap.from, to));
    cursor = Math.max(cursor, gap.to);
  }
  if (cursor < to) make(cursor, to);
}

function buildWalls(b: Building, rnd: () => number, out: Obstacle[]): void {
  const T = WALL_THICKNESS;
  const variant = Math.floor(rnd() * 2);
  const push = (x: number, y: number, w: number, h: number): void => {
    if (w <= 2 || h <= 2) return;
    out.push({ kind: "buildingWall", x, y, w, h, variant });
  };

  // Dos puertas en lados distintos: una casa con una sola entrada es una trampa.
  const first = Math.floor(rnd() * 4);
  const second = (first + 1 + Math.floor(rnd() * 3)) % 4;
  const doorSides = new Set([first, second]);

  /**
   * Hueco de puerta. La puerta se ENCOGE hasta lo que entre en lugar de
   * descartarse: si se descartara, una casa chica cuyas dos puertas cayeran en
   * los laterales quedaría sellada y sin forma de entrar.
   */
  const gapFor = (side: number, from: number, to: number): { from: number; to: number }[] => {
    if (!doorSides.has(side)) return [];
    const span = to - from;
    const width = Math.min(DOOR_WIDTH, span - DOOR_MARGIN * 2);
    if (width < MIN_DOOR_WIDTH) return [];
    const slack = Math.max(0, span - width - DOOR_MARGIN * 2);
    const centre = from + DOOR_MARGIN + width / 2 + rnd() * slack;
    return [{ from: centre - width / 2, to: centre + width / 2 }];
  };

  splitWall(b.x, b.x + b.w, gapFor(0, b.x, b.x + b.w), (a, c) => push(a, b.y, c - a, T));
  splitWall(b.x, b.x + b.w, gapFor(2, b.x, b.x + b.w), (a, c) =>
    push(a, b.y + b.h - T, c - a, T),
  );

  const top = b.y + T;
  const bottom = b.y + b.h - T;
  splitWall(top, bottom, gapFor(3, top, bottom), (a, c) => push(b.x, a, T, c - a));
  splitWall(top, bottom, gapFor(1, top, bottom), (a, c) => push(b.x + b.w - T, a, T, c - a));

  // Tabique interior en algunas casas: da esquinas para pelear adentro.
  if (b.w > 240 && rnd() < 0.55) {
    const at = b.x + b.w * (0.4 + rnd() * 0.2);
    const gapAt = top + (bottom - top) * (0.3 + rnd() * 0.4);
    splitWall(
      top,
      bottom,
      [{ from: gapAt - DOOR_WIDTH / 2, to: gapAt + DOOR_WIDTH / 2 }],
      (a, c) => push(at, a, T, c - a),
    );
  }
}

// ------------------------------------------------------------- distritos

interface DistrictSpec {
  kind: DistrictKind;
  name: string;
  radius: number;
  ground: number;
}

/**
 * El anillo exterior. La ciudad va aparte, en el centro: es el punto caliente y
 * el cruce de todos los caminos.
 */
const RING_SPECS: readonly DistrictSpec[] = [
  { kind: "granja", name: "La Granja", radius: 330, ground: GROUND_FIELD },
  { kind: "parque", name: "El Parque", radius: 330, ground: -1 },
  { kind: "deposito", name: "El Depósito", radius: 320, ground: GROUND_GRAVEL },
  { kind: "campamento", name: "El Campamento", radius: 340, ground: GROUND_DIRT },
  { kind: "ruinas", name: "Las Ruinas", radius: 310, ground: GROUND_GRAVEL },
];

/**
 * Puntos menores. Existen para que el campo abierto no sea puro pasto: son
 * chicos, dan poco botín y sirven sobre todo como referencia y cobertura de paso
 * entre distritos.
 */
const MINOR_SPECS: readonly DistrictSpec[] = [
  { kind: "gasolinera", name: "Gasolinera", radius: 175, ground: GROUND_ASPHALT },
  { kind: "caserio", name: "Caserío", radius: 165, ground: GROUND_DIRT },
  { kind: "chatarreria", name: "Chatarrería", radius: 170, ground: GROUND_GRAVEL },
];

/** Cuántos puntos menores se intentan colocar en los huecos. */
const MINOR_COUNT = 12;

const CITY_SPEC: DistrictSpec = {
  kind: "ciudad",
  name: "La Ciudad",
  radius: 480,
  ground: GROUND_ASPHALT,
};

export function generateArena(seed = ARENA_SEED): ArenaMap {
  const rnd = makeRng(seed);
  const obstacles: Obstacle[] = [];
  const buildings: Building[] = [];
  const paths: Path[] = [];
  const ponds: Pond[] = [];
  const districts: District[] = [];

  // ----------------------------------------------------------- utilidades

  const inArena = (x: number, y: number, margin: number): boolean =>
    Math.hypot(x - WORLD_CENTER_X, y - WORLD_CENTER_Y) <= WORLD_RADIUS - margin;

  const clearOfPaths = (x: number, y: number, margin: number): boolean =>
    distToPaths(x, y, paths) > margin;

  const insideAnyBuilding = (box: AABB, pad: number): boolean =>
    buildings.some((b) => overlaps(box, b, pad));

  const place = (
    kind: Exclude<ObstacleKind, "buildingWall">,
    x: number,
    y: number,
    pad: number,
    opts: { indoors?: boolean; ignorePaths?: boolean } = {},
  ): boolean => {
    const size = KIND_SIZES[kind];
    const box: Obstacle = {
      kind,
      x: x - size.w / 2,
      y: y - size.h / 2,
      w: size.w,
      h: size.h,
      variant: Math.floor(rnd() * 3),
    };
    if (!inArena(box.x + box.w / 2, box.y + box.h / 2, 110)) return false;

    if (!opts.indoors) {
      if (!opts.ignorePaths && !clearOfPaths(box.x + box.w / 2, box.y + box.h / 2, 20)) {
        return false;
      }
      // Sin esto crecen árboles adentro del living, que se ve directamente roto.
      if (insideAnyBuilding(box, 8)) return false;
    }

    for (const o of obstacles) if (overlaps(box, o, pad)) return false;
    obstacles.push(box);
    return true;
  };

  /** Intenta varias veces antes de rendirse. Casi todo el relleno lo necesita. */
  const tryAround = (
    kind: Exclude<ObstacleKind, "buildingWall">,
    cx: number,
    cy: number,
    radius: number,
    pad: number,
    attempts = 30,
  ): boolean => {
    for (let i = 0; i < attempts; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      if (place(kind, cx + Math.cos(a) * r, cy + Math.sin(a) * r, pad)) return true;
    }
    return false;
  };

  /** Casa con paredes y puertas, si entra donde se la pide. */
  const addBuilding = (
    x: number,
    y: number,
    w: number,
    h: number,
    floor: number,
    separation = 150,
  ): Building | null => {
    const candidate: Building = { x: x - w / 2, y: y - h / 2, w, h, floor };
    const corners: [number, number][] = [
      [candidate.x, candidate.y],
      [candidate.x + candidate.w, candidate.y],
      [candidate.x, candidate.y + candidate.h],
      [candidate.x + candidate.w, candidate.y + candidate.h],
    ];
    if (!corners.every(([cx, cy]) => inArena(cx, cy, 140))) return null;
    if (buildings.some((b) => overlaps(candidate, b, separation))) return null;

    buildings.push(candidate);
    buildWalls(candidate, rnd, obstacles);
    return candidate;
  };

  /** Mobiliario y cajas de botín adentro de una casa. */
  const furnish = (b: Building, crates: number, props: number): void => {
    const inside = buildingInterior(b);
    const spot = () => ({
      x: inside.x + INDOOR_MARGIN + rnd() * Math.max(1, inside.w - INDOOR_MARGIN * 2),
      y: inside.y + INDOOR_MARGIN + rnd() * Math.max(1, inside.h - INDOOR_MARGIN * 2),
    });
    for (let i = 0; i < crates; i++) {
      for (let a = 0; a < 25; a++) {
        const s = spot();
        if (place("lootCrate", s.x, s.y, 14, { indoors: true })) break;
      }
    }
    for (let i = 0; i < props; i++) {
      for (let a = 0; a < 25; a++) {
        const s = spot();
        if (place(rnd() < 0.5 ? "crate" : "barrel", s.x, s.y, 12, { indoors: true })) break;
      }
    }
  };

  /** Manchas irregulares que dan la forma del suelo del distrito. */
  const makeBlobs = (cx: number, cy: number, radius: number): District["blobs"] => {
    const blobs: District["blobs"] = [];
    const count = 10 + Math.floor(rnd() * 5);
    for (let i = 0; i < count; i++) {
      // El alcance máximo de una mancha (distancia + radio) tiene que quedar
      // por debajo del radio del distrito, o los distritos se pisan entre sí y
      // en el minimapa dejan de leerse como lugares separados.
      const a = rnd() * Math.PI * 2;
      const d = rnd() * radius * 0.36;
      blobs.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d,
        rx: radius * (0.44 + rnd() * 0.2),
        ry: radius * (0.42 + rnd() * 0.2),
      });
    }
    return blobs;
  };

  // --------------------------------------------------- contenido por tipo

  const buildCiudad = (d: District): void => {
    // Cuatro edificios en cuadrícula floja: es lo que la hace leer como manzanas.
    for (const cx of [-1, 1]) {
      for (const cy of [-1, 1]) {
        const w = 240 + Math.floor(rnd() * 3) * 40;
        const h = 200 + Math.floor(rnd() * 2) * 40;
        const b = addBuilding(
          d.x + cx * (270 + rnd() * 40),
          d.y + cy * (240 + rnd() * 30),
          w,
          h,
          1, // hormigón
          90,
        );
        if (b) furnish(b, 2 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
      }
    }
    for (let i = 0; i < 3; i++) tryAround("container", d.x, d.y, d.radius * 0.85, 30);
    for (let i = 0; i < 4; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.9, 26);
    for (let i = 0; i < 5; i++) tryAround("barrel", d.x, d.y, d.radius * 0.9, 22);
    for (let i = 0; i < 4; i++) tryAround("crate", d.x, d.y, d.radius * 0.9, 20);
  };

  const buildGranja = (d: District): void => {
    // Un granero grande y tres silos: la silueta que la hace reconocible de lejos.
    const barn = addBuilding(d.x, d.y - 40, 440, 270, 0, 120);
    if (barn) furnish(barn, 3, 2);

    // En un anillo bien afuera del granero: a menos distancia el silo cae
    // adentro del edificio y la colocación se descarta sin dejar rastro.
    for (let i = 0; i < 3; i++) {
      const base = (i / 3) * Math.PI * 2 + 0.7;
      for (let attempt = 0; attempt < 16; attempt++) {
        const a = base + (rnd() - 0.5) * 0.7;
        const r = 285 + rnd() * 55;
        if (place("silo", d.x + Math.cos(a) * r, d.y + Math.sin(a) * r, 20, { ignorePaths: true })) {
          break;
        }
      }
    }

    // Cercos: tramos rectos de valla que dividen el campo.
    for (let line = 0; line < 3; line++) {
      const a = rnd() * Math.PI * 2;
      const len = 3 + Math.floor(rnd() * 3);
      const startX = d.x + Math.cos(a) * (150 + rnd() * 110);
      const startY = d.y + Math.sin(a) * (150 + rnd() * 110);
      const horizontal = rnd() < 0.5;
      for (let s = 0; s < len; s++) {
        place(
          "fence",
          startX + (horizontal ? s * KIND_SIZES.fence.w : 0),
          startY + (horizontal ? 0 : s * 42),
          0,
        );
      }
    }

    for (let i = 0; i < 7; i++) tryAround("hayBale", d.x, d.y, d.radius * 0.9, 22);
    for (let i = 0; i < 3; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.85, 26);
    for (let i = 0; i < 4; i++) tryAround("barrel", d.x, d.y, d.radius * 0.9, 22);
  };

  const buildParque = (d: District): void => {
    // Sin edificios: es cobertura y sombra. El botín acá es flojo a propósito,
    // porque lo que vale del parque es poder cruzar el mapa sin que te vean.
    const pondCount = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < pondCount; i++) {
      const a = rnd() * Math.PI * 2;
      const dd = rnd() * d.radius * 0.5;
      ponds.push({
        x: d.x + Math.cos(a) * dd,
        y: d.y + Math.sin(a) * dd,
        rx: 90 + rnd() * 70,
        ry: 70 + rnd() * 50,
      });
    }

    for (let i = 0; i < 34; i++) tryAround("tree", d.x, d.y, d.radius * 0.95, 22);
    for (let i = 0; i < 8; i++) tryAround("rock", d.x, d.y, d.radius * 0.95, 20);
    for (let i = 0; i < 2; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.8, 26);
  };

  const buildDeposito = (d: District): void => {
    const shed = addBuilding(d.x - 60, d.y, 380, 240, 1, 120);
    if (shed) furnish(shed, 3, 2);

    // Contenedores en hileras: pasillos estrechos donde se pelea de cerca.
    for (let row = 0; row < 3; row++) {
      const y = d.y - 130 + row * 130 + (rnd() - 0.5) * 30;
      for (let col = 0; col < 3; col++) {
        place("container", d.x + 150 + col * 24, y + col * 88, 18, { ignorePaths: true });
      }
    }

    for (let i = 0; i < 5; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.9, 26);
    for (let i = 0; i < 8; i++) tryAround("crate", d.x, d.y, d.radius * 0.95, 18);
    for (let i = 0; i < 6; i++) tryAround("barrel", d.x, d.y, d.radius * 0.95, 20);
  };

  const buildCampamento = (d: District): void => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rnd();
      const b = addBuilding(d.x + Math.cos(a) * 225, d.y + Math.sin(a) * 205, 240, 200, 0, 85);
      if (b) furnish(b, 2, 1);
    }
    for (let i = 0; i < 3; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.85, 26);
    for (let i = 0; i < 8; i++) tryAround("barrel", d.x, d.y, d.radius * 0.95, 20);
    for (let i = 0; i < 6; i++) tryAround("crate", d.x, d.y, d.radius * 0.95, 18);
    for (let i = 0; i < 8; i++) tryAround("tree", d.x, d.y, d.radius, 24);
  };

  const buildRuinas = (d: District): void => {
    // Muros sueltos en L, sin techo ni puertas: cobertura pura.
    for (let i = 0; i < 9; i++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * d.radius * 0.9;
        const px = d.x + Math.cos(a) * r;
        const py = d.y + Math.sin(a) * r;
        const horizontal = rnd() < 0.5;
        const len = 2 + Math.floor(rnd() * 3);
        const wall = KIND_SIZES.wall;

        const before = obstacles.length;
        let ok = true;
        // pad 0: los tramos se tocan a propósito para formar un muro continuo.
        for (let s = 0; s < len && ok; s++) {
          ok = place(
            "wall",
            px + (horizontal ? s * wall.w : 0),
            py + (horizontal ? 0 : s * wall.h),
            0,
          );
        }
        if (ok) {
          place(
            "wall",
            px + (horizontal ? (len - 1) * wall.w : wall.w),
            py + (horizontal ? wall.h : (len - 1) * wall.h),
            0,
          );
          break;
        }
        obstacles.length = before;
      }
    }
    for (let i = 0; i < 12; i++) tryAround("rock", d.x, d.y, d.radius * 0.95, 20);
    for (let i = 0; i < 3; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.85, 26);
    for (let i = 0; i < 5; i++) tryAround("tree", d.x, d.y, d.radius, 24);
  };

  // ------------------------------------------------------ puntos menores

  const buildGasolinera = (d: District): void => {
    const shop = addBuilding(d.x, d.y - 30, 200, 160, 1, 90);
    if (shop) furnish(shop, 1 + Math.floor(rnd() * 2), 1);

    // Los surtidores en fila son la silueta que la hace reconocible de lejos.
    const pumps = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < pumps; i++) {
      // A 110 del centro de la tienda: más cerca dejaban un pasillo de 23 px
      // contra la pared, y por ahí no pasa nadie.
      place("pump", d.x - 60 + i * 60, d.y + 130, 12, { ignorePaths: true });
    }
    for (let i = 0; i < 3; i++) tryAround("barrel", d.x, d.y, d.radius * 0.9, 18);
    tryAround("lootCrate", d.x, d.y, d.radius * 0.8, 24);
  };

  const buildCaserio = (d: District): void => {
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + rnd();
      const b = addBuilding(d.x + Math.cos(a) * 105, d.y + Math.sin(a) * 90, 200, 170, 0, 80);
      if (b) furnish(b, 1, 1);
    }
    for (let i = 0; i < 2; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.85, 24);
    for (let i = 0; i < 3; i++) tryAround("crate", d.x, d.y, d.radius * 0.9, 16);
    for (let i = 0; i < 4; i++) tryAround("tree", d.x, d.y, d.radius, 22);
  };

  const buildChatarreria = (d: District): void => {
    for (let i = 0; i < 4; i++) {
      tryAround("container", d.x, d.y, d.radius * 0.8, 24);
    }
    for (let i = 0; i < 2; i++) tryAround("lootCrate", d.x, d.y, d.radius * 0.85, 24);
    for (let i = 0; i < 6; i++) tryAround("crate", d.x, d.y, d.radius * 0.9, 14);
    for (let i = 0; i < 5; i++) tryAround("barrel", d.x, d.y, d.radius * 0.9, 16);
    for (let i = 0; i < 4; i++) tryAround("rock", d.x, d.y, d.radius * 0.95, 18);
  };

  const BUILDERS: Record<DistrictKind, (d: District) => void> = {
    ciudad: buildCiudad,
    granja: buildGranja,
    parque: buildParque,
    deposito: buildDeposito,
    campamento: buildCampamento,
    ruinas: buildRuinas,
    gasolinera: buildGasolinera,
    caserio: buildCaserio,
    chatarreria: buildChatarreria,
  };

  // ------------------------------------------------------ 1. distritos

  const addDistrict = (spec: DistrictSpec, x: number, y: number, minor = false): District => {
    const d: District = {
      kind: spec.kind,
      name: spec.name,
      x,
      y,
      radius: spec.radius,
      ground: spec.ground,
      minor,
      blobs: makeBlobs(x, y, spec.radius),
    };
    districts.push(d);
    return d;
  };

  // La ciudad al centro: todos los caminos pasan por ahí, así que es el lugar
  // arriesgado y donde se cruzan los que van de un distrito a otro.
  const city = addDistrict(CITY_SPEC, WORLD_CENTER_X, WORLD_CENTER_Y);

  // Bastante afuera: pegados al centro dejan un anillo exterior muerto y las
  // zonas se solapan con la ciudad.
  const ringRadius = WORLD_RADIUS * 0.62;
  RING_SPECS.forEach((spec, i) => {
    const angle = (i / RING_SPECS.length) * Math.PI * 2 + rnd() * 0.25;
    addDistrict(
      spec,
      WORLD_CENTER_X + Math.cos(angle) * ringRadius,
      WORLD_CENTER_Y + Math.sin(angle) * ringRadius,
    );
  });

  // Puntos menores en los huecos. Se colocan por rechazo: cualquier lugar que
  // no pise un distrito ni otro punto menor sirve, y así el relleno va justo
  // donde el mapa se veía vacío sin tener que calcular dónde está el vacío.
  const majorCount = districts.length;
  for (let i = 0; i < MINOR_COUNT; i++) {
    const spec = MINOR_SPECS[i % MINOR_SPECS.length]!;
    for (let attempt = 0; attempt < 200; attempt++) {
      // Sesgo hacia afuera: el anillo exterior es el que más vacío quedaba.
      const angle = rnd() * Math.PI * 2;
      const r = WORLD_RADIUS * (0.40 + Math.sqrt(rnd()) * 0.42);
      const x = WORLD_CENTER_X + Math.cos(angle) * r;
      const y = WORLD_CENTER_Y + Math.sin(angle) * r;

      if (!inArena(x, y, spec.radius + 70)) continue;
      const clashes = districts.some((d) => {
        const gap = d.minor ? 130 : 90;
        return Math.hypot(x - d.x, y - d.y) < d.radius + spec.radius + gap;
      });
      if (clashes) continue;

      addDistrict(spec, x, y, true);
      break;
    }
  }

  for (const d of districts) BUILDERS[d.kind](d);
  void majorCount;

  // -------------------------------------------------------- 2. caminos

  /**
   * De dónde arranca un camino en un distrito: del borde de la casa más cercana
   * al destino, o del borde del distrito si no tiene casas. Saliendo del centro
   * la ruta terminaría chocando contra una pared.
   */
  const nearestEdge = (d: District, toward: District): { x: number; y: number } => {
    const inner = buildings.filter(
      (b) => Math.hypot(b.x + b.w / 2 - d.x, b.y + b.h / 2 - d.y) < d.radius,
    );
    if (inner.length > 0) {
      let best = inner[0]!;
      let bestDist = Infinity;
      for (const b of inner) {
        const dist = Math.hypot(b.x + b.w / 2 - toward.x, b.y + b.h / 2 - toward.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = b;
        }
      }
      return edgePoint(best, toward.x, toward.y);
    }
    const angle = Math.atan2(toward.y - d.y, toward.x - d.x);
    return {
      x: d.x + Math.cos(angle) * d.radius * 0.6,
      y: d.y + Math.sin(angle) * d.radius * 0.6,
    };
  };

  const roadBetween = (a: District, b: District): void => {
    const from = nearestEdge(a, b);
    const to = nearestEdge(b, a);
    const midX = (from.x + to.x) / 2 + (rnd() - 0.5) * 170;
    const midY = (from.y + to.y) / 2 + (rnd() - 0.5) * 170;
    paths.push({ points: [from, { x: midX, y: midY }, to], width: 82 + rnd() * 26 });
  };

  // Radios desde la ciudad más un anillo entre vecinos: sin el anillo, cruzar de
  // un distrito a otro obligaría a pasar siempre por el centro, que es justo
  // donde te matan.
  const ring = districts.filter((d) => !d.minor && d !== city);
  for (const d of ring) roadBetween(city, d);
  for (let i = 0; i < ring.length; i++) roadBetween(ring[i]!, ring[(i + 1) % ring.length]!);

  // Ramales a los puntos menores: además de conectarlos, son lo que le da
  // trazado al campo abierto, que antes era pasto sin nada.
  for (const minor of districts.filter((d) => d.minor)) {
    let nearest = city;
    let best = Infinity;
    for (const d of districts) {
      if (d.minor) continue;
      const dist = Math.hypot(d.x - minor.x, d.y - minor.y);
      if (dist < best) {
        best = dist;
        nearest = d;
      }
    }
    roadBetween(nearest, minor);
  }

  // --------------------------------------------------- 3. campo abierto

  const inAnyDistrict = (x: number, y: number, slack = 0): boolean =>
    districts.some((d) => Math.hypot(x - d.x, y - d.y) < d.radius + slack);

  const scatterWild = (
    kind: Exclude<ObstacleKind, "buildingWall">,
    count: number,
    pad: number,
  ): void => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (WORLD_RADIUS - 120);
      const x = WORLD_CENTER_X + Math.cos(a) * r;
      const y = WORLD_CENTER_Y + Math.sin(a) * r;
      // El campo abierto es lo que separa un distrito de otro: si lo llenáramos
      // igual, dejarían de leerse como lugares distintos.
      if (inAnyDistrict(x, y, -40)) continue;
      if (place(kind, x, y, pad)) placed++;
    }
  };

  scatterWild("tree", 48, 30);
  scatterWild("rock", 20, 26);
  scatterWild("lootCrate", 8, 40);
  scatterWild("crate", 6, 24);

  // ----------------------------------------------------- 4. decoración
  const decor: Decor[] = [];
  const decorKinds: DecorKind[] = ["bush", "grass", "flower", "pebble"];
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * (WORLD_RADIUS - 40);
    const x = WORLD_CENTER_X + Math.cos(a) * r;
    const y = WORLD_CENTER_Y + Math.sin(a) * r;

    const kind = decorKinds[Math.floor(rnd() * decorKinds.length)]!;
    if (kind !== "pebble" && !clearOfPaths(x, y, 6)) continue;
    // Un arbusto en el medio del comedor rompe la ilusión de que es una casa.
    if (buildings.some((b) => x > b.x - 6 && x < b.x + b.w + 6 && y > b.y - 6 && y < b.y + b.h + 6)) {
      continue;
    }
    decor.push({ kind, x, y, variant: Math.floor(rnd() * 3), scale: 0.85 + rnd() * 0.4 });
  }

  const campfires = placeCampfires(seed, districts, buildings, obstacles);
  return { obstacles, decor, buildings, paths, ponds, districts, grid: new ObstacleGrid(obstacles), campfires };
}

/** Cuántas fogatas hay: más y las curaciones dejarían de valer algo. */
const CAMPFIRES = 6;

/**
 * Una fogata en cada uno de los distritos más grandes, en un lugar despejado y
 * al aire libre. Va al final y con su propio azar: así no mueve nada de lo que
 * el mapa ya tenía (cambiar el generador movería el mapa de todos).
 */
function placeCampfires(
  seed: number,
  districts: readonly District[],
  buildings: readonly Building[],
  obstacles: readonly Obstacle[],
): { x: number; y: number }[] {
  const rnd = makeRng(seed ^ 0x0f1a3e);
  const fires: { x: number; y: number }[] = [];
  const biggest = [...districts].sort((a, b) => b.radius - a.radius).slice(0, CAMPFIRES);
  for (const d of biggest) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * d.radius * 0.9;
      const x = d.x + Math.cos(a) * r;
      const y = d.y + Math.sin(a) * r;
      if (Math.hypot(x - WORLD_CENTER_X, y - WORLD_CENTER_Y) > WORLD_RADIUS - 160) continue;
      if (buildings.some((b) => x > b.x - 40 && x < b.x + b.w + 40 && y > b.y - 40 && y < b.y + b.h + 40)) continue;
      if (obstacles.some((o) => x > o.x - 40 && x < o.x + o.w + 40 && y > o.y - 40 && y < o.y + o.h + 40)) continue;
      fires.push({ x, y });
      break;
    }
  }
  return fires;
}

/**
 * La mancha de cada arbusto, en coordenadas del mundo: una elipse un poco más
 * grande que la parte frondosa del dibujo (24x18 a escala 2, apoyado en su
 * base). Adentro de una de estas, un jugador queda tapado por el follaje.
 */
interface BushShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const bushesByArena = new WeakMap<ArenaMap, BushShape[]>();

function bushesOf(map: ArenaMap): BushShape[] {
  let shapes = bushesByArena.get(map);
  if (!shapes) {
    shapes = map.decor
      .filter((d) => d.kind === "bush")
      .map((d) => ({ cx: d.x, cy: d.y - 14 * d.scale, rx: 24 * d.scale, ry: 17 * d.scale }));
    bushesByArena.set(map, shapes);
  }
  return shapes;
}

/** ¿El punto está metido en un arbusto? */
export function bushAt(map: ArenaMap, x: number, y: number): boolean {
  for (const b of bushesOf(map)) {
    const dx = (x - b.cx) / b.rx;
    const dy = (y - b.cy) / b.ry;
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
}

let cached: ArenaMap | null = null;

/** Mapa de la partida. Se genera una sola vez por proceso. */
export function getArena(): ArenaMap {
  if (!cached) cached = generateArena();
  return cached;
}

/**
 * Puntos de aparición repartidos en un anillo cerca del muro.
 * `index` va de 0 a `total-1` para que nadie spawnee encima de otro.
 *
 * El anillo entero gira con la semilla de la partida. Antes el ángulo salía
 * sólo del índice, y la semilla apenas lo movía ±13°: el primero aparecía
 * siempre al este, el segundo siempre enfrente, y así partida tras partida.
 */
/** ¿Se puede aparecer acá? Adentro de la arena y sin nada encima. */
function spawnClear(x: number, y: number, arena: ArenaMap): boolean {
  if (Math.hypot(x - WORLD_CENTER_X, y - WORLD_CENTER_Y) > WORLD_RADIUS - 60) return false;
  // Margen extra sobre el radio del jugador: aparecer rozando una pared es
  // casi tan molesto como aparecer adentro.
  for (const o of arena.obstacles) {
    if (x + 22 > o.x && x - 22 < o.x + o.w && y + 22 > o.y && y - 22 < o.y + o.h) return false;
  }
  return true;
}

/**
 * Un lugar libre al lado de `at`, para el compañero en dúos: aparecen juntos.
 * Si alrededor no hay lugar, el mismo punto (los jugadores no chocan entre sí).
 */
export function spawnBeside(at: { x: number; y: number }, arena: ArenaMap): { x: number; y: number } {
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x = at.x + Math.cos(angle) * 44;
    const y = at.y + Math.sin(angle) * 44;
    if (spawnClear(x, y, arena)) return { x, y };
  }
  return { ...at };
}

export function spawnPoint(
  index: number,
  total: number,
  seed: number,
  arena?: ArenaMap,
): { x: number; y: number } {
  const rnd = makeRng(seed + index * 7919);
  const rotation = makeRng(seed ^ 0x2c1b3c6d)() * Math.PI * 2;
  const baseAngle = rotation + (index / Math.max(total, 1)) * Math.PI * 2;

  const clear = (x: number, y: number): boolean => !arena || spawnClear(x, y, arena);

  let fallback = { x: WORLD_CENTER_X, y: WORLD_CENTER_Y };
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = baseAngle + (rnd() - 0.5) * 0.45;
    const r = WORLD_RADIUS * (0.74 + rnd() * 0.14);
    const point = {
      x: WORLD_CENTER_X + Math.cos(angle) * r,
      y: WORLD_CENTER_Y + Math.sin(angle) * r,
    };
    if (attempt === 0) fallback = point;
    if (clear(point.x, point.y)) return point;
  }
  return fallback;
}
