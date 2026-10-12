import { PLAYER_RADIUS, WORLD_CENTER_X, WORLD_CENTER_Y, WORLD_RADIUS, WORLD_SIZE } from "../constants.js";
import type { ArenaMap } from "../map/arena.js";
import { circleHitsBox } from "./collision.js";

/**
 * Por dónde se puede caminar, en una grilla de celdas. Es lo que usan los bots
 * para encontrar el camino: yendo en línea recta se trababan contra la primera
 * pared, y como casi todas las cajas están adentro de casas, no encontraban la
 * puerta para salir cuando se cerraba la zona.
 */
export interface NavGrid {
  cell: number;
  cols: number;
  rows: number;
  /** 1 = se puede parar ahí un jugador. */
  walkable: Uint8Array;
  /**
   * A qué zona conectada pertenece cada celda caminable (0 = no caminable).
   * Dos celdas de zonas distintas no tienen camino: findPath lo sabe sin buscar.
   */
  region: Int32Array;
}

/**
 * 10 px. Con 20 se perdían pasos reales: hay puertas con un tabique justo
 * detrás que dejan pasillos de 26 y 34 px, por donde un jugador (radio 12)
 * pasa pero ningún centro de celda de 20 px caía en el lugar justo, y la casa
 * entera quedaba como cerrada.
 */
const CELL = 10;
/**
 * Un pixel menos que el radio del jugador: el camino puede ir pegado a las
 * paredes, y el movimiento ya resuelve el roce deslizando.
 */
const CLEARANCE = PLAYER_RADIUS - 1;
/** Tope de nodos a explorar: acota lo que puede tardar un tick del servidor. */
const MAX_EXPANSIONS = 60_000;
/**
 * Peso de la heurística. Con 1 es A* puro y el camino es el más corto, pero
 * explora mucho; un poco más va derecho al destino y da caminos casi iguales
 * mirando una fracción de las celdas. A un bot le alcanza.
 */
const GREED = 1.4;

const grids = new WeakMap<ArenaMap, NavGrid>();

/** La grilla de un mapa. Se arma una vez y se reusa: el mapa no cambia. */
export function navGridFor(arena: ArenaMap): NavGrid {
  const cached = grids.get(arena);
  if (cached) return cached;

  const cols = Math.ceil(WORLD_SIZE / CELL);
  const rows = cols;
  const walkable = new Uint8Array(cols * rows);
  const nearby: number[] = [];
  const limit = (WORLD_RADIUS - CLEARANCE) ** 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * CELL + CELL / 2;
      const y = r * CELL + CELL / 2;
      if ((x - WORLD_CENTER_X) ** 2 + (y - WORLD_CENTER_Y) ** 2 > limit) continue;
      arena.grid.query(x, y, CLEARANCE, nearby);
      let free = true;
      for (let i = 0; i < nearby.length; i++) {
        if (circleHitsBox(x, y, CLEARANCE, arena.obstacles[nearby[i]!]!)) {
          free = false;
          break;
        }
      }
      if (free) walkable[r * cols + c] = 1;
    }
  }

  const grid = { cell: CELL, cols, rows, walkable, region: regionsOf(walkable, cols, rows) };
  grids.set(arena, grid);
  return grid;
}

/**
 * Las zonas conectadas de la grilla, con un relleno por inundación. Sin esto,
 * pedir un camino a un lugar encerrado —un hueco entre muebles, una caja
 * rodeada— recorría toda la zona alcanzable antes de rendirse: 30 ms por
 * búsqueda, y con dos por tick el servidor se pasaba de los 50 ms del tick.
 *
 * Alcanza con los cuatro vecinos derechos: findPath sólo va en diagonal si las
 * dos celdas de al lado también se pisan, así que conecta lo mismo.
 */
function regionsOf(walkable: Uint8Array, cols: number, rows: number): Int32Array {
  const region = new Int32Array(cols * rows);
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < region.length; start++) {
    if (!walkable[start] || region[start] !== 0) continue;
    next++;
    region[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const c = i % cols;
      const r = (i - c) / cols;
      if (c > 0) visit(i - 1);
      if (c < cols - 1) visit(i + 1);
      if (r > 0) visit(i - cols);
      if (r < rows - 1) visit(i + cols);
    }
  }
  return region;

  function visit(j: number): void {
    if (walkable[j] && region[j] === 0) {
      region[j] = next;
      stack.push(j);
    }
  }
}

function cellOf(grid: NavGrid, x: number, y: number): number {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor(x / grid.cell)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor(y / grid.cell)));
  return r * grid.cols + c;
}

function centerOf(grid: NavGrid, index: number): { x: number; y: number } {
  return {
    x: (index % grid.cols) * grid.cell + grid.cell / 2,
    y: Math.floor(index / grid.cols) * grid.cell + grid.cell / 2,
  };
}

/** La celda caminable más cercana: el destino puede ser una caja, que no se pisa. */
function nearestWalkable(grid: NavGrid, index: number): number {
  if (grid.walkable[index]) return index;
  const c0 = index % grid.cols;
  const r0 = Math.floor(index / grid.cols);
  for (let ring = 1; ring <= 10; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
        const i = r * grid.cols + c;
        if (grid.walkable[i]) return i;
      }
    }
  }
  return -1;
}

