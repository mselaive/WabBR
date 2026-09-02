import { segmentBoxT } from "./collision.js";
import type { ArenaMap, ObstacleKind } from "../map/arena.js";

/**
 * Línea de vista. Una sola función, usada por los dos lados: el servidor la usa
 * para no contarte lo que no podés ver, y el cliente para dibujar las sombras.
 * Si cada uno tuviera su versión, tarde o temprano dirían cosas distintas.
 */

/**
 * Qué tapa la vista. La regla es **la cobertura baja frena balas, las paredes
 * frenan las dos cosas**: una caja te salva de un tiro pero mirás por encima,
 * y una pared te esconde. Es una convención que la gente ya entiende sin que
 * nadie se la explique.
 */
export const BLOCKS_SIGHT: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>([
  "buildingWall",
  "wall",
  "container",
  "silo",
]);

/**
 * Alcance máximo de la vista. Un poco más que la diagonal de la pantalla, para
 * que en un monitor ancho no se recorte algo que debería verse.
 */
export const MAX_SIGHT = 1150;

/**
 * Cuánto se encoge la caja al probar si tapa. Sin esto, pasar rozando la
 * esquina de una pared te haría parpadear por un píxel de diferencia.
 */
const SIGHT_SHRINK = 3;

const scratch: number[] = [];

/**
 * ¿Se ve el punto B desde el punto A?
 *
 * Se mide de centro a centro. Sería más fiel probar también los costados del
 * jugador —asomarte por una esquina debería mostrar tu hombro antes que tu
 * centro— pero triplica el costo, y el margen de gracia del servidor tapa la
 * diferencia mejor de lo que la notaría alguien jugando.
 */
export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  arena: ArenaMap,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dist2 = dx * dx + dy * dy;

  if (dist2 > MAX_SIGHT * MAX_SIGHT) return false;
  if (dist2 < 1) return true;

  // Sólo las celdas que el segmento pisa: consultar el círculo que lo contiene
  // traería medio mapa en cada prueba.
  arena.grid.querySegment(ax, ay, bx, by, scratch);

  for (let i = 0; i < scratch.length; i++) {
    const o = arena.obstacles[scratch[i]!];
    if (!o || !BLOCKS_SIGHT.has(o.kind)) continue;
    const t = segmentBoxT(ax, ay, dx, dy, -SIGHT_SHRINK, o);
    if (t >= 0 && t <= 1) return false;
  }

  return true;
}
