import { clamp } from "../math.js";
import { WORLD_CENTER_X, WORLD_CENTER_Y, WORLD_RADIUS } from "../constants.js";

export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Índice espacial uniforme sobre los obstáculos estáticos del mapa.
 * Se construye una vez; el mapa no cambia durante la partida.
 */
export class ObstacleGrid {
  readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];

  constructor(
    readonly boxes: readonly AABB[],
    cell = 128,
  ) {
    this.cell = cell;
    this.cols = Math.ceil((WORLD_RADIUS * 2) / cell) + 2;
    this.rows = this.cols;
    this.buckets = Array.from({ length: this.cols * this.rows }, () => [] as number[]);
    this.stamp = new Int32Array(boxes.length);

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      const x0 = this.col(b.x);
      const x1 = this.col(b.x + b.w);
      const y0 = this.row(b.y);
      const y1 = this.row(b.y + b.h);
      for (let r = y0; r <= y1; r++) {
        for (let c = x0; c <= x1; c++) {
          this.buckets[r * this.cols + c]!.push(i);
        }
      }
    }
  }

  /** Sello de visita: evita el includes() cuadrático al desduplicar. */
  private readonly stamp: Int32Array;
  private tick = 0;

  private col(x: number): number {
    return clamp(Math.floor(x / this.cell), 0, this.cols - 1);
  }

  private row(y: number): number {
    return clamp(Math.floor(y / this.cell), 0, this.rows - 1);
  }

  /** Índices de obstáculos que podrían tocar el círculo dado. */
  query(x: number, y: number, r: number, out: number[]): number[] {
    out.length = 0;
    this.tick++;
    const x0 = this.col(x - r);
    const x1 = this.col(x + r);
    const y0 = this.row(y - r);
    const y1 = this.row(y + r);
    for (let row = y0; row <= y1; row++) {
      for (let c = x0; c <= x1; c++) {
        this.collect(row * this.cols + c, out);
      }
    }
    return out;
  }

  /**
   * Índices de obstáculos que podrían cruzar el segmento, recorriendo sólo las
   * celdas que el segmento pisa (DDA). Consultar el círculo que contiene al
   * segmento traería medio mapa: una línea de visión mide cientos de píxeles.
   */
  querySegment(x0: number, y0: number, x1: number, y1: number, out: number[]): number[] {
    out.length = 0;
    this.tick++;

    let cx = this.col(x0);
    let cy = this.row(y0);
    const endX = this.col(x1);
    const endY = this.row(y1);

    const stepX = x1 > x0 ? 1 : -1;
    const stepY = y1 > y0 ? 1 : -1;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);

    // Distancia hasta el próximo borde de celda, en unidades del parámetro t.
    let tMaxX = dx === 0 ? Infinity : this.edge(x0, cx, stepX) / dx;
    let tMaxY = dy === 0 ? Infinity : this.edge(y0, cy, stepY) / dy;
    const tDeltaX = dx === 0 ? Infinity : this.cell / dx;
    const tDeltaY = dy === 0 ? Infinity : this.cell / dy;

    // Tope de pasos: el segmento no puede cruzar más celdas que la rejilla.
    for (let guard = 0; guard < this.cols + this.rows + 4; guard++) {
      this.collect(cy * this.cols + cx, out);
      if (cx === endX && cy === endY) break;
      if (tMaxX < tMaxY) {
        if (tMaxX > 1) break;
        cx = clamp(cx + stepX, 0, this.cols - 1);
        tMaxX += tDeltaX;
      } else {
        if (tMaxY > 1) break;
        cy = clamp(cy + stepY, 0, this.rows - 1);
        tMaxY += tDeltaY;
      }
    }
    return out;
  }

  /** Distancia en píxeles del punto al borde de su celda, en la dirección dada. */
  private edge(v: number, cell: number, step: number): number {
    const lo = cell * this.cell;
    return step > 0 ? lo + this.cell - v : v - lo;
  }

  private collect(bucketIndex: number, out: number[]): void {
    const bucket = this.buckets[bucketIndex];
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) {
      const idx = bucket[i]!;
      if (this.stamp[idx] === this.tick) continue;
      this.stamp[idx] = this.tick;
      out.push(idx);
    }
  }
}