/** ¿Se puede ir en línea recta de un punto al otro sin pisar una celda bloqueada? */
export function walkableLine(grid: NavGrid, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(d / (grid.cell / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!grid.walkable[cellOf(grid, ax + (bx - ax) * t, ay + (by - ay) * t)]) return false;
  }
  return true;
}

/** Montículo binario de índices de celda, ordenado por costo estimado. */
class Heap {
  private items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (this.score[a[parent]!]! <= this.score[a[k]!]!) break;
      [a[parent], a[k]] = [a[k]!, a[parent]!];
      k = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.score[a[l]!]! < this.score[a[m]!]!) m = l;
        if (r < a.length && this.score[a[r]!]! < this.score[a[m]!]!) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k]!, a[m]!];
        k = m;
      }
    }
    return top;
  }
}

/**
 * Memoria de trabajo de la búsqueda, reusada entre búsquedas. En vez de limpiar
 * todo cada vez, cada celda guarda el número de búsqueda que la tocó por última
 * vez: si no es la actual, sus valores son viejos y cuentan como sin visitar.
 */
interface Scratch {
  g: Float64Array;
  f: Float64Array;
  from: Int32Array;
  /** Búsqueda que visitó la celda (g/f/from valen) y la que la cerró. */
  seen: Uint32Array;
  done: Uint32Array;
  search: number;
}

const scratches = new WeakMap<NavGrid, Scratch>();

function scratchFor(grid: NavGrid): Scratch {
  let s = scratches.get(grid);
  if (!s) {
    const n = grid.cols * grid.rows;
    s = {
      g: new Float64Array(n),
      f: new Float64Array(n),
      from: new Int32Array(n),
      seen: new Uint32Array(n),
      done: new Uint32Array(n),
      search: 0,
    };
    scratches.set(grid, s);
  }
  return s;
}

const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * Camino de un punto a otro, como una lista de puntos a seguir (sin el de
 * partida). null si no hay forma de llegar. A* sobre la grilla con diagonales,
 * sin cortar esquinas, y después se estira: se saltean los puntos intermedios
 * que se pueden ver en línea recta, para no caminar en zigzag de celda en celda.
 */
export function findPath(
  grid: NavGrid,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number }[] | null {
  const start = nearestWalkable(grid, cellOf(grid, fromX, fromY));
  const goal = nearestWalkable(grid, cellOf(grid, toX, toY));
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [{ x: toX, y: toY }];
  // Sin camino posible: se sabe sin buscar (ver regionsOf).
  if (grid.region[start] !== grid.region[goal]) return null;

  // Los buffers se reusan entre búsquedas: cada bot replanea cada tanto y
  // pedir (y limpiar) medio mega de memoria cada vez es trabajo de más.
  const scratch = scratchFor(grid);
  const { g, f, from, seen, done } = scratch;
  const id = ++scratch.search;
  const open = new Heap(f);
  const gOf = (i: number): number => (seen[i] === id ? g[i]! : Infinity);

  const gc = goal % grid.cols;
  const gr = Math.floor(goal / grid.cols);
  const h = (i: number): number => {
    const dc = Math.abs((i % grid.cols) - gc);
    const dr = Math.abs(Math.floor(i / grid.cols) - gr);
    return (Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr)) * GREED;
  };

  g[start] = 0;
  f[start] = h(start);
  from[start] = -1;
  seen[start] = id;
  open.push(start);
  let expansions = 0;

  while (open.size > 0) {
    const cur = open.pop();
    if (done[cur] === id) continue;
    if (cur === goal) break;
    done[cur] = id;
    if (++expansions > MAX_EXPANSIONS) return null;

    const c = cur % grid.cols;
    const r = Math.floor(cur / grid.cols);
    for (const [dc, dr, cost] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      const next = nr * grid.cols + nc;
      if (!grid.walkable[next] || done[next] === id) continue;
      // En diagonal sólo si las dos celdas de al lado también se pueden pisar:
      // si no, el camino cortaría la esquina de una pared.
      if (dc !== 0 && dr !== 0 && (!grid.walkable[r * grid.cols + nc] || !grid.walkable[nr * grid.cols + c])) {
        continue;
      }
      const tentative = g[cur]! + cost;
      if (tentative >= gOf(next)) continue;
      g[next] = tentative;
      f[next] = tentative + h(next);
      from[next] = cur;
      seen[next] = id;
      open.push(next);
    }
  }

  if (seen[goal] !== id) return null;

  const cells: number[] = [];
  for (let i = goal; i !== start; i = from[i]!) cells.push(i);
  cells.reverse();

  // Estirar: desde cada punto, saltar al más lejano que se vea en línea recta.
  const points = cells.map((i) => centerOf(grid, i));
  points[points.length - 1] = { x: toX, y: toY };
  const path: { x: number; y: number }[] = [];
  let ax = fromX;
  let ay = fromY;
  let i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !walkableLine(grid, ax, ay, points[j]!.x, points[j]!.y)) j--;
    path.push(points[j]!);
    ax = points[j]!.x;
    ay = points[j]!.y;
    i = j + 1;
  }
  return path;
}
