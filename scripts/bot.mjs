/**
 * Clientes headless para probar el servidor sin abrir el navegador.
 *
 *   node scripts/bot.mjs --bots 8 --seconds 40
 *
 * Los bots buscan al rival vivo más cercano y le disparan, así la prueba
 * ejercita el ciclo completo: lobby, countdown, combate, muertes, zona y
 * victoria. También mide el ritmo real del tick del servidor y cuánto pesa
 * un snapshot, que es lo que hay que saber antes de invitar gente.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const HOST = arg("url", "ws://127.0.0.1:8787");
// Código válido para el cliente: sin vocales ni 0/1, igual que los que genera
// el juego. Así se puede entrar con el navegador a la misma sala.
const ROOM = arg("room", "BTS234");
const BOTS = Number(arg("bots", 8));
const SECONDS = Number(arg("seconds", 40));
/**
 * Segundos que los bots aguantan en el lobby antes de marcar "listo". Sirve para
 * que un navegador llegue a entrar a la misma sala: sin esto la partida arranca
 * antes de que Chromium termine de cargar.
 */
const WAIT = Number(arg("wait", 0));
const startAt = Date.now() + WAIT * 1000;
const TICK_MS = 50;

// Índices dentro de la tupla SnapPlayer del protocolo.
const P_ID = 0;
const P_X = 1;
const P_Y = 2;
const P_HP = 4;
const P_FLAGS = 5;
const FLAG_ALIVE = 1;

const stats = {
  snapshots: 0,
  bytes: 0,
  maxBytes: 0,
  phases: [],
  kills: 0,
  errors: [],
  /**
   * Ticks acumulados sumando avances, no `último - primero`: cuando la partida
   * termina y la sala vuelve al lobby, el contador del servidor arranca de cero
   * otra vez. Restando las puntas, una corrida que alcanza a jugar dos partidas
   * reporta un ritmo absurdo y hace fallar la prueba sin que pase nada malo.
   */
  ticks: 0,
  playMs: 0,
  prevTick: null,
  prevTickAt: 0,
  serverMs: 0,
  prevServerNow: 0,
};

let winner = null;
let lastAlive = 0;

