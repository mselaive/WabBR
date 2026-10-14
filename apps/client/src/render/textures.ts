import { Texture } from "pixi.js";
import { HAT_COUNT, WEAPON_IDS, makeRng } from "@wabbr/shared";

/**
 * Todo el arte se dibuja por código en un canvas y se sube como textura.
 * El truco del pixel art: se dibuja a la mitad de resolución y después el
 * sprite se escala x2 con filtro "nearest", así cada píxel del dibujo ocupa
 * 2x2 en pantalla y los bordes quedan duros.
 *
 * Si algún día se usan sprites de verdad (Kenney y compañía), se reemplaza
 * este archivo por un cargador de atlas y nada más cambia.
 */

/** Un píxel de arte equivale a este tamaño en unidades del mundo. */
export const ART_SCALE = 2;

type Ctx = CanvasRenderingContext2D;

function make(w: number, h: number, draw: (ctx: Ctx) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Contorno oscuro de 1 px: es lo que hace que el pixel art "lea" sobre el pasto. */
function outline(ctx: Ctx, x: number, y: number, w: number, h: number, color = "#1b1410"): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ------------------------------------------------------------------ suelo

const GRASS = ["#4e8438", "#578f3e", "#457a32", "#5f9a45"];

export function grassTexture(): Texture {
  return make(32, 32, (ctx) => {
    rect(ctx, 0, 0, 32, 32, GRASS[0]!);
    const rnd = makeRng(1234);
    for (let i = 0; i < 150; i++) {
      const x = Math.floor(rnd() * 32);
      const y = Math.floor(rnd() * 32);
      rect(ctx, x, y, 1, 1, GRASS[1 + Math.floor(rnd() * 3)]!);
    }
    // Matitas de pasto más claras, esparcidas.
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(rnd() * 32);
      const y = Math.floor(rnd() * 32);
      rect(ctx, x, y, 1, 2, "#69a84c");
    }
  });
}

export function dirtTexture(): Texture {
  return make(32, 32, (ctx) => {
    rect(ctx, 0, 0, 32, 32, "#9c8354");
    const rnd = makeRng(4321);
    for (let i = 0; i < 170; i++) {
      const x = Math.floor(rnd() * 32);
      const y = Math.floor(rnd() * 32);
      rect(ctx, x, y, 1, 1, rnd() < 0.5 ? "#8d7549" : "#a98f5f");
    }
  });
}

/** Terreno fuera del muro. Sin esto, salir de la arena se ve como un bug de render. */
export function voidTexture(): Texture {
  return make(32, 32, (ctx) => {
    rect(ctx, 0, 0, 32, 32, "#191d23");
    const rnd = makeRng(555);
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(rnd() * 32);
      const y = Math.floor(rnd() * 32);
      rect(ctx, x, y, 1, 1, rnd() < 0.5 ? "#14181d" : "#1e242b");
    }
  });
}

// --------------------------------------------------------------- muralla

/** Bloque de piedra del muro perimetral. */
export function wallRingTexture(): Texture {
  return make(16, 16, (ctx) => {
    rect(ctx, 0, 0, 16, 16, "#6e6a66");
    const rnd = makeRng(99);
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rnd() * 16);
      const y = Math.floor(rnd() * 16);
      rect(ctx, x, y, 1, 1, rnd() < 0.5 ? "#7c7873" : "#615d59");
    }
    rect(ctx, 0, 0, 16, 1, "#8a8681");
    rect(ctx, 0, 15, 16, 1, "#4e4a47");
  });
}

// ---------------------------------------------------------------- casas

/**
 * Las paredes de las casas son tiras largas de tamaño variable, así que van con
 * TilingSprite en vez de un sprite estirado: la textura se repite y el pixel
 * art no se deforma.
 */
export function wallTileTexture(variant: number): Texture {
  return make(16, 16, (ctx) => {
    const base = variant === 0 ? "#9a9086" : "#8e8c94";
    const dark = variant === 0 ? "#7d746b" : "#73727a";
    const light = variant === 0 ? "#b0a79c" : "#a3a1aa";
    rect(ctx, 0, 0, 16, 16, base);
    // Hiladas de ladrillo trabadas.
    rect(ctx, 0, 7, 16, 1, dark);
    rect(ctx, 0, 15, 16, 1, dark);
    rect(ctx, 5, 0, 1, 7, dark);
    rect(ctx, 12, 8, 1, 7, dark);
    rect(ctx, 0, 0, 16, 1, light);
    rect(ctx, 0, 8, 16, 1, light);
  });
}

export function floorTexture(variant: number): Texture {
  return make(16, 16, (ctx) => {
    if (variant === 0) {
      // Tablones de madera.
      rect(ctx, 0, 0, 16, 16, "#6d4a26");
      rect(ctx, 0, 5, 16, 1, "#573a1d");
      rect(ctx, 0, 11, 16, 1, "#573a1d");
      rect(ctx, 0, 0, 16, 1, "#7d5730");
      rect(ctx, 7, 0, 1, 5, "#573a1d");
      rect(ctx, 3, 6, 1, 5, "#573a1d");
      rect(ctx, 11, 12, 1, 4, "#573a1d");
    } else {
      // Baldosas de hormigón. Va bastante más oscuro que la pared a propósito:
      // si el piso y la pared tienen el mismo gris, adentro de una casa no se
      // distingue qué te bloquea y qué podés pisar.
      rect(ctx, 0, 0, 16, 16, "#585c63");
      rect(ctx, 0, 0, 8, 8, "#5f636a");
      rect(ctx, 8, 8, 8, 8, "#5f636a");
      rect(ctx, 0, 7, 16, 1, "#4a4d53");
      rect(ctx, 7, 0, 1, 16, "#4a4d53");
      const rnd = makeRng(variant * 31 + 7);
      for (let i = 0; i < 18; i++) {
        rect(ctx, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, "#64686f");
      }
    }
  });
}

