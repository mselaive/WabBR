/**
 * PRNG determinista (mulberry32). Solo usa enteros + una división, así que da
 * exactamente los mismos valores en V8, workerd y cualquier otro motor.
 * Nunca uses Math.random() dentro de la simulación: rompería la reconciliación.
 */
export function nextRandom(state: number): { state: number; value: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Generador con estado propio, para código fuera de la simulación (mapa, spawns). */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    const r = nextRandom(s);
    s = r.state;
    return r.value;
  };
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolación angular por el camino corto. Para el ángulo de apuntado. */
export function lerpAngle(a: number, b: number, t: number): number {
  // Sin bucles: con un ángulo enorme (que el servidor ya no deja pasar), restar
  // 2π de a uno no terminaba nunca y colgaba la pestaña.
  let d = (b - a) % (Math.PI * 2);
  if (!Number.isFinite(d)) return Number.isFinite(b) ? b : a;
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
