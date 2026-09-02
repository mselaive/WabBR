import {
  lerp,
  lerpAngle,
  unpackBullet,
  unpackGrenade,
  unpackPlayer,
  unpackZone,
  type SnapshotMsg,
  type UnpackedBullet,
  type UnpackedGrenade,
  type UnpackedPlayer,
  type UnpackedZone,
} from "@wabbr/shared";

export interface Frame {
  tick: number;
  /** Reloj local en que llegó, que es contra el que se interpola. */
  recvAt: number;
  players: Map<number, UnpackedPlayer>;
  bullets: UnpackedBullet[];
  grenades: Map<number, UnpackedGrenade>;
  zone: UnpackedZone;
}

export interface InterpolatedBullet {
  id: number;
  x: number;
  y: number;
  angle: number;
}

export interface InterpolatedFrame {
  players: UnpackedPlayer[];
  bullets: InterpolatedBullet[];
  grenades: UnpackedGrenade[];
  zone: UnpackedZone;
}

const MAX_FRAMES = 30;

/**
 * Los snapshots llegan 20 veces por segundo y la pantalla dibuja 60: si
 * pusiéramos las posiciones tal cual, todo se movería a saltos. Acá se guarda
 * un pequeño historial y se dibuja ~100 ms en el pasado, interpolando entre los
 * dos snapshots que rodean ese instante.
 */
export class SnapshotBuffer {
  private frames: Frame[] = [];

  push(msg: SnapshotMsg, recvAt: number): void {
    const players = new Map<number, UnpackedPlayer>();
    for (const raw of msg.players) {
      const p = unpackPlayer(raw);
      players.set(p.id, p);
    }
    this.frames.push({
      tick: msg.tick,
      recvAt,
      players,
      bullets: msg.bullets.map(unpackBullet),
      grenades: new Map(msg.gr.map(unpackGrenade).map((g) => [g.id, g])),
      zone: unpackZone(msg.zone),
    });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  clear(): void {
    this.frames.length = 0;
  }

  get latest(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** Estado a dibujar en `renderTime` (reloj local, normalmente ahora - 100 ms). */
  sample(renderTime: number): InterpolatedFrame | null {
    const last = this.frames[this.frames.length - 1];
    if (!last) return null;

    const first = this.frames[0]!;

    // Las balas viajan en línea recta, así que su posición exacta en cualquier
    // instante sale de la ecuación: no hace falta interpolar entre snapshots.
    const bullets: InterpolatedBullet[] = last.bullets.map((b) => {
      const dt = (renderTime - last.recvAt) / 1000;
      return {
        id: b.id,
        x: b.x + b.vx * dt,
        y: b.y + b.vy * dt,
        angle: Math.atan2(b.vy, b.vx),
      };
    });

    if (renderTime >= last.recvAt) {
      return {
        players: [...last.players.values()],
        bullets,
        grenades: [...last.grenades.values()],
        zone: last.zone,
      };
    }
    if (renderTime <= first.recvAt) {
      return {
        players: [...first.players.values()],
        bullets,
        grenades: [...first.grenades.values()],
        zone: first.zone,
      };
    }

    let a = first;
    let b = last;
    for (let i = 0; i < this.frames.length - 1; i++) {
      const cur = this.frames[i]!;
      const next = this.frames[i + 1]!;
      if (cur.recvAt <= renderTime && renderTime <= next.recvAt) {
        a = cur;
        b = next;
        break;
      }
    }

    const span = b.recvAt - a.recvAt;
    const t = span > 0 ? (renderTime - a.recvAt) / span : 1;

    const players: UnpackedPlayer[] = [];
    for (const [id, target] of b.players) {
      const prev = a.players.get(id);
      if (!prev) {
        players.push(target);
        continue;
      }
      players.push({
        ...target,
        x: lerp(prev.x, target.x, t),
        y: lerp(prev.y, target.y, t),
        aim: lerpAngle(prev.aim, target.aim, t),
      });
    }

    // Las granadas ruedan y frenan, así que se interpolan como los jugadores.
    const grenades: UnpackedGrenade[] = [];
    for (const [id, target] of b.grenades) {
      const prev = a.grenades.get(id);
      grenades.push(
        prev ? { ...target, x: lerp(prev.x, target.x, t), y: lerp(prev.y, target.y, t) } : target,
      );
    }

    return {
      players,
      bullets,
      grenades,
      zone: {
        ...b.zone,
        x: lerp(a.zone.x, b.zone.x, t),
        y: lerp(a.zone.y, b.zone.y, t),
        radius: lerp(a.zone.radius, b.zone.radius, t),
      },
    };
  }
}
