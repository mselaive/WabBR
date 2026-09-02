/**
 * Saca un set de capturas presentables del juego.
 *
 *   npm run dev            # en otra terminal
 *   node scripts/showcase.mjs
 *
 * A diferencia de `shot.mjs`, que verifica que nada esté roto, este script
 * BUSCA algo interesante que mostrar: camina hasta encontrar una caja de botín
 * usando el propio cartel del HUD como sensor, y la abre. Es la única forma de
 * conseguir una foto del interior de una casa sin hardcodear coordenadas que
 * cambiarían al tocar el generador del mapa.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../.showcase");
const BASE = process.env.WABBR_URL ?? "http://127.0.0.1:5173";
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const shot = async (page, name) => {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
};

/** Texto actual del cartel de "apretá E". Cadena vacía si está oculto. */
const prompt = (page) =>
  page.evaluate(() => {
    const node = document.getElementById("pickupPrompt");
    return node && !node.hidden ? (node.textContent ?? "") : "";
  });

/** Posición del jugador según el enganche de dev, o null. */
const where = (page) =>
  page.evaluate(() => {
    const w = window.wabbr;
    const p = w?.pos?.();
    return p ? { x: p.x, y: p.y, cx: w.centro.x, cy: w.centro.y } : null;
  });

const DIRS = [
  ["KeyW"], ["KeyD"], ["KeyS"], ["KeyA"],
  ["KeyW", "KeyD"], ["KeyS", "KeyA"], ["KeyW", "KeyA"], ["KeyS", "KeyD"],
];

/** Teclas que apuntan de `p` al centro. Null si ya está cerca. */
function keysTowardCenter(p) {
  const dx = p.cx - p.x;
  const dy = p.cy - p.y;
  if (Math.hypot(dx, dy) < 400) return null;

  const keys = [];
  if (Math.abs(dx) > 120) keys.push(dx > 0 ? "KeyD" : "KeyA");
  if (Math.abs(dy) > 120) keys.push(dy > 0 ? "KeyS" : "KeyW");
  return keys.length ? keys : null;
}

/**
 * Camina hasta que el HUD anuncie una caja. Devuelve true si la encontró.
 *
 * Va hacia el centro, porque el spawn cae en el borde y ahí afuera hay pasto y
 * poco más: las casas y las cajas están en los distritos. Pero ir en línea recta
 * no alcanza — el camino directo casi siempre cruza una pared, y contra una
 * pared el jugador se queda apretando la misma tecla para siempre. Por eso mide
 * cuánto avanzó de verdad y, si no avanzó, rodea en otra dirección un rato.
 */
async function huntForCrate(page, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  let random = 0; // tramos que faltan rodeando antes de volver a ir al centro
  let i = 0;
  let last = await where(page);

  while (Date.now() < deadline) {
    const at = (await where(page)) ?? last;
    const keys = (random === 0 && at && keysTowardCenter(at)) || DIRS[i++ % DIRS.length];
    if (random > 0) random--;

    for (const key of keys) await page.keyboard.down(key);
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(120);
      if ((await prompt(page)).includes("Abrir caja")) {
        for (const key of keys) await page.keyboard.up(key);
        return true;
      }
    }
    for (const key of keys) await page.keyboard.up(key);

    const now = await where(page);
    const moved = now && at ? Math.hypot(now.x - at.x, now.y - at.y) : 999;
    // Un tramo de 1,4 s a pie recorre bastante más que 40 px: si no, hay pared.
    if (moved < 40 && random === 0) {
      random = 3;
      i = Math.floor(Math.random() * DIRS.length);
    }
    if (now) {
      const d = Math.round(Math.hypot(now.cx - now.x, now.cy - now.y));
      console.log(`    (${Math.round(now.x)},${Math.round(now.y)}) a ${d} del centro` +
        ` · avanzó ${Math.round(moved)}px${random > 0 ? " · rodeando" : ""}`);
    }
    last = now ?? last;
  }
  return false;
}

