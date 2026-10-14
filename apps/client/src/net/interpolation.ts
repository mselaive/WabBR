import {
  MS_PER_TICK,
  lerp,
  lerpAngle,
  unpackAirdrop,
  unpackBullet,
  unpackGrenade,
  unpackPlayer,
  unpackSmoke,
  unpackStrike,
  unpackZone,
  type SmokeState,
  type SnapshotMsg,
  type UnpackedStrike,
  type UnpackedAirdrop,
  type UnpackedGrenade,
  type UnpackedPlayer,
  type UnpackedZone,
} from "@wabbr/shared";

export interface Frame {
  tick: number;
  /** Reloj local en que llegó, que es contra el que se interpola. */
  recvAt: number;
  players: Map<number, UnpackedPlayer>;
  grenades: Map<number, UnpackedGrenade>;
  airdrops: Map<number, UnpackedAirdrop>;
  smokes: Map<number, SmokeState>;
  strikes: UnpackedStrike[];
  zone: UnpackedZone;
}

/** Lo que se sabe de una bala del servidor, para ubicarla en cualquier instante. */
interface BulletTrack {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Llegada del último snapshot que la trajo: de ahí sale x/y. */
  seenAt: number;
  /** Número de ese snapshot, para saber cuáles dejaron de venir. */
  seenIn: number;
  /** Llegada del primer snapshot que la trajo. */
  bornAt: number;
  /** Llegada del primero que ya no la trajo. Infinity mientras siga viniendo. */
  goneAt: number;  rocket: boolean;
}

export interface InterpolatedBullet {
  id: number;
  x: number;
  y: number;
  angle: number;
  rocket?: boolean;
}

export interface InterpolatedFrame {
  /**
   * Tick del servidor que se está mostrando, con fracción: entre dos snapshots
   * se dibuja una mezcla de los dos. El servidor lo usa para saber dónde veías
   * a los demás cuando disparaste.
   */
  tick: number;
  players: UnpackedPlayer[];
  bullets: InterpolatedBullet[];
  grenades: UnpackedGrenade[];
  /** Paquetes aéreos cayendo, con lo que les falta para aterrizar interpolado. */
  airdrops: UnpackedAirdrop[];
  /** Nubes de humo, con lo que les queda interpolado (crecen y se disipan). */
  smokes: SmokeState[];
  /** Bombardeos anunciados o en curso. */
  strikes: UnpackedStrike[];
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
  private readonly bulletTracks = new Map<number, BulletTrack>();
  private pushed = 0;

  push(msg: SnapshotMsg, recvAt: number): void {
    this.trackBullets(msg, recvAt);
    const players = new Map<number, UnpackedPlayer>();
    for (const raw of msg.players) {
      const p = unpackPlayer(raw);
      players.set(p.id, p);
    }
    this.frames.push({
      tick: msg.tick,
      recvAt,
      players,
      grenades: new Map(msg.gr.map(unpackGrenade).map((g) => [g.id, g])),
      airdrops: new Map((msg.ad ?? []).map(unpackAirdrop).map((a) => [a.id, a])),
      smokes: new Map((msg.sm ?? []).map(unpackSmoke).map((s) => [s.id, s])),
      strikes: (msg.rz ?? []).map(unpackStrike),
      zone: unpackZone(msg.zone),
    });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  clear(): void {
    this.frames.length = 0;
    this.bulletTracks.clear();
  }

  private trackBullets(msg: SnapshotMsg, recvAt: number): void {
    const n = ++this.pushed;
    for (const raw of msg.bullets) {
      const b = unpackBullet(raw);
      const track = this.bulletTracks.get(b.id);
      if (track) {
        track.x = b.x;
        track.y = b.y;
        track.vx = b.vx;
        track.vy = b.vy;
        track.seenAt = recvAt;
        track.seenIn = n;
        // Volvió a la vista después de esconderse detrás de algo.
        track.goneAt = Infinity;
      } else {
        this.bulletTracks.set(b.id, { ...b, seenAt: recvAt, seenIn: n, bornAt: recvAt, goneAt: Infinity });
      }
    }

    for (const [id, track] of this.bulletTracks) {
      if (track.seenIn === n) continue;
      if (track.goneAt === Infinity) track.goneAt = recvAt;
      // Ni el reloj atrasado la va a volver a necesitar.
      else if (recvAt - track.goneAt > 1000) this.bulletTracks.delete(id);
    }
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
    //
    // Lo que sí hace falta es que vivan en el mismo reloj atrasado que los
    // jugadores. Antes se tomaban del último snapshot y se corrían hacia atrás
    // los 100 ms de la interpolación: una bala recién disparada aparecía metida
    // dentro del que la tiró, que todavía no había disparado en pantalla, y una
    // que ya había chocado desaparecía antes de llegar a la pared.
    //
    // Ahora aparece cuando el reloj atrasado llega al momento en que salió —un
    // tick antes del snapshot que la trajo, que es cuando estaba en el caño— y
    // se va cuando llega al primer snapshot que ya no la trajo.
    const bullets: InterpolatedBullet[] = [];
    for (const [id, b] of this.bulletTracks) {
      if (renderTime < b.bornAt - MS_PER_TICK || renderTime >= b.goneAt) continue;
      const dt = (renderTime - b.seenAt) / 1000;
      bullets.push({ id, x: b.x + b.vx * dt, y: b.y + b.vy * dt, angle: Math.atan2(b.vy, b.vx), rocket: b.rocket });
    }

    if (renderTime >= last.recvAt) {
      return {
        tick: last.tick,
        players: [...last.players.values()],
        bullets,
        grenades: [...last.grenades.values()],
        airdrops: [...last.airdrops.values()],
        smokes: [...last.smokes.values()],
        strikes: last.strikes,
        zone: last.zone,
      };
    }
    if (renderTime <= first.recvAt) {
      return {
        tick: first.tick,
        players: [...first.players.values()],
        bullets,
        grenades: [...first.grenades.values()],
        airdrops: [...first.airdrops.values()],
        smokes: [...first.smokes.values()],
        strikes: first.strikes,
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

    // El paquete baja parejo entre snapshots, como todo lo demás.
    const airdrops: UnpackedAirdrop[] = [];
    for (const [id, target] of b.airdrops) {
      const prev = a.airdrops.get(id);
      airdrops.push(prev ? { ...target, ticksLeft: lerp(prev.ticksLeft, target.ticksLeft, t) } : target);
    }

    const smokes: SmokeState[] = [];
    for (const [id, target] of b.smokes) {
      const prev = a.smokes.get(id);
      smokes.push(prev ? { ...target, ticksLeft: lerp(prev.ticksLeft, target.ticksLeft, t) } : target);
    }

    return {
      tick: lerp(a.tick, b.tick, t),
      players,
      bullets,
      grenades,
      airdrops,
      smokes,
      strikes: b.strikes,
      zone: {
        ...b.zone,
        x: lerp(a.zone.x, b.zone.x, t),
        y: lerp(a.zone.y, b.zone.y, t),
        radius: lerp(a.zone.radius, b.zone.radius, t),
      },
    };
  }
}