// ------------------------------------------------------------ obstáculos

function crate(variant: number): Texture {
  return make(24, 28, (ctx) => {
    const light = variant === 1 ? "#b8894e" : "#a97b45";
    const dark = variant === 1 ? "#7d5a2f" : "#6f4f28";
    // Cara superior + frente, para dar volumen.
    rect(ctx, 1, 1, 22, 22, light);
    rect(ctx, 1, 23, 22, 4, dark);
    // Refuerzos en X.
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(3, 3);
    ctx.lineTo(21, 21);
    ctx.moveTo(21, 3);
    ctx.lineTo(3, 21);
    ctx.stroke();
    rect(ctx, 1, 1, 22, 2, dark);
    rect(ctx, 1, 21, 22, 2, dark);
    outline(ctx, 0, 0, 24, 28);
  });
}

/**
 * Caja de botín. Tiene que distinguirse a simple vista de la caja de cobertura
 * o la gente va a perder tiempo apretando E contra madera: por eso los flejes
 * dorados y el candado.
 */
function lootCrate(open: boolean, golden = false): Texture {
  return make(26, 28, (ctx) => {
    // La dorada es toda de oro, no de madera: se tiene que distinguir de lejos.
    const wood = golden ? (open ? "#8a6a1c" : "#f2c230") : open ? "#6b4a26" : "#a3743c";
    const dark = golden ? (open ? "#5e4710" : "#b8871a") : open ? "#4e351a" : "#75512a";
    const gold = golden ? (open ? "#b89a4a" : "#fff3b0") : open ? "#8a6f2c" : "#e8b53f";

    rect(ctx, 1, 2, 24, 22, wood);
    rect(ctx, 1, 24, 24, 3, dark);

    if (open) {
      // Interior vacío: la caja ya dio lo suyo.
      rect(ctx, 4, 5, 18, 15, "#241a10");
      rect(ctx, 4, 5, 18, 2, "#120c07");
    } else {
      // Vetas de la madera y flejes metálicos.
      rect(ctx, 1, 8, 24, 1, dark);
      rect(ctx, 1, 17, 24, 1, dark);
      rect(ctx, 8, 2, 1, 22, dark);
      rect(ctx, 17, 2, 1, 22, dark);
    }

    rect(ctx, 1, 2, 24, 2, gold);
    rect(ctx, 1, 21, 24, 2, gold);
    if (!open) {
      rect(ctx, 11, 11, 4, 5, gold);
      rect(ctx, 12, 13, 2, 2, "#3a2a10");
    }
    // Un brillo en la esquina de la dorada.
    if (golden && !open) {
      rect(ctx, 3, 5, 2, 2, "#ffffff");
      rect(ctx, 4, 4, 1, 4, "#fffbe0");
      rect(ctx, 2, 6, 4, 1, "#fffbe0");
    }
    outline(ctx, 0, 1, 26, 27);
  });
}

function wallBlock(): Texture {
  return make(34, 26, (ctx) => {
    rect(ctx, 1, 1, 32, 17, "#8f8d88");
    rect(ctx, 1, 18, 32, 7, "#5f5d59");
    // Junta de mampostería.
    rect(ctx, 1, 9, 32, 1, "#75736f");
    rect(ctx, 16, 1, 1, 8, "#75736f");
    rect(ctx, 8, 10, 1, 8, "#75736f");
    rect(ctx, 25, 10, 1, 8, "#75736f");
    rect(ctx, 1, 1, 32, 1, "#a5a39e");
    outline(ctx, 0, 0, 34, 26);
  });
}

function container(): Texture {
  return make(78, 56, (ctx) => {
    rect(ctx, 1, 1, 76, 40, "#2f6ea8");
    rect(ctx, 1, 41, 76, 14, "#1f4d78");
    // Corrugado.
    for (let x = 4; x < 74; x += 5) rect(ctx, x, 3, 2, 36, "#28618f");
    rect(ctx, 1, 1, 76, 2, "#4d8cc4");
    rect(ctx, 1, 39, 76, 2, "#1b4468");
    outline(ctx, 0, 0, 78, 56, "#12283d");
  });
}

function tree(variant: number): Texture {
  return make(44, 56, (ctx) => {
    // Tronco (la base coincide con el collider).
    rect(ctx, 19, 40, 6, 14, "#6b4a2a");
    rect(ctx, 19, 40, 2, 14, "#7d5832");
    const green = variant === 1 ? "#2f6b30" : variant === 2 ? "#3a7d38" : "#347433";
    const lit = variant === 1 ? "#3f8340" : variant === 2 ? "#4c9848" : "#458c43";
    ellipse(ctx, 22, 26, 20, 20, "#22501f");
    ellipse(ctx, 22, 25, 18, 18, green);
    ellipse(ctx, 17, 20, 10, 9, lit);
    const rnd = makeRng(variant * 77 + 3);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 17;
      rect(ctx, 22 + Math.cos(a) * r, 25 + Math.sin(a) * r, 1, 1, rnd() < 0.5 ? lit : "#2a5f28");
    }
  });
}

function rock(): Texture {
  return make(22, 20, (ctx) => {
    ellipse(ctx, 11, 11, 10, 8, "#5c5f63");
    ellipse(ctx, 10, 9, 8, 6, "#787c81");
    ellipse(ctx, 8, 7, 4, 3, "#8d9197");
    outline(ctx, 1, 3, 20, 16, "#33363a");
  });
}