try {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  const p1 = await ctx.newPage();
  await p1.goto(BASE, { waitUntil: "networkidle" });
  await p1.fill("#nameInput", "Mati");
  await shot(p1, "1-menu");

  await p1.click("#btnCreate");
  await p1.waitForSelector("#screenLobby:not([hidden])", { timeout: 15000 });
  const code = (await p1.textContent("#roomCode"))?.trim() ?? "";

  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/?room=${code}`, { waitUntil: "networkidle" });
  await p2.fill("#nameInput", "Tomi");
  await p2.click("#btnJoin");
  await p2.waitForSelector("#screenLobby:not([hidden])", { timeout: 15000 });

  await p1.waitForFunction(() => document.querySelectorAll("#playerList li").length === 2);
  await shot(p1, "2-lobby");

  await p1.click("#btnReady");
  await p2.click("#btnReady");
  await p1.waitForSelector("#overlay[hidden]", { state: "attached", timeout: 20000 });
  await p1.waitForTimeout(1500);
  await shot(p1, "3-cuenta-regresiva");

  await p1.waitForTimeout(4500);
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  await p1.mouse.move(centre.x + 220, centre.y - 90);
  await p1.waitForTimeout(500);
  await shot(p1, "4-campo-abierto");

  console.log("Buscando una caja...");
  const found = await huntForCrate(p1);
  console.log(found ? "  encontrada" : "  no apareció ninguna en el recorrido");

  if (found) {
    await p1.waitForTimeout(300);
    // El muñeco se dibuja solo si viene en el frame interpolado, pero la cámara
    // lo sigue por la predicción: si el frame no lo trae, la foto sale sin
    // jugador y la cámara igual apunta bien. Vale la pena verificarlo acá.
    console.log("  jugador:", JSON.stringify(await p1.evaluate(() => ({
      sprite: window.wabbr.sprite(),
      enFrame: window.wabbr.enFrame(),
      predicho: window.wabbr.pos(),
    }))));
    await shot(p1, "5-caja-cerrada");
    await p1.keyboard.press("KeyE");
    await p1.waitForTimeout(700);
    await shot(p1, "6-caja-abierta");

    // Levantar lo que salió.
    for (let i = 0; i < 6; i++) {
      await p1.keyboard.press("KeyE");
      await p1.waitForTimeout(250);
    }
    await shot(p1, "7-botin-recogido");
  }

  // Probar la granada y el sprint. Si no encontró granadas no pasa nada, pero
  // el sprint siempre se puede mostrar: la barra de estamina baja igual.
  await p1.keyboard.down("ShiftLeft");
  await p1.keyboard.down("KeyW");
  await p1.waitForTimeout(1400);
  await shot(p1, "11-corriendo");
  await p1.keyboard.up("KeyW");
  await p1.keyboard.up("ShiftLeft");

  await p1.mouse.move(centre.x + 240, centre.y - 60);
  await p1.keyboard.press("KeyG");
  await p1.waitForTimeout(900);
  await shot(p1, "12-granada-volando");
  await p1.waitForTimeout(1300);
  await shot(p1, "13-explosion");

  // Disparar, para que se vea el fogonazo.
  await p1.mouse.move(centre.x + 260, centre.y);
  await p1.mouse.down();
  await p1.waitForTimeout(260);
  await shot(p1, "8-disparando");
  await p1.mouse.up();

  await p1.keyboard.down("Tab");
  await p1.waitForTimeout(300);
  await shot(p1, "9-tabla");
  await p1.keyboard.up("Tab");

  // Primer plano del HUD inferior, para revisar las barras sin adivinar píxeles.
  await p1.screenshot({
    path: resolve(OUT, "14-hud.png"),
    clip: { x: VIEWPORT.width / 2 - 180, y: VIEWPORT.height - 130, width: 360, height: 125 },
  });
  console.log("  14-hud.png");

  const box = await p1.locator("#minimap").boundingBox();
  if (box) {
    await p1.screenshot({ path: resolve(OUT, "10-minimapa.png"), clip: box });
    console.log("  10-minimapa.png");
  }

  const hud = await p1.evaluate(() => ({
    arma: document.getElementById("weaponName")?.textContent,
    municion: document.getElementById("ammo")?.textContent,
    ranuras: [...document.querySelectorAll("#slots .slot")].map((n) => n.textContent).join(" | "),
    // Sonda de las barras: mirar píxeles para saber si una barra existe y en
    // qué orden está es adivinar; el DOM lo dice sin ambigüedad.
    barras: [...document.querySelectorAll("#hud .hud-bottom > *")]
      .map((n) => `${n.id || n.className}${n.hidden ? "(oculto)" : ""}`)
      .join(" > "),
    estamina: document.getElementById("staminaFill")?.style.width,
    escudoOculto: document.getElementById("shieldBar")?.hidden,
  }));
  console.log("\nHUD:", JSON.stringify(hud));
} finally {
  await browser.close();
}