export function circleHitsBox(x: number, y: number, r: number, b: AABB): boolean {
  const nx = clamp(x, b.x, b.x + b.w);
  const ny = clamp(y, b.y, b.y + b.h);
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

/** Resultado reutilizable para no asignar objetos en el hot path. */
export interface Resolved {
  x: number;
  y: number;
}

/**
 * Empuja el círculo fuera de la caja por el eje de menor penetración.
 * Escribe en `out` y devuelve true si hubo corrección.
 */
export function resolveCircleBox(x: number, y: number, r: number, b: AABB, out: Resolved): boolean {
  const nx = clamp(x, b.x, b.x + b.w);
  const ny = clamp(y, b.y, b.y + b.h);
  let dx = x - nx;
  let dy = y - ny;
  const d2 = dx * dx + dy * dy;

  if (d2 >= r * r) return false;

  if (d2 > 1e-9) {
    // El centro está fuera de la caja: empujar por la normal.
    const d = Math.sqrt(d2);
    const push = r - d;
    out.x = x + (dx / d) * push;
    out.y = y + (dy / d) * push;
    return true;
  }

  // Centro dentro de la caja: salir por el borde más cercano.
  const left = x - b.x;
  const right = b.x + b.w - x;
  const top = y - b.y;
  const bottom = b.y + b.h - y;
  const min = Math.min(left, right, top, bottom);
  out.x = x;
  out.y = y;
  if (min === left) out.x = b.x - r;
  else if (min === right) out.x = b.x + b.w + r;
  else if (min === top) out.y = b.y - r;
  else out.y = b.y + b.h + r;
  return true;
}

/** Mantiene un círculo dentro del muro circular de la arena. */
export function clampToArena(x: number, y: number, r: number, out: Resolved): void {
  const dx = x - WORLD_CENTER_X;
  const dy = y - WORLD_CENTER_Y;
  const d2 = dx * dx + dy * dy;
  const max = WORLD_RADIUS - r;
  if (d2 <= max * max) {
    out.x = x;
    out.y = y;
    return;
  }
  const d = Math.sqrt(d2) || 1;
  out.x = WORLD_CENTER_X + (dx / d) * max;
  out.y = WORLD_CENTER_Y + (dy / d) * max;
}

export function insideArena(x: number, y: number, r: number): boolean {
  const dx = x - WORLD_CENTER_X;
  const dy = y - WORLD_CENTER_Y;
  const max = WORLD_RADIUS - r;
  return dx * dx + dy * dy <= max * max;
}

/**
 * Las balas viajan ~32 px por tick, más que el radio de un jugador: si sólo
 * mirásemos la posición final atravesarían gente y paredes. Por eso los
 * impactos se resuelven con tests de segmento (el barrido del tick completo).
 */

/** t de impacto en [0,1] del segmento contra la caja expandida por `r`, o -1. */
export function segmentBoxT(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  r: number,
  b: AABB,
): number {
  const minX = b.x - r;
  const minY = b.y - r;
  const maxX = b.x + b.w + r;
  const maxY = b.y + b.h + r;

  let tmin = 0;
  let tmax = 1;

  if (Math.abs(dx) < 1e-9) {
    if (x0 < minX || x0 > maxX) return -1;
  } else {
    let t1 = (minX - x0) / dx;
    let t2 = (maxX - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  if (Math.abs(dy) < 1e-9) {
    if (y0 < minY || y0 > maxY) return -1;
  } else {
    let t1 = (minY - y0) / dy;
    let t2 = (maxY - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  return tmin;
}

/** t de impacto en [0,1] del segmento contra un círculo, o -1. */
export function segmentCircleT(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return fx * fx + fy * fy <= r * r ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + sq) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}