/** Barril que ya estalló: el mismo tambor, chamuscado y abierto arriba. */
function burntBarrel(): Texture {
  return make(18, 24, (ctx) => {
    rect(ctx, 2, 8, 14, 14, "#2b2726");
    rect(ctx, 2, 9, 14, 2, "#3d2a26");
    rect(ctx, 2, 16, 14, 2, "#1d1a19");
    // Bordes rotos donde estaba la tapa.
    rect(ctx, 2, 6, 3, 2, "#2b2726");
    rect(ctx, 8, 7, 3, 1, "#2b2726");
    rect(ctx, 13, 6, 3, 2, "#2b2726");
    ellipse(ctx, 9, 9, 5, 2, "#0d0b0a");
    // Una brasa que todavía no se apagó.
    rect(ctx, 6, 13, 2, 1, "#c9541e");
    outline(ctx, 1, 6, 16, 17);
  });
}

function barrel(): Texture {
  return make(18, 24, (ctx) => {
    rect(ctx, 2, 4, 14, 18, "#a8332f");
    rect(ctx, 2, 4, 14, 2, "#c9433e");
    rect(ctx, 2, 9, 14, 2, "#7d2422");
    rect(ctx, 2, 16, 14, 2, "#7d2422");
    ellipse(ctx, 9, 5, 7, 3, "#c9433e");
    ellipse(ctx, 9, 5, 4, 2, "#8f2b28");
    outline(ctx, 1, 2, 16, 21);
  });
}

// ------------------------------------------------------------ decoración

function bush(variant: number): Texture {
  return make(24, 18, (ctx) => {
    const base = variant === 1 ? "#356f31" : "#3d7a37";
    ellipse(ctx, 12, 11, 11, 7, "#254e22");
    ellipse(ctx, 12, 10, 10, 6, base);
    ellipse(ctx, 8, 8, 5, 3, "#4b9042");
    if (variant === 2) {
      // Arbusto con flores, como el del centro de la referencia.
      const rnd = makeRng(21);
      for (let i = 0; i < 7; i++) {
        rect(ctx, 3 + rnd() * 18, 5 + rnd() * 9, 2, 2, "#f2a8d0");
      }
    }
  });
}

function grassTuft(): Texture {
  return make(10, 10, (ctx) => {
    rect(ctx, 2, 4, 1, 5, "#5f9a45");
    rect(ctx, 4, 2, 1, 7, "#6ba84c");
    rect(ctx, 6, 5, 1, 4, "#568c3e");
    rect(ctx, 8, 3, 1, 6, "#5f9a45");
  });
}

function flower(variant: number): Texture {
  const color = variant === 0 ? "#f5e06a" : variant === 1 ? "#f2f2f2" : "#e8a0d8";
  return make(6, 6, (ctx) => {
    rect(ctx, 2, 3, 1, 3, "#4e8438");
    rect(ctx, 1, 1, 3, 1, color);
    rect(ctx, 1, 3, 1, 1, color);
    rect(ctx, 3, 3, 1, 1, color);
    rect(ctx, 2, 2, 1, 1, "#c58c2a");
  });
}

function pebble(): Texture {
  return make(6, 5, (ctx) => {
    ellipse(ctx, 3, 3, 2.5, 2, "#6e7276");
    rect(ctx, 2, 2, 1, 1, "#8b8f94");
  });
}

// --------------------------------------------------------------- jugador

/**
 * El personaje va en dos capas: `body` con lo que nunca cambia (piel, mochila,
 * contorno) y `shirt` con lo que se tiñe del color del jugador. Así el tint de
 * Pixi no le pinta la cara de azul.
 */
function drawPlayerBody(ctx: Ctx): void {
  // Sombra en el piso.
  ellipse(ctx, 8, 16, 6, 2.5, "#00000038");
  // Hombros / torso.
  rect(ctx, 3, 7, 10, 8, "#2b3138");
  // Brazos.
  rect(ctx, 2, 8, 2, 5, "#d8a074");
  rect(ctx, 12, 8, 2, 5, "#d8a074");
  // Cabeza vista desde arriba.
  ellipse(ctx, 8, 6, 5, 5, "#1b1410");
  ellipse(ctx, 8, 6, 4.2, 4.2, "#e8b184");
  ellipse(ctx, 8, 6.5, 3.4, 3.4, "#f0bd90");
  // Contorno oscuro alrededor del torso: sin esto el muñeco se pierde sobre el pasto.
  outline(ctx, 2, 6, 12, 10, "#1b1410");
}

function drawPlayerShirt(ctx: Ctx): void {
  // Remera (torso) y gorra: son las partes que reciben el color del jugador.
  rect(ctx, 3, 9, 10, 6, "#ffffff");
  ellipse(ctx, 8, 4.5, 4.5, 3.5, "#ffffff");
  rect(ctx, 4, 4, 8, 2, "#dddddd");
}

/**
 * Los gorros. Se dibujan en un cuadro de 16x24: el mismo del muñeco (16x18)
 * con 6 px más arriba, porque algunos son altos. La cabeza queda en (8, 12).
 * El 0 no es un gorro: es la gorra de siempre, que es parte de la remera.
 */
