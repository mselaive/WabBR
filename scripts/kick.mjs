/**
 * Prueba que el host pueda echar gente del lobby, y que nadie más pueda.
 *
 *   npm run dev
 *   node scripts/kick.mjs
 *
 * Mezcla navegador y sockets pelados a propósito. El navegador comprueba lo que
 * ve el jugador —el botón, el cartel, la vuelta al menú—; los sockets pelados
 * comprueban lo que de verdad importa, que es el servidor: esconder un botón no
 * es un control de acceso, y un cliente modificado manda lo que quiera.
 */
import { chromium } from "playwright";
import WebSocket from "ws";

const BASE = process.env.WABBR_URL ?? "http://localhost:5173";
const WS = process.env.WABBR_WS ?? "ws://127.0.0.1:8787";

const fallos = [];
const check = (ok, que) => {
  console.log(`  ${ok ? "ok  " : "FALLA"} ${que}`);
  if (!ok) fallos.push(que);
};

/** Cliente crudo: entra a la sala y deja ver los mensajes que llegan. */
function crudo(room, name) {
  const ws = new WebSocket(`${WS}/parties/game-room/${room}?name=${encodeURIComponent(name)}`);
  const estado = { id: -1, hostId: -1, roster: [], error: null, cerrado: false };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "welcome") {
      estado.id = m.you;
      estado.hostId = m.hostId;
      estado.roster = m.roster;
    } else if (m.t === "roster") {
      estado.hostId = m.hostId;
      estado.roster = m.roster;
    } else if (m.t === "err") {
      estado.error = m;
    }
  });
  ws.on("close", () => (estado.cerrado = true));
  return { ws, estado };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond, ms = 5000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await esperar(100);
  }
  return false;
};

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });

  // ---------------------------------------------------------------- navegador
  console.log("Navegador: el host echa a alguien");

  const anfitrion = await ctx.newPage();
  await anfitrion.goto(BASE, { waitUntil: "domcontentloaded" });
  await anfitrion.fill("#nameInput", "Mati");
  await anfitrion.click("#btnCreate");
  await anfitrion.waitForSelector("#screenLobby:not([hidden])", { timeout: 20000 });
  const room = (await anfitrion.textContent("#roomCode")).trim();

  const invitado = await ctx.newPage();
  await invitado.goto(`${BASE}/?room=${room}`, { waitUntil: "domcontentloaded" });
  await invitado.fill("#nameInput", "Colado");
  await invitado.click("#btnJoin");
  await invitado.waitForSelector("#screenLobby:not([hidden])", { timeout: 20000 });

  await anfitrion.waitForFunction(
    () => document.querySelectorAll("#playerList .player-row").length === 2,
    { timeout: 10000 },
  );

  const botonesHost = await anfitrion.locator("#playerList .kick").count();
  const botonesInvitado = await invitado.locator("#playerList .kick").count();
  check(botonesHost === 1, `el host ve 1 botón de echar (vio ${botonesHost})`);
  check(botonesInvitado === 0, `el invitado no ve ninguno (vio ${botonesInvitado})`);

  await anfitrion.locator("#playerList .kick").first().hover();
  await anfitrion.screenshot({ path: ".showcase/18-lobby-echar.png" });

  await anfitrion.locator("#playerList .kick").first().click();

  const volvio = await invitado
    .waitForSelector("#screenMenu:not([hidden])", { timeout: 10000 })
    .then(() => true, () => false);
  check(volvio, "al echado lo devuelve al menú");

  const aviso = await invitado.evaluate(() => {
    const n = document.getElementById("menuError");
    return n && !n.hidden ? n.textContent : null;
  });
  check(!!aviso && /sac/i.test(aviso), `le explica por qué: "${aviso ?? "(nada)"}"`);

  const quedan = await anfitrion.locator("#playerList .player-row").count();
  check(quedan === 1, `el host queda solo en la lista (hay ${quedan})`);

  // ------------------------------------------------------------- reentrada
  console.log("\nEl echado intenta volver");

  const mismo = crudo(room, "Colado");
  await hasta(() => mismo.estado.error || mismo.estado.id >= 0, 5000);
  check(mismo.estado.error?.code === "kicked", "con el mismo nombre, rechazado");
  mismo.ws.close();

  // Bloqueo blando y documentado: sin cuentas no hay identidad estable.
  const otro = crudo(room, "Colado2");
  await hasta(() => otro.estado.id >= 0 || otro.estado.error, 5000);
  check(otro.estado.id >= 0, "cambiando el nombre entra igual (bloqueo blando)");

  // ------------------------------------------------------ intento de abuso
  console.log("\nUn cliente modificado intenta echar sin ser host");

  await hasta(() => otro.estado.hostId >= 0, 5000);
  const idHost = otro.estado.hostId;
  otro.ws.send(JSON.stringify({ t: "kick", id: idHost }));
  await esperar(1200);

  check(!otro.estado.cerrado, "el que lo intentó sigue conectado (se ignora, no se castiga)");
  const hostSigue = otro.estado.roster.some((p) => p.id === idHost);
  check(hostSigue, "el host sigue en la sala");

  // Y el host tampoco puede echarse a sí mismo.
  const seguiaSolo = await anfitrion.locator("#playerList .player-row").count();
  otro.ws.close();
  check(seguiaSolo >= 1, "la sala no quedó vacía");
} finally {
  await browser.close();
}

console.log("");
if (fallos.length) {
  console.log(`${fallos.length} fallas:`);
  for (const f of fallos) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("OK: echar del lobby anda y sólo lo puede hacer el host.");
