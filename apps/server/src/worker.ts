import { routePartykitRequest } from "partyserver";
import { GameRoom, type Env } from "./GameRoom.js";

export { GameRoom };

/**
 * El Worker solo enruta: `/parties/game-room/<CODIGO>` cae en el Durable Object
 * de esa sala. Toda la lógica de juego vive en GameRoom.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({ ok: true, service: "wabbr-server" });
    }

    if (!originAllowed(request, env)) {
      return new Response("Forbidden origin", { status: 403 });
    }

    const locationHint = env.DO_LOCATION_HINT?.trim();

    const response = await routePartykitRequest(request, env, {
      cors: true,
      ...(locationHint ? { locationHint: locationHint as DurableObjectLocationHint } : {}),
    });

    return response ?? new Response("Not found", { status: 404 });
  },
};

/**
 * Sin esto cualquier página podría abrir conexiones contra tus salas.
 * ALLOWED_ORIGINS vacío deja pasar todo, que es lo que querés en desarrollo.
 */
function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;

  const origin = request.headers.get("Origin");
  if (!origin) return true; // curl, health checks, previews sin origen

  if (allowed.includes(origin)) return true;

  // Soporte de comodín para los deploys de preview de Vercel: "https://*.vercel.app"
  return allowed.some((pattern) => {
    if (!pattern.includes("*")) return false;
    const rx = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`);
    return rx.test(origin);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
