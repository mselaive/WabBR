/**
 * Prueba que los bots del servidor jueguen una partida entera.
 *
 *   npm run dev
 *   node scripts/server-bots.mjs
 *
 * Un host con socket pelado entra, agrega bots, marca listo y se queda quieto.
 * Los bots tienen que pelear entre ellos (y con él) hasta que quede uno.
 */
import WebSocket from "ws";

const WS = process.env.WABBR_WS ?? "ws://127.0.0.1:8787";
const ROOM = `B${Math.random().toString(36).slice(2, 7).toUpperCase()}`.replace(/[AEIOU01]/g, "Z");
const BOTS = 4;

const fallos = [];
const check = (ok, que) => {
  console.log(`  ${ok ? "ok  " : "FALLA"} ${que}`);
  if (!ok) fallos.push(que);
};

const estado = { id: -1, roster: [], phase: "", kills: 0, res: null, alive: 0, vio: new Set() };
const ws = new WebSocket(`${WS}/parties/game-room/${ROOM}?name=Host&v=1`);
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "welcome") estado.id = m.you;
  if (m.t === "welcome" || m.t === "roster") estado.roster = m.roster;
  if (m.t === "s") {
    estado.phase = m.phase;
    estado.alive = m.alive;
    for (const p of m.players) if (p[0] !== estado.id) estado.vio.add(p[0]);
    for (const ev of m.ev ?? []) if (ev.t === "kill" && ev.byId >= 0) estado.kills++;
    if (m.res) estado.res = m.res;
  }
});
const enviar = (msg) => ws.send(JSON.stringify(msg));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond, ms) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await esperar(200);
  }
  return false;
};

console.log(`Sala ${ROOM} en ${WS}`);
await hasta(() => estado.id > 0, 5000);
for (let i = 0; i < BOTS; i++) enviar({ t: "bot" });
await hasta(() => estado.roster.length === BOTS + 1, 5000);
check(estado.roster.filter((p) => p.bot).length === BOTS, `el host agregó ${BOTS} bots`);
check(estado.roster.filter((p) => p.bot).every((p) => p.ready), "los bots ya están listos");

enviar({ t: "ready", ready: true });
check(await hasta(() => estado.phase === "playing", 15000), "arranca la partida");

console.log("  (jugando: los bots tienen que encontrarse y pelear...)");
check(await hasta(() => estado.phase === "ended", 6 * 60 * 1000), "la partida termina");
check(estado.kills > 0, `hubo combate (${estado.kills} kills)`);
check(estado.res?.length === BOTS + 1, "y el resultado trae a todos");

ws.close();
if (fallos.length) {
  console.log(`\nFALLA: ${fallos.length} comprobaciones.`);
  process.exit(1);
}
console.log("\nOK: los bots del servidor juegan una partida entera.");
process.exit(0);
