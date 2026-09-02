import PartySocket from "partysocket";
import { decodeServer, encodeClient, type ClientMsg, type ServerMsg } from "@wabbr/shared";

export interface NetOptions {
  room: string;
  name: string;
  onMessage: (msg: ServerMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}

/** `?lag=200` simula 200 ms de ida y vuelta sin salir de tu máquina. */
function lagFromUrl(): number {
  const raw = new URLSearchParams(location.search).get("lag");
  const v = raw ? Number(raw) : 0;
  return Number.isFinite(v) && v > 0 ? Math.min(v, 2000) : 0;
}

function serverHost(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured && configured.trim()) return configured.trim();
  // En dev, wrangler escucha acá.
  return `${location.hostname}:8787`;
}

/**
 * Conexión con la sala. Encapsula PartySocket, mide el ping y —en desarrollo—
 * puede inyectar latencia artificial para probar la predicción sin desplegar.
 */
export class Net {
  private socket: PartySocket;
  private readonly lag = lagFromUrl();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /** RTT suavizado en ms. */
  rtt = 0;
  /** Offset estimado entre el reloj del servidor y el local. */
  clockOffset = 0;

  constructor(private readonly opts: NetOptions) {
    this.socket = new PartySocket({
      host: serverHost(),
      party: "game-room",
      room: opts.room,
      query: { name: opts.name },
    });

    this.socket.addEventListener("open", () => {
      this.startPing();
      opts.onOpen?.();
    });

    this.socket.addEventListener("message", (event: MessageEvent) => {
      const deliver = () => {
        if (this.closed) return;
        const msg = decodeServer(String(event.data));
        if (!msg) return;
        if (msg.t === "pong") {
          this.onPong(msg.c, msg.s);
          return;
        }
        opts.onMessage(msg);
      };
      if (this.lag > 0) setTimeout(deliver, this.lag / 2);
      else deliver();
    });

    this.socket.addEventListener("close", () => opts.onClose?.());
    this.socket.addEventListener("error", (e) => opts.onError?.(e));
  }

  get simulatedLagMs(): number {
    return this.lag;
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    const raw = encodeClient(msg);
    const push = () => {
      if (this.closed) return;
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send(raw);
    };
    if (this.lag > 0) setTimeout(push, this.lag / 2);
    else push();
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket.close();
  }

  private startPing(): void {
    if (this.pingTimer) return;
    const ping = () => this.send({ t: "ping", c: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 1000);
  }

  private onPong(clientSent: number, serverNow: number): void {
    const rtt = Date.now() - clientSent;
    // Media móvil: el ping salta mucho de una muestra a otra.
    this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    const offset = serverNow + rtt / 2 - Date.now();
    this.clockOffset = this.clockOffset === 0 ? offset : this.clockOffset * 0.9 + offset * 0.1;
  }
}
