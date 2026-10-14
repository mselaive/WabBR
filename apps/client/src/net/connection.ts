import PartySocket from "partysocket";
import {
  PROTOCOL_VERSION,
  decodeServer,
  encodeClient,
  type ClientMsg,
  type ServerMsg,
} from "@wabbr/shared";

export interface NetOptions {
  room: string;
  name: string;
  /** El gorro elegido (ver achievements.ts). */
  hat: number;
  /** El color que eligió la última vez (índice en la paleta), o null. */
  color: number | null;
  onMessage: (msg: ServerMsg) => void;
  onOpen?: () => void;
  /** `code` es el del cierre: 4001 = otra pestaña se quedó con el asiento. */
  onClose?: (code: number) => void;
  onError?: (err: unknown) => void;
}

/**
 * Con qué vuelve esta pestaña a su asiento si se le corta la conexión. Vive en
 * sessionStorage: sobrevive a recargar la página pero es de esta pestaña sola,
 * así que otra pestaña con la misma sala entra como otro jugador.
 */
function reconnectToken(room: string): string {
  const key = `wabbr:token:${room}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Sin almacenamiento (modo privado estricto): se pierde sólo la reconexión.
    return crypto.randomUUID();
  }
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
 * Base HTTP del servidor, con la misma regla de protocolo que usa PartySocket:
 * `http` sólo para localhost y red local, `https` para todo lo demás.
 */
function serverBase(): string {
  const host = serverHost().replace(/^(https?|wss?):\/\//, "");
  const local =
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.");
  return `${local ? "http" : "https"}://${host}`;
}

/**
 * Por qué falló la conexión, preguntando por HTTP.
 *
 * Hace falta porque el navegador no deja leer el código de estado de un upgrade
 * de WebSocket fallido: si el servidor rechaza tu origen con un 403, desde JS se
 * ve igual que si el servidor no existiera. Decir "¿el servidor está andando?"
 * cuando está perfecto manda a buscar el problema al lugar equivocado.
 */
export async function diagnoseConnection(room: string): Promise<string> {
  const base = serverBase();

  try {
    const salud = await fetch(`${base}/health`, { cache: "no-store" });
    if (!salud.ok) return "El servidor respondió mal. Probá de nuevo en un rato.";
  } catch {
    return "No se pudo conectar. ¿El servidor está andando?";
  }

  // El servidor está vivo, así que el problema es de esta conexión concreta.
  try {
    const r = await fetch(`${base}/parties/game-room/${encodeURIComponent(room)}`, {
      cache: "no-store",
    });
    if (r.status === 403) {
      return `El servidor está andando pero no acepta conexiones desde ${location.origin}. Hay que agregar ese dominio a ALLOWED_ORIGINS.`;
    }
  } catch {
    // Que falle por CORS también apunta al chequeo de origen.
    return `El servidor está andando pero rechazó este dominio (${location.origin}).`;
  }

  return "El servidor está andando pero no se pudo entrar a la sala. Probá de nuevo.";
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
      // El mismo token en cada reintento: PartySocket reusa la query al reconectar.
      query: {
        name: opts.name,
        hat: String(opts.hat),
        ...(opts.color !== null ? { color: String(opts.color) } : {}),
        token: reconnectToken(opts.room),
        v: String(PROTOCOL_VERSION),
      },
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

    this.socket.addEventListener("close", (e: CloseEvent) => opts.onClose?.(e.code));
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

  /** Sólo para probar: corta la conexión como si se cayera el WiFi y deja que vuelva sola. */
  simulateDrop(): void {
    this.socket.reconnect();
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