function makeBot(index) {
  const name = `Bot${index + 1}`;
  const url = `${HOST}/parties/game-room/${ROOM}?name=${encodeURIComponent(name)}`;
  const ws = new WebSocket(url);

  let id = -1;
  let seq = 1;
  let phase = "";
  let readySent = false;
  let timer = null;
  let me = null;
  let target = null;
  let zone = null;

  ws.on("open", () => {
    timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN || phase !== "playing" || !me) return;

      // Ir hacia el centro de la zona si estamos afuera; si no, hacia el rival.
      let goalX = zone ? zone.x : me.x;
      let goalY = zone ? zone.y : me.y;
      const outside =
        zone && Math.hypot(me.x - zone.x, me.y - zone.y) > zone.radius * 0.75;
      if (!outside && target) {
        goalX = target.x;
        goalY = target.y;
      }

      const dx = goalX - me.x;
      const dy = goalY - me.y;
      const aim = target ? Math.atan2(target.y - me.y, target.x - me.x) : 0;

      ws.send(
        JSON.stringify({
          t: "in",
          seq: seq++,
          mx: Math.abs(dx) < 12 ? 0 : Math.sign(dx),
          my: Math.abs(dy) < 12 ? 0 : Math.sign(dy),
          aim: Math.round(aim * 1000),
          btn: target ? 1 : 0,
        }),
      );
    }, TICK_MS);
  });

  ws.on("message", (raw) => {
    const text = raw.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.t === "welcome") {
      id = msg.you;
      return;
    }

    if (msg.t === "err") {
      stats.errors.push(`${name}: ${msg.message}`);
      return;
    }

    if (msg.t !== "s") return;

    if (phase !== msg.phase) {
      phase = msg.phase;
      if (index === 0) stats.phases.push(msg.phase);
      // Al volver al lobby el servidor borra los "listo" de todos, así que hay
      // que reafirmarlo o la sala se queda esperando para siempre.
      if (msg.phase === "lobby") readySent = false;
    }

    if (phase === "lobby" && !readySent && Date.now() >= startAt) {
      readySent = true;
      ws.send(JSON.stringify({ t: "ready", ready: true }));
    }

    zone = { x: msg.zone[0], y: msg.zone[1], radius: msg.zone[2] };
    me = null;
    target = null;
    let best = Infinity;

    for (const p of msg.players) {
      const alive = (p[P_FLAGS] & FLAG_ALIVE) !== 0;
      if (p[P_ID] === id) {
        me = alive ? { x: p[P_X], y: p[P_Y], hp: p[P_HP] } : null;
        continue;
      }
      if (!alive) continue;
      const d = Math.hypot(p[P_X] - (me?.x ?? 0), p[P_Y] - (me?.y ?? 0));
      if (d < best) {
        best = d;
        target = { x: p[P_X], y: p[P_Y] };
      }
    }
    // El blanco sólo vale si está a tiro; disparar al vacío no prueba nada.
    if (best > 700) target = null;

    if (index !== 0) return;

    // Sólo el primer bot mide, para no contar el mismo snapshot N veces.
    const now = Date.now();
    stats.snapshots++;
    stats.bytes += text.length;
    stats.maxBytes = Math.max(stats.maxBytes, text.length);
    lastAlive = msg.alive;
    if (msg.winner >= 0) winner = msg.winner;
    for (const ev of msg.ev ?? []) if (ev.t === "kill") stats.kills++;

    if (msg.phase === "playing") {
      // Un tick menor que el anterior es una partida nueva: no se cuenta el
      // salto hacia atrás ni el rato que la sala pasó fuera de "playing".
      if (stats.prevTick !== null && msg.tick > stats.prevTick) {
        stats.ticks += msg.tick - stats.prevTick;
        stats.playMs += now - stats.prevTickAt;
        stats.serverMs += msg.now - stats.prevServerNow;
      }
      stats.prevTick = msg.tick;
      stats.prevTickAt = now;
      stats.prevServerNow = msg.now;
    }
  });

  ws.on("error", (err) => stats.errors.push(`${name}: ${err.message}`));
  ws.on("close", () => timer && clearInterval(timer));

  return ws;
}

console.log(`Conectando ${BOTS} bots a ${HOST} sala ${ROOM} por ${SECONDS}s...`);
const sockets = Array.from({ length: BOTS }, (_, i) => makeBot(i));

setTimeout(() => {
  for (const ws of sockets) ws.close();

  const elapsed = stats.playMs / 1000;
  const tickRate = elapsed > 0 ? stats.ticks / elapsed : 0;

  console.log("\n--- resultados ---");
  console.log(`fases:                 ${stats.phases.join(" -> ") || "(ninguna)"}`);
  console.log(`tick del servidor:     ${tickRate.toFixed(2)}/s (objetivo 20)`);
  const serverElapsed = stats.serverMs / 1000;
  console.log(`reloj del servidor:    avanzó ${serverElapsed.toFixed(2)}s en ${elapsed.toFixed(2)}s de juego reales`);
  console.log(`snapshots recibidos:   ${stats.snapshots}`);
  console.log(`snapshot promedio:     ${Math.round(stats.bytes / Math.max(stats.snapshots, 1))} bytes`);
  console.log(`snapshot más grande:   ${stats.maxBytes} bytes`);
  console.log(`kills:                 ${stats.kills}`);
  console.log(`vivos al final:        ${lastAlive}`);
  console.log(`ganador:               ${winner ?? "(sin definir)"}`);
  if (stats.errors.length) console.log(`errores:\n  ${stats.errors.join("\n  ")}`);

  const ok =
    tickRate > 18 &&
    tickRate < 22 &&
    stats.phases.includes("playing") &&
    stats.kills > 0 &&
    stats.errors.length === 0;
  console.log(
    ok
      ? "\nOK: el servidor corrió la partida al ritmo esperado y hubo combate."
      : "\nFALLA: revisar arriba.",
  );
  process.exit(ok ? 0 : 1);
}, SECONDS * 1000);