export function drawHat(ctx: Ctx, hat: number): void {
  const gold = "#ffc94a";
  switch (hat) {
    case 1: // corona
      rect(ctx, 4, 6, 8, 3, gold);
      rect(ctx, 4, 4, 2, 2, gold);
      rect(ctx, 7, 3, 2, 3, gold);
      rect(ctx, 10, 4, 2, 2, gold);
      rect(ctx, 7, 7, 2, 1, "#e0483b");
      rect(ctx, 4, 8, 8, 1, "#c9952a");
      break;
    case 2: // casco
      ellipse(ctx, 8, 10, 6, 5, "#4f6b3a");
      ellipse(ctx, 7, 9, 3, 2, "#6b8a50");
      rect(ctx, 2, 11, 12, 2, "#3e542d");
      break;
    case 3: // sombrero vaquero
      ellipse(ctx, 8, 11, 8, 2.5, "#8a5a30");
      rect(ctx, 5, 5, 6, 6, "#a3743c");
      rect(ctx, 5, 9, 6, 1, "#4e351a");
      break;
    case 4: // gorro de fiesta
      ctx.fillStyle = "#4aa3ff";
      ctx.beginPath();
      ctx.moveTo(4, 10);
      ctx.lineTo(12, 10);
      ctx.lineTo(8, 1);
      ctx.closePath();
      ctx.fill();
      rect(ctx, 6, 6, 4, 1, "#ff5c8a");
      rect(ctx, 5, 8, 6, 1, "#ffd257");
      rect(ctx, 7, 0, 2, 2, "#ff5c8a");
      break;
    case 5: // cuernos
      rect(ctx, 3, 6, 2, 3, "#c0392b");
      rect(ctx, 2, 4, 2, 2, "#e74c3c");
      rect(ctx, 11, 6, 2, 3, "#c0392b");
      rect(ctx, 12, 4, 2, 2, "#e74c3c");
      break;
    case 6: // bandana
      rect(ctx, 3, 9, 10, 2, "#d9483b");
      rect(ctx, 3, 9, 10, 1, "#ff6a5a");
      rect(ctx, 12, 11, 2, 3, "#d9483b");
      break;
    case 7: // aureola
      ctx.strokeStyle = "#ffe066";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(8, 4, 5, 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 8: // gorro de mago
      ctx.fillStyle = "#7b4fd6";
      ctx.beginPath();
      ctx.moveTo(3, 10);
      ctx.lineTo(13, 10);
      ctx.lineTo(9, 0);
      ctx.closePath();
      ctx.fill();
      rect(ctx, 2, 9, 12, 2, "#5a36a8");
      rect(ctx, 8, 5, 2, 2, "#ffe066");
      break;
    case 9: // galera
      rect(ctx, 5, 3, 6, 7, "#1b1f24");
      rect(ctx, 5, 7, 6, 1, "#c0392b");
      rect(ctx, 3, 9, 10, 2, "#1b1f24");
      rect(ctx, 6, 3, 1, 4, "#3a4048");
      break;
  }
}

function hatTexture(hat: number): Texture {
  return make(16, 24, (ctx) => drawHat(ctx, hat));
}

function playerBody(): Texture {
  return make(16, 18, drawPlayerBody);
}

function playerShirt(): Texture {
  return make(16, 18, drawPlayerShirt);
}

function gun(): Texture {
  return make(16, 6, (ctx) => {
    rect(ctx, 0, 2, 11, 2, "#4a4a4e");
    rect(ctx, 10, 2, 5, 1, "#6a6a70");
    rect(ctx, 2, 4, 3, 2, "#5a3f26");
    rect(ctx, 0, 2, 11, 1, "#63636a");
  });
}

function bullet(): Texture {
  return make(4, 3, (ctx) => {
    rect(ctx, 0, 1, 4, 1, "#ffe9a8");
    rect(ctx, 2, 0, 2, 3, "#ffd257");
  });
}

/** El cohete: cuerpo gris, punta roja y la llama atrás. Apunta a la derecha, como la bala. */
function rocket(): Texture {
  return make(12, 6, (ctx) => {
    rect(ctx, 0, 2, 3, 2, "#ffb347");
    rect(ctx, 1, 1, 1, 4, "#ff7a2a");
    rect(ctx, 3, 1, 6, 4, "#8a929b");
    rect(ctx, 3, 1, 6, 1, "#b9c0c8");
    rect(ctx, 9, 2, 2, 2, "#d9483b");
    rect(ctx, 11, 2, 1, 2, "#a8302a");
    rect(ctx, 3, 0, 2, 1, "#5a6068");
    rect(ctx, 3, 5, 2, 1, "#5a6068");
  });
}

function muzzleFlash(): Texture {
  return make(10, 8, (ctx) => {
    ellipse(ctx, 3, 4, 3, 3, "#fff3c4");
    ellipse(ctx, 6, 4, 3.5, 2, "#ffc247");
    ellipse(ctx, 8, 4, 2, 1, "#ff8c2a");
  });
}

/** Paquete aéreo bajando: paracaídas a rayas, cuerdas y el cajón con una franja dorada. */
function airdrop(): Texture {
  return make(24, 34, (ctx) => {
    // Paracaídas: una cúpula con gajos alternados.
    ctx.fillStyle = "#1b1410";
    ctx.beginPath();
    ctx.ellipse(12, 9, 12, 9, 0, Math.PI, 0);
    ctx.fill();
    const stripes = ["#e64a3c", "#f4efe6", "#e64a3c", "#f4efe6", "#e64a3c"];
    stripes.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(12, 9);
      ctx.arc(12, 9, 10.5, Math.PI + (i / 5) * Math.PI, Math.PI + ((i + 1) / 5) * Math.PI);
      ctx.closePath();
      ctx.fill();
    });
    // Cuerdas hasta las esquinas del cajón.
    ctx.strokeStyle = "#3a3026";
    ctx.lineWidth = 1;
    for (const [fromX, toX] of [[2, 7], [9, 10], [15, 14], [22, 17]] as const) {
      ctx.beginPath();
      ctx.moveTo(fromX + 0.5, 9.5);
      ctx.lineTo(toX + 0.5, 22.5);
      ctx.stroke();
    }
    // Cajón.
    rect(ctx, 6, 22, 12, 11, "#8a5a2b");
    rect(ctx, 6, 22, 12, 2, "#a8743c");
    rect(ctx, 6, 26, 12, 3, "#ffc94a");
    outline(ctx, 5, 21, 14, 13);
  });
}

function shadowBlob(): Texture {
  return make(16, 8, (ctx) => {
    ellipse(ctx, 8, 4, 7, 3.5, "#00000040");
  });
}

