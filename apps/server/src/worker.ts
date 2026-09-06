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
      // CORS abierto: el cliente lo consulta desde su propio dominio cuando la
      // conexión falla, para distinguir "el servidor no está" de "el servidor
      // rechazó tu origen". Sin la cabecera, el navegador le tapa la respuesta
      // y las dos situaciones se ven iguales.
      return Response.json(
        { ok: true, service: "wabbr-server" },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    if (!originAllowed(request, env)) {
      // Con CORS abierto a propósito: el navegador no deja leer el estado de un
      // upgrade de WebSocket fallido, así que el cliente vuelve a preguntar por
      // HTTP para poder decir "rechacé tu dominio" en vez de "no hay servidor".
      // No filtra nada: el cuerpo es un cartel y el acceso ya está denegado.
      return new Response("Forbidden origin", {
        status: 403,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
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
