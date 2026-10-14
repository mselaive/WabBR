import {
  BULLET_RADIUS,
  DT,
  PLAYER_RADIUS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  segmentBoxT,
  segmentCircleT,
  weaponStats,
  type ArenaMap,
} from "@wabbr/shared";
import type { InterpolatedBullet } from "./interpolation.js";
import type { PredictedShot } from "./prediction.js";

/** Más que la vida de cualquier bala más un ping malo: pasado esto ya no llega nada de ese tiro. */
const SHOT_MEMORY_MS = 3000;
/** Constante de tiempo con la que la bala pasa del arma dibujada a su trayectoria real. */
const OFFSET_DECAY_TAU = 0.04;

interface LocalBullet {
  /** Negativo, para no chocar nunca con los ids del servidor. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Segundos de vuelo que le quedan: lo mismo que recorre la del servidor. */
  life: number;
  /** Hasta dónde ya se la avanzó, en el reloj de performance.now(). */
  movedAt: number;
  /**
   * Corrimiento sólo visual, que se licúa a cero. Tu muñeco se dibuja hasta un
   * tick detrás de su posición simulada, que es de donde sale la bala: sin
   * esto, corriendo de costado, la bala nacería 10 px al lado del arma.
   */
  offX: number;
  offY: number;
  alive: boolean;
  rocket: boolean;
}

interface Shot {
  seq: number;
  firedAt: number;
  /** El servidor ya avisó que este disparo salió de verdad. */
  confirmed: boolean;
  bullets: LocalBullet[];
  /** Ids de las mismas balas en el servidor, una vez confirmado. */
  serverIds: number[];
}

export interface Target {
  id: number;
  x: number;
  y: number;
}

/**
 * Tus propias balas, dibujadas desde que apretás el gatillo.
 *
 * Antes salían recién cuando el servidor las mandaba de vuelta, y encima se
 * dibujaban con el mismo atraso de 100 ms que los demás jugadores: entre el
 * click y la bala pasaba el ping más 150 ms, y como para entonces ya te habías
 * movido, la bala salía de atrás tuyo.
 *
 * Ahora el disparo se decide acá con la misma función que en el servidor y la
 * dispersión sale del seq del input, así que la bala dibujada va exactamente
 * por donde va la real. Cuando llega el evento "shot" se emparejan por seq y
 * las del servidor se dejan de dibujar. Si se predijo un tiro que el servidor
 * no hizo, se borra en cuanto el servidor confirma ese input sin él.
 *
 * Lo que decide si le pegaste a alguien sigue siendo el servidor: la bala local
 * se frena contra el jugador que ves, pero la sangre y el número de daño llegan
 * sólo con el evento "hit".
 */
export class LocalShots {
  private shots: Shot[] = [];
  /** Id de bala del servidor -> su copia local. */
  private readonly byServerId = new Map<number, LocalBullet>();
  private nextId = -1;
  private readonly nearby: number[] = [];

  /** `offX/offY`: dónde está el arma dibujada respecto de la simulada. */
  fire(shot: PredictedShot, now: number, offX = 0, offY = 0): void {
    const def = weaponStats(shot.weapon, shot.tier);
    const life = def.lifeTicks * DT;
    this.shots.push({
      seq: shot.seq,
      firedAt: now,
      confirmed: false,
      bullets: shot.pellets.map((p) => ({
        id: this.nextId--,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        life,
        movedAt: now,
        offX,
        offY,
        alive: true,
        rocket: def.explosive === true,
      })),
      serverIds: [],
    });
  }

  /**
   * Llegó el "shot" de un disparo tuyo. Devuelve true si ya lo estábamos
   * dibujando; false si el servidor disparó algo que no se predijo, y entonces
   * sus balas se dibujan como las de cualquiera.
   */
  confirm(seq: number, firstBullet: number, pellets: number): boolean {
    const shot = this.shots.find((s) => s.seq === seq && !s.confirmed);
    if (!shot) return false;
    shot.confirmed = true;
    const n = Math.min(pellets, shot.bullets.length);
    for (let i = 0; i < n; i++) {
      this.byServerId.set(firstBullet + i, shot.bullets[i]!);
      shot.serverIds.push(firstBullet + i);
    }
    return true;
  }

  /**
   * El servidor ya procesó hasta `lastSeq`. Un disparo predicho de antes que
   * no confirmó nunca existió —se cruzó con una recarga, un cambio de arma o
   * un input perdido— y su bala no puede seguir en pantalla.
   */
  settle(lastSeq: number): void {
    this.shots = this.shots.filter((shot) => {
      if (shot.confirmed || shot.seq > lastSeq) return true;
      for (const b of shot.bullets) b.alive = false;
      return false;
    });
  }

