import {
  STRIKE_RADIUS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  playerColor,
  type ArenaMap,
  type PlayerMeta,
} from "@wabbr/shared";
import type { InterpolatedFrame } from "../net/interpolation.js";

/**
 * Color de cada suelo de distrito, en el mismo orden que las texturas del
 * mundo. El índice -1 (el parque, que se queda con el pasto) usa el fallback.
 */
const DISTRICT_COLORS: Record<number, string> = {
  0: "#4b4e52", // asfalto
  1: "#7d5a34", // tierra arada
  2: "#6f6a62", // gravilla
  3: "#93794d", // tierra pisada
};

/**
 * El minimapa se dibuja en canvas 2D y no en Pixi: son cuatro círculos y unos
 * puntos, y así no compite por el mismo contexto WebGL que el mundo.
 */
/** Un lugar marcado por alguien de tu pareja (ver `MarkedMsg`). */
export interface Mark {
  by: number;
  x: number;
  y: number;
  color: number;
  /** Cuándo llegó y hasta cuándo se muestra (performance.now()). */
  at: number;
  until: number;
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly scale: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly arena: ArenaMap,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.size = canvas.width;
    // Todo el mundo entra en el minimapa, con un margen de 4 px.
    this.scale = (this.size - 8) / (WORLD_RADIUS * 2);
  }

  private tx(x: number): number {
    return (x - (WORLD_CENTER_X - WORLD_RADIUS)) * this.scale + 4;
  }

  private ty(y: number): number {
    return (y - (WORLD_CENTER_Y - WORLD_RADIUS)) * this.scale + 4;
  }

  /** Del click en el minimapa (píxeles CSS del elemento) al punto del mundo. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    // El lienzo puede dibujarse más chico que su tamaño (el HUD se achica en el teléfono).
    const px = ((clientX - rect.left) / rect.width) * this.size;
    const py = ((clientY - rect.top) / rect.height) * this.size;
    return {
      x: (px - 4) / this.scale + (WORLD_CENTER_X - WORLD_RADIUS),
      y: (py - 4) / this.scale + (WORLD_CENTER_Y - WORLD_RADIUS),
    };
  }

  draw(
    frame: InterpolatedFrame,
    roster: Map<number, PlayerMeta>,
    localId: number,
    mates: ReadonlySet<number> = new Set(),
    marks: readonly Mark[] = [],
    wanted: { id: number; x: number; y: number } | null = null,
    golden: readonly { x: number; y: number }[] = [],
  ): void {
    const ctx = this.ctx;
    const cx = this.tx(WORLD_CENTER_X);
    const cy = this.ty(WORLD_CENTER_Y);
    const r = WORLD_RADIUS * this.scale;

    // Fondo opaco: si el lienzo queda transparente en las esquinas, el mundo se
    // ve a través del minimapa y parece un error de dibujo.
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = "#10141a";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = "#2f4a26";
    ctx.fillRect(0, 0, this.size, this.size);

    // Cada distrito con el color de su suelo, usando sus mismas manchas que el
    // mundo: así lo que ves en el minimapa coincide con lo que pisás.
    for (const d of this.arena.districts) {
      ctx.fillStyle = DISTRICT_COLORS[d.ground] ?? "#2a4520";
      for (const blob of d.blobs) {
        ctx.beginPath();
        ctx.ellipse(
          this.tx(blob.x),
          this.ty(blob.y),
          blob.rx * this.scale,
          blob.ry * this.scale,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    ctx.fillStyle = "#2f6f9e";
    for (const p of this.arena.ponds) {
      ctx.beginPath();
      ctx.ellipse(this.tx(p.x), this.ty(p.y), p.rx * this.scale, p.ry * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Caminos primero: son la referencia para orientarse de un vistazo.
    ctx.strokeStyle = "#8a7548";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of this.arena.paths) {
      ctx.lineWidth = Math.max(1.5, path.width * this.scale);
      ctx.beginPath();
      path.points.forEach((point, i) => {
        const x = this.tx(point.x);
        const y = this.ty(point.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Casas. Los árboles y las rocas NO se dibujan a propósito: a esta escala
    // serían setenta puntitos y taparían lo único que sirve para ubicarse.
    for (const b of this.arena.buildings) {
      ctx.fillStyle = "#5a5148";
      ctx.fillRect(this.tx(b.x), this.ty(b.y), b.w * this.scale, b.h * this.scale);
      ctx.strokeStyle = "#8d8375";
      ctx.lineWidth = 1;
      ctx.strokeRect(this.tx(b.x), this.ty(b.y), b.w * this.scale, b.h * this.scale);
    }

    ctx.fillStyle = "#1e2a19";
    for (const o of this.arena.obstacles) {
      if (o.kind !== "container" && o.kind !== "wall") continue;
      ctx.fillRect(
        this.tx(o.x),
        this.ty(o.y),
        Math.max(1, o.w * this.scale),
        Math.max(1, o.h * this.scale),
      );
    }
    // Los nombres van al final para que nada los tape. Son la mitad del valor
    // del minimapa: sin ellos no hay forma de decirle a alguien adónde vas.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#0b0e0a";
    for (const d of this.arena.districts) {
      // Los puntos menores van más chicos y apagados: con catorce nombres del
      // mismo tamaño el minimapa se vuelve ilegible.
      ctx.font = d.minor
        ? "600 7px ui-sans-serif, system-ui, sans-serif"
        : "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = d.minor ? "#aebac6" : "#e8eef5";
      const label = d.name.toUpperCase();
      ctx.strokeText(label, this.tx(d.x), this.ty(d.y));
      ctx.fillText(label, this.tx(d.x), this.ty(d.y));
    }

    ctx.restore();

    // Círculo objetivo de la próxima zona.
    const z = frame.zone;
    if (z.targetRadius < z.radius - 1) {
      ctx.strokeStyle = "#ffffff88";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(this.tx(z.targetX), this.ty(z.targetY), z.targetRadius * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Zona activa.
    ctx.strokeStyle = "#6fd3ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.tx(z.x), this.ty(z.y), Math.max(1, z.radius * this.scale), 0, Math.PI * 2);
    ctx.stroke();

    // Bombardeos: un círculo rojo, para saber de dónde salir sin mirar el mapa grande.
    for (const s of frame.strikes) {
      ctx.fillStyle = "rgba(255, 42, 26, 0.35)";
      ctx.strokeStyle = "#ff3b2a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.tx(s.x), this.ty(s.y), STRIKE_RADIUS * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Paquetes aéreos: un cuadrado dorado que late. Es lo primero que hay que
    // ver al abrir el minimapa, porque todos van a ir para ahí.
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 180);
    for (const drop of frame.airdrops) {
      ctx.fillStyle = `rgba(255, 201, 74, ${pulse.toFixed(2)})`;
      ctx.fillRect(this.tx(drop.x) - 4, this.ty(drop.y) - 4, 8, 8);
      ctx.strokeStyle = "#000000aa";
      ctx.lineWidth = 1;
      ctx.strokeRect(this.tx(drop.x) - 4.5, this.ty(drop.y) - 4.5, 9, 9);
    }

    for (const p of frame.players) {
      if (!p.alive) continue;
      const isLocal = p.id === localId;
      const meta = roster.get(p.id);
      ctx.fillStyle = isLocal
        ? "#ffffff"
        : `#${playerColor(meta?.colorIndex ?? 0).toString(16).padStart(6, "0")}`;
      ctx.beginPath();
      ctx.arc(this.tx(p.x), this.ty(p.y), isLocal ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (isLocal) {
        ctx.strokeStyle = "#000000aa";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // El compañero, con un anillo verde: es al que querés encontrar.
      if (mates.has(p.id)) {
        ctx.strokeStyle = "#7dff9a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.tx(p.x), this.ty(p.y), 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Cajas doradas sin abrir: un cuadradito de oro, como un paquete chiquito.
    for (const c of golden) {
      ctx.fillStyle = "#ffd34a";
      ctx.strokeStyle = "#000000aa";
      ctx.lineWidth = 1;
      ctx.fillRect(this.tx(c.x) - 2.5, this.ty(c.y) - 2.5, 5, 5);
      ctx.strokeRect(this.tx(c.x) - 3, this.ty(c.y) - 3, 6, 6);
    }

    // El más buscado: una estrella dorada donde se lo vio por última vez.
    if (wanted) {
      const x = this.tx(wanted.x);
      const y = this.ty(wanted.y);
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 160);
      ctx.fillStyle = `rgba(255, 201, 74, ${pulse.toFixed(2)})`;
      ctx.strokeStyle = "#000000aa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 7 : 3;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Marcas de la pareja: un anillo que se cierra sobre el lugar, del color
    // del que marcó.
    const now = performance.now();
    for (const m of marks) {
      const t = ((now - m.at) % 900) / 900;
      ctx.strokeStyle = `#${m.color.toString(16).padStart(6, "0")}`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.tx(m.x), this.ty(m.y), 10 - t * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(this.tx(m.x) - 1.5, this.ty(m.y) - 1.5, 3, 3);
    }
  }
}