// ------------------------------------------------------------------ pack

export interface TexturePack {
  grass: Texture;
  void: Texture;
  dirt: Texture;
  wallRing: Texture;
  crate: Texture[];
  wall: Texture;
  container: Texture;
  tree: Texture[];
  rock: Texture;
  barrel: Texture;
  burntBarrel: Texture;
  bush: Texture[];
  grassTuft: Texture;
  flower: Texture[];
  pebble: Texture;
  playerBody: Texture;
  playerShirt: Texture;
  gun: Texture;
  airdrop: Texture;
  bullet: Texture;
  muzzleFlash: Texture;
  shadow: Texture;
  itemWeapon: Texture[];
  itemBandage: Texture;
  itemMedkit: Texture;
  itemAdrenaline: Texture;
  itemArmor: Texture[];
  itemBorder: Texture;
  wallTile: Texture[];
  floor: Texture[];
  lootCrate: Texture[];
  goldenCrate: Texture[];
  districtGround: Texture[];
  water: Texture;
  silo: Texture;
  hayBale: Texture;
  fence: Texture;
  grenade: Texture;
  rocket: Texture;
  itemGrenade: Texture;
  smokeGrenade: Texture;
  itemSmoke: Texture;
  molotov: Texture;
  itemMolotov: Texture;
  smokePuff: Texture;
  pump: Texture;
  campfire: Texture;
  jumpPad: Texture;
  /** Por índice de gorro (el 0 queda vacío: es la gorra de la remera). */
  hats: Texture[];
}

let pack: TexturePack | null = null;

export function getTextures(): TexturePack {
  if (pack) return pack;
  pack = {
    grass: grassTexture(),
    void: voidTexture(),
    dirt: dirtTexture(),
    wallRing: wallRingTexture(),
    crate: [crate(0), crate(1), crate(2)],
    wall: wallBlock(),
    container: container(),
    tree: [tree(0), tree(1), tree(2)],
    rock: rock(),
    barrel: barrel(),
    burntBarrel: burntBarrel(),
    bush: [bush(0), bush(1), bush(2)],
    grassTuft: grassTuft(),
    flower: [flower(0), flower(1), flower(2)],
    pebble: pebble(),
    playerBody: playerBody(),
    playerShirt: playerShirt(),
    gun: gun(),
    airdrop: airdrop(),
    bullet: bullet(),
    muzzleFlash: muzzleFlash(),
    shadow: shadowBlob(),
    itemWeapon: WEAPON_IDS.map((_, i) => weaponIcon(i)),
    itemBandage: bandageIcon(),
    itemMedkit: medkitIcon(),
    itemAdrenaline: adrenalineIcon(),
    itemArmor: [armorIcon(0), armorIcon(1)],
    itemBorder: itemBorder(),
    wallTile: [wallTileTexture(0), wallTileTexture(1)],
    floor: [floorTexture(0), floorTexture(1)],
    // [cerrada, abierta]
    lootCrate: [lootCrate(false), lootCrate(true)],
    goldenCrate: [lootCrate(false, true), lootCrate(true, true)],
    districtGround: [0, 1, 2, 3].map(districtGround),
    water: waterTexture(),
    silo: silo(),
    hayBale: hayBale(),
    fence: fence(),
    grenade: grenade(),
    rocket: rocket(),
    itemGrenade: grenadeIcon(),
    smokeGrenade: smokeGrenade(),
    itemSmoke: smokeIcon(),
    molotov: molotov(),
    itemMolotov: molotovIcon(),
    smokePuff: smokePuff(),
    pump: pump(),
    campfire: campfireLogs(),
    jumpPad: jumpPad(),
    hats: Array.from({ length: HAT_COUNT }, (_, i) => hatTexture(i)),
  };
  return pack;
}

// ------------------------------------------------------------------ ítems

/**
 * Los objetos del suelo se dibujan sobre una placa oscura. Un icono suelto
 * sobre el pasto no se ve; la placa lo despega del fondo.
 *
 * El borde va en una textura aparte, blanca, que se tiñe con el color de la
 * rareza: así hay un icono por objeto en vez de uno por cada combinación de
 * objeto y rareza.
 */
function plate(draw: (ctx: Ctx) => void): Texture {
  return make(16, 16, (ctx) => {
    rect(ctx, 1, 1, 14, 14, "#171d24");
    draw(ctx);
  });
}

/** Marco blanco de 1 px, para teñir con el color de la rareza. */
function itemBorder(): Texture {
  return make(16, 16, (ctx) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(1.5, 1.5, 13, 13);
  });
}

