/**
 * Abre dos jugadores reales en Chromium, juega una partida y saca capturas.
 *
 *   npm run dev            # en otra terminal (cliente :5173 + servidor :8787)
 *   node scripts/shot.mjs
 *
 * Además de las capturas reporta todo lo que la página escriba en la consola o
 * tire como excepción: en un juego de canvas, un error de render no se ve como
 * un error, se ve como una pantalla vacía.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../.shots");
const BASE = process.env.WABBR_URL ?? "http://127.0.0.1:5173";
const VIEWPORT = { width: 1280, height: 800 };

const problems = [];

function watch(page, label) {
  // Se imprime al momento además de acumularse: si el arnés muere a mitad de
  // camino, el informe final no llega nunca y el error se pierde.
  const note = (line) => {
    problems.push(line);
    console.error(`  ! ${line}`);
  };
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      note(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => note(`[${label}] excepción: ${err.message}`));
  page.on("requestfailed", (req) => {
    // Las fuentes de Google pueden fallar sin conexión; no es un bug del juego.
    if (req.url().includes("fonts.g")) return;
    note(`[${label}] pedido fallido: ${req.url()}`);
  });
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  captura -> .shots/${name}.png`);
}

const browser = await chromium.launch({
  args: [
    // Chromium headless no tiene GPU: SwiftShader le da WebGL por software,
    // que es todo lo que PixiJS necesita para dibujar.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

try {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });

  // ---------------------------------------------------------- jugador 1
  console.log("Jugador 1: crea la sala");
  const p1 = await ctx.newPage();
  watch(p1, "p1");
  await p1.goto(BASE, { waitUntil: "networkidle" });
  await p1.fill("#nameInput", "Anfitrion");
  await shot(p1, "01-menu");

  await p1.click("#btnCreate");
  await p1.waitForSelector("#screenLobby:not([hidden])", { timeout: 15000 });
  const code = (await p1.textContent("#roomCode"))?.trim() ?? "";
  console.log(`  sala ${code}`);

  // ---------------------------------------------------------- jugador 2
  console.log("Jugador 2: se une");
  const p2 = await ctx.newPage();
  watch(p2, "p2");
  await p2.goto(`${BASE}/?room=${code}`, { waitUntil: "networkidle" });
  await p2.fill("#nameInput", "Invitado");
  await p2.click("#btnJoin");
  await p2.waitForSelector("#screenLobby:not([hidden])", { timeout: 15000 });

  await p1.waitForFunction(() => document.querySelectorAll("#playerList li").length === 2, {
    timeout: 10000,
  });
  await shot(p1, "02-lobby");

  // ------------------------------------------------------------ partida
  console.log("Los dos marcan listo");
  await p1.click("#btnReady");
  await p2.click("#btnReady");

  // El overlay oculto nunca es "visible": hay que esperar a que exista con ese atributo.
  await p1.waitForSelector("#overlay[hidden]", { state: "attached", timeout: 20000 });
  console.log("  la partida arrancó");
  await p1.waitForTimeout(1200);
  await shot(p1, "03-cuenta-regresiva");

  // Esperar a que termine la cuenta regresiva y empiece a jugarse.
  await p1.waitForTimeout(5000);

  // Mover y disparar para que la captura muestre el juego en movimiento.
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  await p1.mouse.move(centre.x + 260, centre.y - 120);
  await p1.keyboard.down("KeyD");
  await p2.keyboard.down("KeyA");
  await p1.waitForTimeout(900);
  await p1.mouse.down();
  await p1.waitForTimeout(700);
  await p1.mouse.up();
  await p1.keyboard.up("KeyD");
  await p2.keyboard.up("KeyA");
  await p1.waitForTimeout(400);

  // Recorrido largo apretando E. El loot está repartido por toda la arena, así
  // que hay que caminar un rato para cruzarse con algo.
  console.log("Recogiendo loot");
  const walk = ["KeyA", "KeyW", "KeyD", "KeyW", "KeyA", "KeyS", "KeyD", "KeyS"];
  for (const key of walk) {
    await p1.keyboard.down(key);
    for (let i = 0; i < 8; i++) {
      await p1.waitForTimeout(160);
      await p1.keyboard.press("KeyE");
    }
    await p1.keyboard.up(key);
  }
  await p1.waitForTimeout(400);

  await shot(p1, "08-loot");

  // Caminar hacia el centro para que la cámara no quede topeada contra el muro
  // y el jugador quede centrado: así el primer plano sale siempre en el mismo lugar.
  await p1.keyboard.down("KeyA");
  await p1.waitForTimeout(2600);
  await p1.keyboard.up("KeyA");
  await p1.mouse.move(centre.x + 200, centre.y + 40);
  await p1.waitForTimeout(400);

  await shot(p1, "04-partida");

  // Primer plano del muñeco, para revisar el sprite y el arma.
  mkdirSync(OUT, { recursive: true });
  await p1.screenshot({
    path: resolve(OUT, "07-primer-plano.png"),
    clip: { x: centre.x - 140, y: centre.y - 100, width: 280, height: 200 },
    scale: "css",
  });
  console.log("  captura -> .shots/07-primer-plano.png");
  await shot(p2, "05-partida-jugador2");

  // El minimapa ampliado: es la única vista del trazado completo del mapa.
  const box = await p1.locator("#minimap").boundingBox();
  if (box) {
    await p1.screenshot({
      path: resolve(OUT, "09-minimapa.png"),
      clip: box,
      scale: "device",
    });
    console.log("  captura -> .shots/09-minimapa.png");
  }

  // Tabla de posiciones.
  await p1.keyboard.down("Tab");
  await p1.waitForTimeout(300);
  await shot(p1, "06-tabla");
  await p1.keyboard.up("Tab");

  // ------------------------------------------------------------ informe
  const hud = await p1.evaluate(() => ({
    vivos: document.getElementById("alive")?.textContent,
    vida: document.getElementById("hpText")?.textContent,
    arma: document.getElementById("weaponName")?.textContent,
    munición: document.getElementById("ammo")?.textContent,
    ranuras: [...document.querySelectorAll("#slots .slot")].map((n) => n.textContent).join(" | "),
    consumibles: [...document.querySelectorAll("#consumables .consumable")]
      .map((n) => n.textContent)
      .join(" | "),
    zona: document.getElementById("zoneTime")?.textContent,
    lienzo: (() => {
      const c = document.querySelector("#stage canvas");
      return c ? `${c.width}x${c.height}` : "SIN CANVAS";
    })(),
  }));

  console.log("\n--- HUD del jugador 1 ---");
  for (const [k, v] of Object.entries(hud)) console.log(`  ${k}: ${v}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log("\n--- problemas detectados ---");
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nSin errores de consola.");
