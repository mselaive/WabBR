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

const estado = { id: -1, roster: [], phase: "", kills: 0, res: null, alive: 0, vio: new Set(), winner: -1, campeon: null };
const ws = new WebSocket(`${WS}/parties/game-room/${ROOM}?name=Host&v=3`);
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
    if (m.phase === "ended") estado.winner = m.winner;
    if (m.phase === "playing" && m.ch) estado.campeon = m.ch[0];
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

// El marcador de la sala: una partida jugada para cada uno, una ganada para el
// que ganó, y las kills de todos sumadas igual que las del kill feed.
await hasta(() => estado.roster.every((p) => p.played === 1), 3000);
check(estado.roster.every((p) => p.played === 1), "el marcador de la sala cuenta la partida para todos");
const ganadas = estado.roster.reduce((n, p) => n + (p.wins ?? 0), 0);
check(
  estado.winner >= 0 ? ganadas === 1 && estado.roster.find((p) => p.id === estado.winner)?.wins === 1 : ganadas === 0,
  "y la victoria se la anota el que ganó",
);
const killsSala = estado.roster.reduce((n, p) => n + (p.totalKills ?? 0), 0);
check(killsSala === estado.kills, `y suma las kills (${killsSala} de ${estado.kills})`);

// La partida siguiente: con una sola ganada nadie domina la sala todavía, así
// que no hay campeón a la vista (hacen falta 3 y 2 de ventaja).
if (estado.winner >= 0) {
  await hasta(() => estado.phase === "lobby", 20000);
  estado.campeon = null;
  enviar({ t: "start" });
  await hasta(() => estado.phase === "playing", 20000);
  await esperar(1500);
  check(estado.campeon === null, "con una sola ganada no hay campeón de la sala");
}

ws.close();
if (fallos.length) {
  console.log(`\nFALLA: ${fallos.length} comprobaciones.`);
  process.exit(1);
}
console.log("\nOK: los bots del servidor juegan una partida entera.");
process.exit(0);