/** Iconos de arma: se distinguen por silueta, que es lo que se lee a este tamaño. */
function drawWeapon(ctx: Ctx, index: number): void {
  const steel = "#c3c8ce";
  const wood = "#8a5f34";
  switch (index) {
    case 0: // pistola
      rect(ctx, 5, 6, 6, 2, steel);
      rect(ctx, 5, 8, 2, 3, wood);
      break;
    case 1: // subfusil
      rect(ctx, 4, 6, 8, 2, steel);
      rect(ctx, 6, 8, 2, 3, steel);
      rect(ctx, 4, 8, 1, 2, wood);
      break;
    case 2: // rifle
      rect(ctx, 3, 7, 10, 2, steel);
      rect(ctx, 3, 9, 3, 2, wood);
      rect(ctx, 7, 9, 2, 2, steel);
      break;
    case 3: // escopeta
      rect(ctx, 3, 7, 10, 3, steel);
      rect(ctx, 3, 10, 4, 2, wood);
      break;
    case 4: // francotirador
      rect(ctx, 2, 8, 12, 1, steel);
      rect(ctx, 6, 5, 5, 2, "#2f3a45"); // mira
      rect(ctx, 3, 9, 4, 2, wood);
      break;
    case 5: // ballesta: culata, arco atravesado, cuerda y la flecha cargada
      rect(ctx, 2, 8, 9, 2, wood);
      rect(ctx, 11, 3, 2, 11, "#5a3a1e");
      rect(ctx, 9, 4, 1, 9, "#e8e2d0");
      rect(ctx, 4, 7, 10, 1, steel);
      rect(ctx, 14, 6, 1, 3, steel);
      break;
    case 7: // revólver: tambor redondo y caño largo
      rect(ctx, 4, 6, 9, 2, steel);
      ellipse(ctx, 6, 8, 2, 2, "#8a929b");
      rect(ctx, 4, 9, 2, 3, wood);
      break;
    case 8: // ametralladora: caño largo, cajón de balas y bípode
      rect(ctx, 2, 6, 12, 2, steel);
      rect(ctx, 5, 8, 4, 3, "#4f5a3a");
      rect(ctx, 2, 8, 2, 2, wood);
      rect(ctx, 12, 8, 1, 3, steel);
      rect(ctx, 14, 8, 1, 3, steel);
      break;
    default: // lanzacohetes: el tubo verde con la punta del cohete asomando
      rect(ctx, 2, 6, 11, 4, "#4f6b3a");
      rect(ctx, 2, 6, 11, 1, "#6b8a50");
      rect(ctx, 13, 7, 2, 2, "#d9483b");
      rect(ctx, 5, 10, 2, 3, wood);
      rect(ctx, 8, 4, 2, 2, "#2f3a45");
      break;
  }
}

function weaponIcon(index: number): Texture {
  return plate((ctx) => drawWeapon(ctx, index));
}

function bandageIcon(): Texture {
  return plate((ctx) => {
    rect(ctx, 4, 6, 8, 4, "#e8eef5");
    rect(ctx, 4, 7, 8, 1, "#c4ccd6");
    rect(ctx, 6, 5, 4, 6, "#f4f7fa");
  });
}

function medkitIcon(): Texture {
  return plate((ctx) => {
    rect(ctx, 4, 5, 8, 6, "#f4f7fa");
    rect(ctx, 7, 6, 2, 4, "#d13b36");
    rect(ctx, 5, 7, 6, 2, "#d13b36");
  });
}

function adrenalineIcon(): Texture {
  return plate((ctx) => {
    rect(ctx, 5, 9, 5, 3, "#f4f7fa");
    rect(ctx, 6, 10, 3, 1, "#ffc94a");
    rect(ctx, 9, 5, 1, 5, "#c3c8ce"); // aguja
    rect(ctx, 4, 10, 1, 1, "#c3c8ce");
  });
}

function armorIcon(index: number): Texture {
  return plate((ctx) => {
    const body = index === 0 ? "#5f7f9a" : "#3f5d78";
    rect(ctx, 5, 5, 6, 7, body);
    rect(ctx, 4, 6, 1, 4, body);
    rect(ctx, 11, 6, 1, 4, body);
    rect(ctx, 7, 5, 2, 3, "#8fa8bd");
  });
}

// ------------------------------------------------- suelos de distrito

/**
 * Cada distrito pinta su propio suelo sobre el pasto. Es lo que más hace por
 * que el mapa se lea: de lejos, el asfalto ya te dice que ahí está la ciudad.
 */
export function districtGround(kind: number): Texture {
  return make(16, 16, (ctx) => {
    const rnd = makeRng(500 + kind * 37);
    if (kind === 0) {
      // Asfalto.
      rect(ctx, 0, 0, 16, 16, "#4b4e52");
      for (let i = 0; i < 40; i++) {
        rect(ctx, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, rnd() < 0.5 ? "#43464a" : "#55585d");
      }
      rect(ctx, 0, 7, 16, 1, "#3e4145");
    } else if (kind === 1) {
      // Tierra arada: los surcos son lo que la hace leer como campo sembrado.
      rect(ctx, 0, 0, 16, 16, "#7d5a34");
      for (let y = 1; y < 16; y += 4) {
        rect(ctx, 0, y, 16, 1, "#6a4a29");
        rect(ctx, 0, y + 1, 16, 1, "#8c6739");
      }
      for (let i = 0; i < 16; i++) {
        rect(ctx, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, "#95703f");
      }
    } else if (kind === 2) {
      // Gravilla.
      rect(ctx, 0, 0, 16, 16, "#6f6a62");
      for (let i = 0; i < 55; i++) {
        const c = rnd() < 0.4 ? "#807a71" : rnd() < 0.6 ? "#615d56" : "#8d867c";
        rect(ctx, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, c);
      }
    } else {
      // Tierra pisada.
      rect(ctx, 0, 0, 16, 16, "#93794d");
      for (let i = 0; i < 45; i++) {
        rect(ctx, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, rnd() < 0.5 ? "#856d45" : "#a08557");
      }
    }
  });
}

export function waterTexture(): Texture {
  return make(16, 16, (ctx) => {
    rect(ctx, 0, 0, 16, 16, "#2f6f9e");
    const rnd = makeRng(88);
    for (let i = 0; i < 26; i++) {
      rect(ctx, Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, "#3a80b2");
    }
    // Reflejos: dos rayas claras alcanzan para que se lea como agua.
    rect(ctx, 2, 4, 5, 1, "#6fb0d8");
    rect(ctx, 9, 11, 4, 1, "#6fb0d8");
  });
}

// --------------------------------------------------------- props nuevos

