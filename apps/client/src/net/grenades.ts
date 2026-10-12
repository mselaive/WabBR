import { advanceGrenade, type ArenaMap, type UnpackedGrenade } from "@wabbr/shared";

/** Una granada tuya tirada desde acá, sin esperar al servidor. */
interface LocalGrenade {
  /** Negativo, para no chocar con los ids del servidor. */
  id: number;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
  /** Posición antes del último tick, para dibujarla entre dos pasos. */
  prevX: number;
  prevY: number;
  /** Id de la misma granada en el servidor, cuando llega el "throw". */
  serverId: number;
}

/**
 * Tus granadas, que salen de la mano en el mismo input en que apretás G.
 *
 * Tenían el mismo atraso que tenían las balas: aparecían un ping más 100 ms
 * después, desde donde estabas antes. Ahora se tiran y ruedan acá con la misma
 * física que en el servidor (`advanceGrenade`, mismo mapa), así que van por el
 * mismo lado y estallan en el mismo lugar. El daño lo sigue decidiendo el
 * servidor: acá sólo se dibuja.
 */
export class LocalGrenades {
  private list: LocalGrenade[] = [];
  /** Granadas del servidor que ya dibujamos nosotros, con su copia local. */
  private readonly covered = new Set<number>();
  private nextId = -1;

  /** Se tiró una: aparece ya. El tick de vuelo lo da `tick()`, igual que en el servidor. */
  throw(seq: number, launch: { x: number; y: number; vx: number; vy: number; fuse: number }): void {
    this.list.push({ id: this.nextId--, seq, ...launch, prevX: launch.x, prevY: launch.y, serverId: -1 });
  }

  /**
   * Un tick de simulación, al mismo ritmo que los inputs. Devuelve dónde
   * estallaron las que estallaron, para dibujar la explosión.
   */
  tick(arena: ArenaMap): { x: number; y: number }[] {
    const blasts: { x: number; y: number }[] = [];
    this.list = this.list.filter((g) => {
      g.prevX = g.x;
      g.prevY = g.y;
      if (advanceGrenade(g, arena)) return true;
      blasts.push({ x: g.x, y: g.y });
      return false;
    });
    return blasts;
  }

  /** Llegó el "throw" de una tuya: desde ahora la del servidor no se dibuja. */
  confirm(seq: number, serverId: number): boolean {
    const g = this.list.find((x) => x.seq === seq && x.serverId === -1);
    if (!g) return false;
    g.serverId = serverId;
    this.covered.add(serverId);
    return true;
  }

  /** Una predicha cuyo input ya procesó el servidor sin "throw" nunca salió. */
  settle(lastSeq: number): void {
    this.list = this.list.filter((g) => g.serverId !== -1 || g.seq > lastSeq);
  }

  covers(serverId: number): boolean {
    return this.covered.has(serverId);
  }

  /** Para dibujar, entre el tick anterior y el actual. */
  grenades(alpha: number): UnpackedGrenade[] {
    const t = Math.max(0, Math.min(1, alpha));
    return this.list.map((g) => ({
      id: g.id,
      x: g.prevX + (g.x - g.prevX) * t,
      y: g.prevY + (g.y - g.prevY) * t,
      fuse: g.fuse,
    }));
  }

  clear(): void {
    this.list = [];
    this.covered.clear();
  }
}
