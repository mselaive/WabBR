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

// Parejas elegidas: si los dos se eligen, juegan juntos siempre; un bot acepta solo.
{
  const room = `P${Math.random().toString(36).slice(2, 7).toUpperCase()}`.replace(/[AEIOU01]/g, "Z");
  const host = cliente(room, "Host");
  await hasta(() => host.id > 0, 5000);
  const guest = cliente(room, "Guest");
  await hasta(() => guest.id > 0, 5000);
  let roster = [];
  guest.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "roster") roster = m.roster;
  });
  host.send({ t: "mode", teamSize: 2 });
  host.send({ t: "bot" });
  host.send({ t: "bot" });
  await hasta(() => roster.length === 4, 5000);
  const [bot1] = roster.filter((p) => p.bot);
  guest.send({ t: "partner", id: bot1.id });
  await hasta(() => roster.find((p) => p.id === bot1.id)?.partner === guest.id, 3000);
  check(roster.find((p) => p.id === bot1.id)?.partner === guest.id, "el bot acepta al que lo elige");
  host.send({ t: "partner", id: guest.id });
  guest.send({ t: "partner", id: host.id });
  await hasta(() => roster.find((p) => p.id === guest.id)?.partner === host.id, 3000);
  host.send({ t: "ready", ready: true });
  guest.send({ t: "ready", ready: true });
  await hasta(() => host.phase === "playing" && host.teams.size === 4, 15000);
  check(host.teams.get(host.id) === host.teams.get(guest.id), "los que se eligieron juegan juntos");
  host.ws.close();
  guest.ws.close();
}

if (fallos.length) {
  console.log(`\nFALLA: ${fallos.length} comprobaciones.`);
  process.exit(1);
}
console.log("\nOK: las marcas le llegan sólo a la pareja.");
process.exit(0);