function silo(): Texture {
  return make(40, 50, (ctx) => {
    // Cuerpo cilíndrico con acanaladuras verticales.
    rect(ctx, 4, 12, 32, 34, "#c3c8cc");
    for (let x = 6; x < 36; x += 4) rect(ctx, x, 12, 1, 34, "#a9aeb3");
    rect(ctx, 4, 12, 32, 2, "#d8dde1");
    rect(ctx, 4, 44, 32, 2, "#8f949a");
    // Techo cónico.
    ellipse(ctx, 20, 12, 16, 8, "#9aa0a6");
    ellipse(ctx, 20, 10, 13, 6, "#b7bcc2");
    rect(ctx, 19, 2, 2, 6, "#8f949a");
    outline(ctx, 3, 4, 34, 45, "#4b4f54");
  });
}

function hayBale(): Texture {
  return make(30, 26, (ctx) => {
    ellipse(ctx, 15, 14, 14, 11, "#b8912f");
    ellipse(ctx, 15, 13, 12, 9, "#d4ac45");
    // Ataduras.
    rect(ctx, 8, 5, 1, 17, "#9c7a26");
    rect(ctx, 15, 3, 1, 21, "#9c7a26");
    rect(ctx, 22, 5, 1, 17, "#9c7a26");
    ellipse(ctx, 15, 11, 6, 4, "#e6c05c");
    outline(ctx, 1, 3, 28, 22, "#5f4a17");
  });
}

function fence(): Texture {
  return make(48, 18, (ctx) => {
    // Dos travesaños y tres postes: la silueta mínima que lee como alambrado.
    rect(ctx, 0, 5, 48, 2, "#8a6a3f");
    rect(ctx, 0, 11, 48, 2, "#8a6a3f");
    for (const x of [2, 23, 44]) {
      rect(ctx, x, 1, 3, 16, "#6f5330");
      rect(ctx, x, 1, 1, 16, "#8a6a3f");
    }
  });
}

// ------------------------------------------------------------- granadas

function grenade(): Texture {
  return make(10, 12, (ctx) => {
    ellipse(ctx, 5, 7, 4, 4.5, "#3f5a2f");
    ellipse(ctx, 4, 6, 2.5, 2.5, "#51733c");
    // Bandas cruzadas y espoleta: la silueta clásica, legible a este tamaño.
    rect(ctx, 1, 6, 8, 1, "#2c3f21");
    rect(ctx, 4, 3, 2, 3, "#8a8f95");
    rect(ctx, 6, 2, 2, 1, "#b9c0c8");
    outline(ctx, 0, 1, 10, 11, "#1a2412");
  });
}

function grenadeIcon(): Texture {
  return plate((ctx) => {
    ellipse(ctx, 8, 9, 4, 4.5, "#3f5a2f");
    ellipse(ctx, 7, 8, 2.5, 2.5, "#51733c");
    rect(ctx, 4, 8, 8, 1, "#2c3f21");
    rect(ctx, 7, 4, 2, 3, "#8a8f95");
    rect(ctx, 9, 3, 2, 1, "#b9c0c8");
  });
}

/** La molotov: una botella verde con el trapo prendido. */
function molotov(): Texture {
  return make(8, 14, (ctx) => {
    rect(ctx, 2, 6, 5, 7, "#3f7a4a");
    rect(ctx, 2, 6, 2, 7, "#5fa36b");
    rect(ctx, 3, 3, 3, 3, "#3f7a4a");
    rect(ctx, 3, 1, 3, 2, "#e8dcc0");
    rect(ctx, 4, 0, 2, 1, "#ff9a3c");
    outline(ctx, 1, 2, 7, 12, "#1a2412");
  });
}

function molotovIcon(): Texture {
  return plate((ctx) => {
    rect(ctx, 6, 7, 5, 6, "#3f7a4a");
    rect(ctx, 6, 7, 2, 6, "#5fa36b");
    rect(ctx, 7, 4, 3, 3, "#3f7a4a");
    rect(ctx, 7, 2, 3, 2, "#e8dcc0");
    rect(ctx, 8, 1, 2, 1, "#ff9a3c");
  });
}

/** La de humo: un tarro gris con banda blanca, para que no se confunda con la otra. */
function smokeGrenade(): Texture {
  return make(10, 12, (ctx) => {
    rect(ctx, 2, 3, 6, 8, "#6d747c");
    rect(ctx, 2, 3, 2, 8, "#8a929b");
    rect(ctx, 2, 6, 6, 2, "#e8ecef");
    rect(ctx, 3, 1, 4, 2, "#4a5057");
    rect(ctx, 6, 0, 2, 1, "#b9c0c8");
    outline(ctx, 1, 0, 8, 12, "#22262b");
  });
}

function smokeIcon(): Texture {
  return plate((ctx) => {
    rect(ctx, 5, 5, 6, 8, "#6d747c");
    rect(ctx, 5, 5, 2, 8, "#8a929b");
    rect(ctx, 5, 8, 6, 2, "#e8ecef");
    rect(ctx, 6, 3, 4, 2, "#4a5057");
    rect(ctx, 9, 2, 2, 1, "#b9c0c8");
  });
}

/**
 * Una bocanada de humo. La nube son varias de éstas superpuestas y moviéndose
 * apenas: una sola, por grande que sea, se lee como un círculo gris.
 */
function smokePuff(): Texture {
  return make(32, 32, (ctx) => {
    ellipse(ctx, 16, 17, 15, 14, "#9aa1a8");
    ellipse(ctx, 16, 15, 13, 12, "#b4bac0");
    ellipse(ctx, 13, 12, 8, 7, "#cdd2d6");
    ellipse(ctx, 11, 10, 3, 3, "#e1e4e7");
  });
}

