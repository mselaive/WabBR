/**
 * Prueba que las marcas del mapa le lleguen sólo a la pareja.
 *
 *   npm run dev
 *   node scripts/marks.mjs
 *
 * Dos clientes con socket pelado y dos bots en dúos. Las parejas se sortean,
 * así que se repite hasta ver los dos casos: el otro es compañero (le llega)
 * y el otro es rival (no le llega). En los dos, al que marca le vuelve la suya.
 */
import WebSocket from "ws";

const WS = process.env.WABBR_WS ?? "ws://127.0.0.1:8787";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond, ms) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await esperar(100);
  }
  return false;
};

const fallos = [];
const check = (ok, que) => {
  console.log(`  ${ok ? "ok  " : "FALLA"} ${que}`);
  if (!ok) fallos.push(que);
};

function cliente(room, name) {
  const c = { id: -1, phase: "", teams: new Map(), marks: [] };
  c.ws = new WebSocket(`${WS}/parties/game-room/${room}?name=${name}&v=2`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "welcome") c.id = m.you;
    if (m.t === "s") {
      c.phase = m.phase;
      for (const s of m.st) c.teams.set(s[0], s[4]);
    }
    if (m.t === "mark") c.marks.push(m);
  });
  c.send = (msg) => c.ws.send(JSON.stringify(msg));
  return c;
}

async function ronda() {
  const room = `M${Math.random().toString(36).slice(2, 7).toUpperCase()}`.replace(/[AEIOU01]/g, "Z");
  const host = cliente(room, "Host");
  await hasta(() => host.id > 0, 5000);
  const guest = cliente(room, "Guest");
  await hasta(() => guest.id > 0, 5000);
  host.send({ t: "mode", teamSize: 2 });
  host.send({ t: "bot" });
  host.send({ t: "bot" });
  await esperar(300);
  host.send({ t: "ready", ready: true });
  guest.send({ t: "ready", ready: true });
  await hasta(() => host.phase === "playing" && guest.teams.size === 4, 15000);

  const mates = host.teams.get(host.id) === host.teams.get(guest.id);
  host.send({ t: "mark", x: 1500, y: 1400 });
  await esperar(500);
  check(host.marks.length === 1 && host.marks[0].by === host.id, "al que marca le vuelve su marca");
  check(guest.marks.length === (mates ? 1 : 0), mates ? "al compañero le llega" : "al rival no le llega");

  // Dos seguidas: la segunda se descarta (a lo sumo dos por segundo).
  host.send({ t: "mark", x: 1600, y: 1400 });
  host.send({ t: "mark", x: 1700, y: 1400 });
  await esperar(400);
  check(host.marks.length === 2, "marcar de a ráfagas no inunda");
  host.ws.close();
  guest.ws.close();
  return mates;
}

const vistos = new Set();
for (let i = 0; i < 8 && vistos.size < 2; i++) vistos.add(await ronda());
check(vistos.size === 2, "se vieron los dos casos (compañero y rival)");

if (fallos.length) {
  console.log(`\nFALLA: ${fallos.length} comprobaciones.`);
  process.exit(1);
}
console.log("\nOK: las marcas le llegan sólo a la pareja.");
process.exit(0);