  /** ¿Esta bala del servidor ya la estamos dibujando nosotros? */
  covers(serverBullet: number): boolean {
    return this.byServerId.has(serverBullet);
  }

  /**
   * El servidor dice que una bala pegó contra algo. Devuelve si hay que dibujar
   * su chispa: no, si la bala es nuestra, porque de sus efectos ya se encargó
   * la copia local al chocar.
   */
  serverImpact(serverBullet: number): boolean {
    const local = this.byServerId.get(serverBullet);
    if (!local) return true;
    if (local.alive) {
      // La copia local no chocó donde la real: se corta acá y vale lo del servidor.
      local.alive = false;
      return true;
    }
    return false;
  }

  /** Una bala nuestra le pegó a alguien: si la copia local seguía volando, se frena. */
  serverHit(serverBullet: number): void {
    const local = this.byServerId.get(serverBullet);
    if (local) local.alive = false;
  }

  /**
   * Avanza las balas hasta `now`. Chocan contra lo mismo que en el servidor
   * —obstáculos y borde de la arena— y además contra los jugadores tal como se
   * ven en pantalla. `onWall` recibe dónde pegó cada una, para la chispa.
   */
  update(
    now: number,
    arena: ArenaMap,
    targets: readonly Target[],
    onWall: (x: number, y: number) => void,
  ): void {
    for (const shot of this.shots) {
      for (const b of shot.bullets) {
        if (!b.alive) continue;
        // Cada una desde su último avance: una que salió hace 2 ms en este
        // mismo cuadro no puede adelantar un cuadro entero.
        const dt = Math.max(0, now - b.movedAt) / 1000;
        b.movedAt = now;
        const k = Math.exp(-dt / OFFSET_DECAY_TAU);
        b.offX *= k;
        b.offY *= k;
        this.advance(b, dt, arena, targets, onWall);
      }
    }

    // Lo viejo se olvida, también el emparejamiento con las balas del servidor.
    if (this.shots.length > 0 && now - this.shots[0]!.firedAt > SHOT_MEMORY_MS) {
      this.shots = this.shots.filter((shot) => {
        if (now - shot.firedAt <= SHOT_MEMORY_MS) return true;
        for (const id of shot.serverIds) this.byServerId.delete(id);
        return false;
      });
    }
  }

  /** Las que siguen volando, listas para dibujar. */
  bullets(): InterpolatedBullet[] {
    const out: InterpolatedBullet[] = [];
    for (const shot of this.shots) {
      for (const b of shot.bullets) {
        if (b.alive) {
          out.push({ id: b.id, x: b.x + b.offX, y: b.y + b.offY, angle: Math.atan2(b.vy, b.vx), rocket: b.rocket });
        }
      }
    }
    return out;
  }

  clear(): void {
    this.shots = [];
    this.byServerId.clear();
  }

  /** Lo mismo que hace stepBullets con una bala, pero con el paso del cuadro. */
  private advance(
    b: LocalBullet,
    dt: number,
    arena: ArenaMap,
    targets: readonly Target[],
    onWall: (x: number, y: number) => void,
  ): void {
    const span = Math.min(dt, b.life);
    const dx = b.vx * span;
    const dy = b.vy * span;

    let bestT = 1;
    let hitPlayer = false;
    let hitBox = false;

    for (const target of targets) {
      const t = segmentCircleT(b.x, b.y, dx, dy, target.x, target.y, PLAYER_RADIUS + BULLET_RADIUS);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = true;
      }
    }

    const nearby = this.nearby;
    arena.grid.query(b.x + dx * 0.5, b.y + dy * 0.5, Math.abs(dx) + Math.abs(dy) + BULLET_RADIUS, nearby);
    for (let i = 0; i < nearby.length; i++) {
      const t = segmentBoxT(b.x, b.y, dx, dy, BULLET_RADIUS, arena.obstacles[nearby[i]!]!);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitPlayer = false;
        hitBox = true;
      }
    }

    b.x += dx * bestT;
    b.y += dy * bestT;
    b.life -= span;

    if (hitPlayer) {
      b.alive = false;
      return;
    }

    const cx = b.x - WORLD_CENTER_X;
    const cy = b.y - WORLD_CENTER_Y;
    const limit = WORLD_RADIUS - BULLET_RADIUS;
    if (hitBox || cx * cx + cy * cy >= limit * limit) {
      b.alive = false;
      onWall(b.x, b.y);
      return;
    }

    if (b.life <= 0) b.alive = false;
  }
}