/** El hongo saltarín: sombrero rojo con lunares, visto desde arriba. */
function jumpPad(): Texture {
  return make(20, 16, (ctx) => {
    ellipse(ctx, 10, 12, 5, 3, "#e8dcc0");
    ellipse(ctx, 10, 8, 9, 6, "#a8302a");
    ellipse(ctx, 10, 7, 8, 5, "#d9483b");
    ellipse(ctx, 7, 6, 1.5, 1.5, "#ffffff");
    ellipse(ctx, 13, 5, 1.5, 1.5, "#ffffff");
    ellipse(ctx, 11, 9, 1.2, 1.2, "#ffffff");
    ellipse(ctx, 5, 9, 1, 1, "#ffffff");
  });
}

/** Los troncos de la fogata, sin fuego: la llama se dibuja aparte y se mueve. */
function campfireLogs(): Texture {
  return make(24, 14, (ctx) => {
    ellipse(ctx, 12, 9, 11, 4.5, "#3a3f46");
    ellipse(ctx, 12, 9, 8, 3, "#2a2420");
    rect(ctx, 3, 7, 18, 3, "#6b4423");
    rect(ctx, 3, 7, 18, 1, "#8a5a30");
    rect(ctx, 8, 4, 3, 8, "#5a3a1e");
    rect(ctx, 14, 4, 3, 8, "#5a3a1e");
    rect(ctx, 6, 11, 2, 2, "#8a929b");
    rect(ctx, 17, 11, 2, 2, "#8a929b");
  });
}

/** Surtidor de nafta: la silueta que hace reconocible una gasolinera. */
function pump(): Texture {
  return make(18, 22, (ctx) => {
    rect(ctx, 3, 4, 12, 16, "#c2453c");
    rect(ctx, 3, 4, 12, 2, "#e05a4f");
    rect(ctx, 3, 18, 12, 2, "#8f2f28");
    // Visor y manguera.
    rect(ctx, 5, 7, 8, 5, "#2b3138");
    rect(ctx, 6, 8, 6, 2, "#7fd0e8");
    rect(ctx, 15, 10, 2, 7, "#3a3f46");
    rect(ctx, 14, 16, 3, 2, "#3a3f46");
    outline(ctx, 2, 3, 14, 18);
  });
}


// ------------------------------------------------- iconos para el HUD

/**
 * Los mismos dibujos, pero como data URL para el kill feed. El HUD es HTML y no
 * puede usar una textura de Pixi, así que se redibuja en un canvas aparte.
 * Se generan una sola vez y se cachean: son diez imágenes fijas.
 */
function iconUrl(w: number, h: number, draw: (ctx: Ctx) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return canvas.toDataURL();
}

let causeIcons: Map<number, string> | null = null;

/** Icono de con qué mataron a alguien: arma, granada o la zona. */
export function causeIconUrl(cause: number): string {
  if (!causeIcons) {
    causeIcons = new Map();
    for (let i = 0; i < WEAPON_IDS.length; i++) {
      causeIcons.set(i, iconUrl(16, 16, (ctx) => drawWeapon(ctx, i)));
    }
    // Granada / explosión.
    causeIcons.set(-2, iconUrl(16, 16, (ctx) => {
      ellipse(ctx, 8, 9, 4, 4.5, "#3f5a2f");
      ellipse(ctx, 7, 8, 2.5, 2.5, "#51733c");
      rect(ctx, 4, 8, 8, 1, "#2c3f21");
      rect(ctx, 7, 4, 2, 3, "#8a8f95");
    }));
    // Fuego: una llama.
    causeIcons.set(-4, iconUrl(16, 16, (ctx) => {
      ellipse(ctx, 8, 10, 4, 5, "#ff7a2a");
      ellipse(ctx, 8, 11, 2, 3, "#ffd257");
      rect(ctx, 7, 3, 2, 3, "#ff7a2a");
    }));
    // Bombardeo: una bomba con aletas.
    causeIcons.set(-3, iconUrl(16, 16, (ctx) => {
      ellipse(ctx, 8, 9, 3.5, 5, "#3a3f46");
      rect(ctx, 5, 2, 6, 2, "#5a6068");
      rect(ctx, 7, 4, 2, 1, "#5a6068");
      rect(ctx, 7, 13, 2, 2, "#ff6a4a");
    }));
    // Zona.
    causeIcons.set(-1, iconUrl(16, 16, (ctx) => {
      ctx.strokeStyle = "#6fd3ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(8, 8, 5, 0, Math.PI * 2);
      ctx.stroke();
    }));
  }
  return causeIcons.get(cause) ?? causeIcons.get(0)!;
}

const portraits = new Map<string, string>();

/**
 * El muñeco con la remera del color del jugador, para el podio. Es el mismo
 * dibujo que en el juego; la remera se multiplica por el color igual que hace
 * el tint de Pixi, así que se ve idéntico.
 */
export function playerPortraitUrl(color: number, hat = 0): string {
  const key = `${color}:${hat}`;
  const cached = portraits.get(key);
  if (cached) return cached;

  const canvas = (): [HTMLCanvasElement, Ctx] => {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 18;
    return [c, c.getContext("2d")!];
  };

  const [white, wctx] = canvas();
  drawPlayerShirt(wctx);

  const [tinted, tctx] = canvas();
  tctx.drawImage(white, 0, 0);
  tctx.globalCompositeOperation = "multiply";
  tctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  tctx.fillRect(0, 0, 16, 18);
  // El multiply pinta también lo transparente: se recorta a la forma de la
  // remera de una sola vez. Dibujando la forma de a partes, cada parte borraría
  // lo que dejó la anterior.
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(white, 0, 0);

  // 16x24, como los gorros: el muñeco 6 px más abajo para que entren los altos.
  const url = iconUrl(16, 24, (ctx) => {
    ctx.translate(0, 6);
    drawPlayerBody(ctx);
    ctx.drawImage(tinted, 0, 0);
    ctx.translate(0, -6);
    if (hat > 0) drawHat(ctx, hat);
  });
  portraits.set(key, url);
  return url;
}
