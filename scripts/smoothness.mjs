/**
 * Mide qué tan parejo se mueve el jugador local, cuadro a cuadro.
 *
 *   npm run dev
 *   node scripts/smoothness.mjs
 *
 * La simulación avanza 20 veces por segundo y la pantalla dibuja 60. Si el
 * muñeco se dibuja directamente en la posición simulada, dos de cada tres
 * cuadros repiten la anterior y moverse se ve a los saltos aunque el contador
 * de FPS diga 60. Este script cuenta exactamente eso: qué porcentaje de cuadros
 * no movieron nada.
 */
import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WABBR_URL ?? "http://127.0.0.1:5173";
const SECONDS = Number(process.env.WABBR_SECONDS ?? 2);

const browser = await chromium.launch({
  // Chromium headless estrangula requestAnimationFrame a unos 4 por segundo, y
  // así no se puede medir nada de la fluidez: se estaría midiendo el navegador
  // de pruebas, no el juego. Con WABBR_HEADED=1 abre una ventana de verdad.
  headless: process.env.WABBR_HEADED !== "1",
  // Los demás scripts fuerzan renderizado por software para correr en cualquier
  // lado, pero acá eso arruina la medición: swiftshader dibuja a unos 4 cuadros
  // por segundo y no se puede distinguir un tirón del juego de uno del emulador.
  // Este script necesita la GPU de verdad, así que no le impone nada.
  args: [],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const p1 = await ctx.newPage();
  await p1.goto(BASE, { waitUntil: "domcontentloaded" });
  await p1.fill("#nameInput", "Mati");
  await p1.click("#btnCreate");
  await p1.waitForSelector("#screenLobby:not([hidden])", { timeout: 20000 });
  const code = await p1.textContent("#roomCode");

  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/?room=${code}`, { waitUntil: "domcontentloaded" });
  await p2.fill("#nameInput", "Tomi");
  await p2.click("#btnJoin");
  await p2.waitForSelector("#screenLobby:not([hidden])", { timeout: 20000 });

  await p1.click("#btnReady");
  await p2.click("#btnReady");
  await p1.waitForSelector("#overlay[hidden]", { state: "attached", timeout: 40000 });
  // Sin esto la pestaña queda en segundo plano y el navegador estrangula
  // requestAnimationFrame: se medirían 4 cuadros por segundo y nada más.
  await p1.bringToFront();
  // Que se oculte el overlay no significa que ya estés jugando: entre eso y el
  // spawn autoritativo pasan unos segundos en los que no hay muñeco que medir.
  await p1.waitForFunction(() => window.wabbr?.enFrame()?.alive === true, { timeout: 30000 });
  await p1.waitForTimeout(500);

  // Antes de medir nada, comprobar que este navegador dibuja a un ritmo normal.
  // Si no, cualquier número de abajo diría más del entorno que del juego.
  const fps = await p1.evaluate(
    () =>
      new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(f);
          else r(n);
        };
        requestAnimationFrame(f);
      }),
  );
  if (fps < 30) {
    console.log(`Este navegador dibuja a ${fps} cuadros por segundo: no sirve para medir fluidez.`);
    console.log("Volvé a correrlo con  WABBR_HEADED=1 node scripts/smoothness.mjs");
    process.exitCode = 2;
    throw new Error("entorno sin cuadros suficientes");
  }

  // Caminar en línea recta mientras se muestrea cada cuadro. El foco importa:
  // el juego suelta todas las teclas cuando la ventana lo pierde, y midiendo sin
  // foco saldría que el muñeco no se mueve —que es cierto, pero no dice nada.
  await p1.locator("#stage canvas").click({ position: { x: 200, y: 400 } });

  /** Camina en una dirección `segundos` y devuelve una muestra por cuadro. */
  const caminar = async (teclas, segundos) => {
    for (const k of teclas) await p1.keyboard.down(k);
    const m = await p1.evaluate(async (s) => {
      const pos = [];
      const t0 = performance.now();
      return await new Promise((listo) => {
        const paso = () => {
          const v = window.wabbr.sprite();
          if (v?.mundo) pos.push({ t: performance.now(), x: v.mundo.x, y: v.mundo.y });
          if (performance.now() - t0 < s * 1000) requestAnimationFrame(paso);
          else listo(pos);
        };
        requestAnimationFrame(paso);
      });
    }, segundos);
    for (const k of teclas) await p1.keyboard.up(k);
    return m;
  };

  /*
   * El spawn cae en cualquier parte, así que caminar siempre para el mismo lado
   * termina con el muñeco forcejeando contra una pared. Ahí el avance por cuadro
   * es cero la mayor parte del tiempo y el veredicto sale "a los saltos" aunque
   * la interpolación esté perfecta: dos corridas seguidas daban 0% y 77% de
   * cuadros quietos por esto. Se prueban direcciones hasta encontrar una libre.
   */
  const RUMBOS = [
    ["KeyD"], ["KeyW"], ["KeyA"], ["KeyS"],
    ["KeyW", "KeyD"], ["KeyS", "KeyA"], ["KeyW", "KeyA"], ["KeyS", "KeyD"],
  ];
  const MINIMO = 150; // px que hay que recorrer para que la muestra sirva

  let muestras = null;
  for (const rumbo of RUMBOS) {
    const m = await caminar(rumbo, SECONDS);
    if (m.length < 30) continue;
    const d = Math.hypot(m.at(-1).x - m[0].x, m.at(-1).y - m[0].y);
    console.log(`  ${rumbo.join("+").padEnd(9)} recorrió ${d.toFixed(0)} px`);
    if (d >= MINIMO) {
      muestras = m;
      break;
    }
  }

  if (!muestras) {
    console.log("\nNo encontró una dirección libre para medir. Probá de nuevo.");
    process.exitCode = 2;
    throw new Error("entorno sin cuadros suficientes");
  }
  console.log("");

  const saltos = [];
  for (let i = 1; i < muestras.length; i++) {
    saltos.push(Math.hypot(muestras[i].x - muestras[i - 1].x, muestras[i].y - muestras[i - 1].y));
  }
  const enMovimiento = saltos.filter((d) => d > 0.01);
  const quietos = saltos.length - enMovimiento.length;
  const media = enMovimiento.reduce((a, b) => a + b, 0) / Math.max(enMovimiento.length, 1);
  // Desvío relativo del avance por cuadro: si todos los cuadros avanzan lo
  // mismo, es cero. Cuanto más alto, más a los tirones se ve.
  const varianza =
    enMovimiento.reduce((a, d) => a + (d - media) ** 2, 0) / Math.max(enMovimiento.length, 1);
  const cv = Math.sqrt(varianza) / Math.max(media, 1e-9);

  const dur = (muestras.at(-1).t - muestras[0].t) / 1000;
  console.log(`cuadros:              ${muestras.length} en ${dur.toFixed(2)}s (${(muestras.length / dur).toFixed(0)} fps)`);
  console.log(`cuadros sin avanzar:  ${quietos} (${((100 * quietos) / saltos.length).toFixed(1)}%)`);
  console.log(`avance por cuadro:    ${media.toFixed(2)} px`);
  console.log(`desvío relativo:      ${(cv * 100).toFixed(1)}%`);
  const orden = [...saltos].sort((a, b) => a - b);
  const pct = (q) => orden[Math.min(orden.length - 1, Math.floor(q * orden.length))].toFixed(2);
  console.log(`reparto (p10/50/90):  ${pct(0.1)} / ${pct(0.5)} / ${pct(0.9)} px`);

  /*
   * El veredicto mira los cuadros que no avanzan nada, que es exactamente lo que
   * se ve como tirón. El desvío se informa pero no decide: siempre queda una
   * cola de cuadros cortos en los bordes de tick y en las correcciones del
   * servidor, y eso no se percibe.
   *
   * Referencia medida a 145 fps: dibujando la posición simulada tal cual, 77% de
   * los cuadros no avanzaban. Interpolando entre pasos, 0,3%.
   */
  const ok = quietos / saltos.length < 0.1;
  console.log(
    ok
      ? "\nOK: el movimiento se reparte entre cuadros."
      : "\nA LOS SALTOS: la pantalla dibuja más rápido de lo que se mueve el muñeco.",
  );
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  if (!String(e.message).includes("entorno sin cuadros")) throw e;
} finally {
  await browser.close();
}
