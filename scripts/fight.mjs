/**
 * Entra con un navegador a una sala donde ya hay bots peleando, para poder ver
 * el feedback de combate de verdad.
 *
 *   npm run dev
 *   node scripts/bot.mjs --bots 6 --seconds 70 --room FEED01 &
 *   node scripts/fight.mjs --room FEED01
 *
 * Montar una pelea entre dos jugadores de Playwright es imposible: aparecen en
 * puntas opuestas del mapa y no se encuentran. Los bots ya se buscan y se matan
 * entre ellos, así que alcanza con mirarlos desde adentro.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../.showcase");
const BASE = process.env.WABBR_URL ?? "http://127.0.0.1:5173";
// Ojo: el alfabeto de códigos no tiene vocales ni 0/1, así que un nombre como
// "FEED01" el cliente lo rechaza aunque los bots entren igual por URL.
const ROOM = arg("room", "K7NDS4");
const SECONDS = Number(arg("seconds", 55));

mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      problems.push(`${m.type()}: ${m.text()}`);
      console.error(`  ! ${m.type()}: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => {
    problems.push(`excepción: ${e.message}`);
    console.error(`  ! excepción: ${e.message}`);
  });

  await page.goto(`${BASE}/?room=${ROOM}`, { waitUntil: "networkidle" });
  await page.fill("#nameInput", "Mati");
  await page.click("#btnJoin");

  // La partida de los bots puede estar ya empezada: en ese caso se entra directo
  // como espectador y el lobby no llega a mostrarse.
  await page.waitForTimeout(2500);
  const enLobby = await page.evaluate(() => !document.getElementById("screenLobby")?.hidden);
  if (enLobby) await page.click("#btnReady");
  console.log(enLobby ? "Esperando en el lobby." : "Entré con la partida ya empezada.");

  const error = await page.evaluate(() => {
    const n = document.getElementById("menuError");
    return n && !n.hidden ? n.textContent : null;
  });
  if (error) throw new Error(`el cliente rechazó la sala: ${error}`);

  await page.waitForSelector("#overlay[hidden]", { state: "attached", timeout: 30000 });
  console.log("En partida con los bots.");

  // Mirar hasta que aparezca la primera línea del kill feed, y fotografiarla.
  const deadline = Date.now() + SECONDS * 1000;
  let captured = false;
  let maxFeed = 0;
  let midShot = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    // Moverse y disparar: si algún bot está cerca, hay intercambio.
    await page.keyboard.press("KeyE");
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();

    const feed = await page.evaluate(() => document.querySelectorAll("#killfeed .kill-line").length);
    maxFeed = Math.max(maxFeed, feed);

    // Foto de la pelea a mitad de camino: es donde caen los números de daño.
    if (!midShot && Date.now() > deadline - SECONDS * 1000 + 18000) {
      midShot = true;
      await page.screenshot({ path: resolve(OUT, "17-pelea.png") });
      console.log("  17-pelea.png");
    }

    if (feed > 0 && !captured) {
      captured = true;
      await page.screenshot({ path: resolve(OUT, "15-killfeed.png") });
      const box = await page.locator("#killfeed").boundingBox();
      if (box) {
        await page.screenshot({
          path: resolve(OUT, "16-killfeed-cerca.png"),
          clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
        });
      }
      console.log("  kill feed capturado");
    }
  }

  const state = await page.evaluate(() => ({
    vida: document.getElementById("hpText")?.textContent,
    vivos: document.getElementById("alive")?.textContent,
    lineas: [...document.querySelectorAll("#killfeed .kill-line")].map((n) => ({
      texto: n.textContent,
      mia: n.classList.contains("mine"),
      icono: n.querySelector("img")?.src.slice(0, 22),
    })),
  }));

  console.log(`\nlíneas de kill feed vistas: ${maxFeed}`);
  console.log("estado:", JSON.stringify(state, null, 2));
} finally {
  await browser.close();
}

if (problems.length) {
  console.log("\n--- problemas ---");
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nSin errores de consola.");
