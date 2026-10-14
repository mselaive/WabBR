/** Hasta cuántos radianes de la línea, y a qué distancia, ayuda la mira del stick. */
export const AIM_ASSIST_CONE = 0.18;
export const AIM_ASSIST_RANGE = 700;

/**
 * Ayuda de puntería para el stick: si hay un rival a la vista casi en la
 * línea (a menos de ~10° y de 700 px), la mira se corre la mayor parte del
 * camino hacia él. Con el pulgar no se apunta como con el mouse, y entre
 * amigos se juega mezclado. Es sólo hacia dónde apuntás: el tiro lo decide el
 * servidor igual que siempre. Con varios, el más cercano a la línea.
 */
export function assistAim(
  me: { x: number; y: number },
  aim: number,
  targets: readonly { x: number; y: number }[],
): number {
  let best: number | null = null;
  let bestOff = AIM_ASSIST_CONE;
  for (const t of targets) {
    const dx = t.x - me.x;
    const dy = t.y - me.y;
    if (dx * dx + dy * dy > AIM_ASSIST_RANGE * AIM_ASSIST_RANGE) continue;
    const to = Math.atan2(dy, dx);
    const off = Math.abs(Math.atan2(Math.sin(to - aim), Math.cos(to - aim)));
    if (off < bestOff) {
      bestOff = off;
      best = to;
    }
  }
  if (best === null) return aim;
  const diff = Math.atan2(Math.sin(best - aim), Math.cos(best - aim));
  return aim + diff * 0.7;
}
