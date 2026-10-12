/**
 * Prueba que un corte de conexión en plena partida no te saque del juego.
 *
 *   npm run dev
 *   node scripts/reconnect.mjs
 *
 * Sockets pelados contra el servidor local, porque lo que importa es lo que
 * decide el servidor: si vuelve el mismo jugador, con el mismo muñeco vivo.
 */
import WebSocket from "ws";

const WS = process.env.WABBR_WS ?? "ws://127.0.0.1:8787";
const sala = () => `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`.replace(/[AEIOU01]/g, "Z");
const ROOM = sala();

const fallos = [];
const check = (ok, que) => {
  console.log(`  ${ok ? "ok  " : "FALLA"} ${que}`);
  if (!ok) fallos.push(que);
};

/** Cliente crudo: entra a la sala, guarda lo último que vio y deja mandar cosas. */
function crudo(name, token, room = ROOM) {
  const query = `name=${encodeURIComponent(name)}${token ? `&token=${token}` : ""}`;
  const ws = new WebSocket(`${WS}/parties/game-room/${room}?${query}`);
  const estado = { id: -1, phase: "", yo: null, cerrado: false, codigoCierre: 0, roster: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "welcome") {
      estado.id = m.you;
      estado.roster = m.roster;
    } else if (m.t === "roster") {
      estado.roster = m.roster;
    } else if (m.t === "s") {
      estado.phase = m.phase;
      const p = m.players.find((x) => x[0] === estado.id);
      // [id, x, y, aim, hp, flags, ...]: el bit 1 de flags es "vivo".
      if (p) estado.yo = { x: p[1], y: p[2], vivo: (p[5] & 1) === 1 };
    }
  });
  ws.on("close", (code) => {
    estado.cerrado = true;
    estado.codigoCierre = code;
  });
  const enviar = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  return { ws, estado, enviar };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond, ms = 8000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await esperar(100);
  }
  return false;
};

console.log(`Sala ${ROOM} en ${WS}`);

const TOKEN_A = "prueba-reconexion-aaaa";
const a = crudo("Ana", TOKEN_A);
const b = crudo("Beto", "prueba-reconexion-bbbb");
await hasta(() => a.estado.id > 0 && b.estado.id > 0);
const idA = a.estado.id;

a.enviar({ t: "ready", ready: true });
b.enviar({ t: "ready", ready: true });
check(await hasta(() => a.estado.phase === "playing", 15000), "arranca la partida");
await hasta(() => a.estado.yo !== null);
// Juega un rato antes del corte, como en una partida de verdad: así el
// servidor tiene inputs numerados (hasta el 30) de esta conexión.
for (let seq = 1; seq <= 30; seq++) {
  a.enviar({ t: "in", seq, mx: 0, my: 0, aim: 0, btn: 0, act: 0 });
  await esperar(50);
}
await esperar(300);
const antes = a.estado.yo;

// Se corta: el socket se cierra sin despedirse, como cuando se cae el WiFi.
a.ws.terminate();
await esperar(1500);
check(
  b.estado.roster.find((p) => p.id === idA)?.away === true,
  "los demás ven que se le cortó la conexión, pero sigue en la sala",
);

// Vuelve con el mismo token.
const a2 = crudo("Ana", TOKEN_A);
await hasta(() => a2.estado.id > 0 && a2.estado.yo !== null);
check(a2.estado.id === idA, `vuelve el mismo jugador (id ${a2.estado.id}, antes ${idA})`);
check(a2.estado.yo?.vivo === true, "su muñeco sigue vivo");
check(
  a2.estado.yo && Math.hypot(a2.estado.yo.x - antes.x, a2.estado.yo.y - antes.y) < 5,
  "y donde lo había dejado",
);
check(b.estado.roster.find((p) => p.id === idA)?.away !== true, "deja de figurar como desconectado");

// Otra conexión con el mismo token se queda con el asiento y cierra la vieja.
const a3 = crudo("Ana", TOKEN_A);
await hasta(() => a3.estado.id > 0);
check(a3.estado.id === idA, "abrir el mismo token de nuevo recupera el mismo asiento");
check(await hasta(() => a2.estado.cerrado), "y la conexión vieja se cierra");

check(a2.estado.codigoCierre === 4001, "con el código que le dice al cliente que no reintente");

// Recargar la página: vuelve con el token, pero numera los inputs desde 1.
// Antes el servidor los rechazaba por viejos y el muñeco quedaba congelado.
const xAntes = a3.estado.yo?.x ?? 0;
for (let seq = 1; seq <= 20; seq++) {
  a3.enviar({ t: "in", seq, mx: xAntes < 1500 ? 1 : -1, my: 0, aim: 0, btn: 0, act: 0 });
  await esperar(50);
}
await esperar(400);
check(Math.abs((a3.estado.yo?.x ?? 0) - xAntes) > 40, "después de recargar, el muñeco se mueve");

// Sin token es otra persona.
const c = crudo("Carla");
await hasta(() => c.estado.id > 0);
check(c.estado.id !== idA, "sin el token se entra como otro jugador");

for (const s of [a3, b, c]) s.ws.close();
await esperar(300);

// Con --largo: el que no vuelve a tiempo queda afuera, como antes. Tarda lo
// que dura la gracia (15 s), por eso no corre siempre.
if (process.argv.includes("--largo")) {
  // Otra sala, con una partida propia entre dos.
  const ROOM2 = sala();
  const d = crudo("Dani", "prueba-reconexion-dddd", ROOM2);
  const e = crudo("Eli", "prueba-reconexion-eeee", ROOM2);
  await hasta(() => d.estado.id > 0 && e.estado.id > 0);
  d.enviar({ t: "ready", ready: true });
  e.enviar({ t: "ready", ready: true });
  await hasta(() => d.estado.phase === "playing", 20000);
  const idD = d.estado.id;
  d.ws.terminate();
  console.log("  (esperando que se venza el plazo...)");
  await esperar(17000);
  check(!e.estado.roster.some((p) => p.id === idD), "pasado el plazo se lo da por ido");
  const tarde = crudo("Dani", "prueba-reconexion-dddd", ROOM2);
  await hasta(() => tarde.estado.id > 0);
  check(tarde.estado.id !== idD, "y si vuelve después entra como otro jugador");
  for (const s of [e, tarde]) s.ws.close();
  await esperar(300);
}

if (fallos.length) {
  console.log(`\nFALLA: ${fallos.length} comprobaciones.`);
  process.exit(1);
}
console.log("\nOK: un corte en partida no saca a nadie del juego.");
process.exit(0);
