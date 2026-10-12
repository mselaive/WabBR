import { segmentBoxT } from "./collision.js";
import type { ArenaMap, ObstacleKind } from "../map/arena.js";
import type { GameState, PlayerState } from "./types.js";

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

/** Más cerca que esto, el que está en un arbusto se ve igual: lo tenés encima. */
export const BUSH_SPOT_DISTANCE = 90;
/** Lo que te delata un disparo estando en un arbusto: un segundo y medio. */
export const BUSH_SHOT_REVEAL_TICKS = 30;

/**
 * ¿El objetivo está escondido en un arbusto para quien mira desde (x, y)?
 * Esconderse no frena las balas, sólo la vista: el que tira a ciegas al
 * arbusto puede pegarte igual. Disparar te delata un rato, y de muy cerca se
 * te ve. La usan el servidor —para no mandarte a los que no ves— y los bots,
 * para no hacer trampa.
 */
export function concealedFrom(state: GameState, target: PlayerState, x: number, y: number): boolean {
  if (!target.inBush) return false;
  if (state.tick - target.lastShotTick <= BUSH_SHOT_REVEAL_TICKS) return false;
  const dx = target.x - x;
  const dy = target.y - y;
  return dx * dx + dy * dy > BUSH_SPOT_DISTANCE * BUSH_SPOT_DISTANCE;
}
