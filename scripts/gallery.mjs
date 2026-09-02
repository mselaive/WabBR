/**
 * Arma la galería HTML a partir de las capturas de `.showcase`.
 *
 *   npm run dev                  # en otra terminal
 *   node scripts/showcase.mjs    # saca las fotos
 *   node scripts/gallery.mjs     # arma .showcase/galeria.html
 *
 * Las imágenes van embebidas en base64 porque el HTML termina publicado como
 * artifact y ahí no hay dónde alojar archivos sueltos. El encabezado y los
 * estilos viven aparte en `scripts/gallery/head.html`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(here, "../.showcase");
const OUT = resolve(SHOTS, "galeria.html");

const faltan = [];

/** La captura como data URI. Si no está, se anota y se sigue. */
function img(name, alt) {
  const file = resolve(SHOTS, `${name}.png`);
  if (!existsSync(file)) {
    faltan.push(name);
    return `<div style="padding:40px;text-align:center;color:#888">falta ${name}.png</div>`;
  }
  const b64 = readFileSync(file).toString("base64");
  return `<img src="data:image/png;base64,${b64}" alt="${alt}">`;
}

const fig = (name, alt) => `<figure>${img(name, alt)}</figure>`;

let n = 0;
const step = (titulo, texto, cuerpo) => `
  <section class="step">
    <div class="step-head"><span class="num">${String(++n).padStart(2, "0")}</span><h2>${titulo}</h2></div>
    <p class="caption">${texto}</p>
    ${cuerpo}
  </section>
`;

const body = `
<div class="wrap">

  <header>
    <div class="eyebrow">Así va</div>
    <h1 class="wordmark">Wab<em>BR</em></h1>
    <p class="lede">Una partida entera, capturada en orden: del menú al kill feed.</p>

    <dl class="facts">
      <div><dt>Arena</dt><dd>3000 px</dd></div>
      <div><dt>Lugares</dt><dd>11</dd></div>
      <div><dt>Cajas</dt><dd>45</dd></div>
      <div><dt>Armas</dt><dd>5 × 5</dd></div>
      <div><dt>Jugadores</dt><dd>16</dd></div>
      <div><dt>Tick</dt><dd>20/s</dd></div>
    </dl>
  </header>

  ${step(
    "Entrás y creás la sala",
    "Sin cuentas ni instalación. Ponés tu nombre y creás; el juego te da un código de seis caracteres.",
    fig("1-menu", "Menú principal de WabBR con el campo de nombre y los botones de crear y unirse"),
  )}

  ${step(
    "Compartís el link y esperan",
    "Tocás el código y se copia el link de invitación. Cuando están todos listos <b>arranca sola</b>, o el host la fuerza.",
    fig("2-lobby", "Sala de espera con el código de sala y los jugadores en la lista"),
  )}

  ${step(
    "Caés en el mapa",
    "El mapa está dividido en <b>lugares con nombre</b> —La Ciudad, La Granja, El Parque, El Depósito, El Campamento, Las Ruinas— más gasolineras, caseríos y chatarrerías repartidos en los huecos. El minimapa de arriba a la derecha los rotula todos.",
    fig("4-campo-abierto", "El personaje en campo abierto entre contenedores y árboles, con el muro de la arena a la derecha"),
  )}

  ${step(
    "Cada lugar está construido, no salpicado",
    "Las casas tienen paredes de verdad y dos puertas en lados distintos, con un pasillo libre alrededor para que los muebles nunca tapen una entrada. Adentro hay cajas; afuera, silos, fardos y alambrados según el barrio.",
    fig("17-pelea", "Un galpón de la granja visto desde arriba con cajas y barriles adentro, alambrados y un silo alrededor"),
  )}

  ${step(
    "Encontrás una caja y la abrís",
    "Te acercás y el HUD te dice qué tenés al lado. Al apretar <b>E</b> la caja se abre y escupe lo que tenía alrededor: siempre al menos un arma, más uno a tres objetos. Casi todas las armas del mapa están adentro de cajas, no tiradas por el piso.",
    `<div class="pair">
      <figure>
        ${img("5-caja-cerrada", "El personaje junto a una caja cerrada, con el cartel E Abrir caja en el HUD")}
        <figcaption>Antes — «E Abrir caja»</figcaption>
      </figure>
      <figure>
        ${img("6-caja-abierta", "La misma caja abierta con los objetos desparramados alrededor")}
        <figcaption>Después — lo que tenía adentro</figcaption>
      </figure>
    </div>

    <div class="legend">
      <h3>El borde dice la rareza</h3>
      <div class="tiers">
        <span class="tier"><span class="swatch" style="border-color:#b9c0c8"></span>Común</span>
        <span class="tier"><span class="swatch" style="border-color:#5cd97a"></span>Poco común</span>
        <span class="tier"><span class="swatch" style="border-color:#4aa3ff"></span>Rara</span>
        <span class="tier"><span class="swatch" style="border-color:#c07cff"></span>Épica</span>
        <span class="tier"><span class="swatch" style="border-color:#ffb03a"></span>Legendaria</span>
      </div>
    </div>`,
  )}

  ${step(
    "Te armás y salís corriendo",
    "Dos ranuras, así que hay que elegir. Abajo se ven <b>«1 Pistola» y «2 Subfusil»</b>: la del anillo dorado es la que tenés en la mano. La barra celeste sobre la vida es el escudo; la finita amarilla debajo, la <b>estamina</b>, que se gasta corriendo con Shift y se recupera sola al parar.",
    fig("11-corriendo", "El HUD con dos ranuras de arma ocupadas, la barra de escudo y la de estamina a medio gastar"),
  )}

  ${step(
    "Solo ves lo que está a la vista",
    "Las zonas oscuras son lo que <b>no</b> ves: las paredes y los contenedores tapan la visión, y el servidor directamente no te manda lo que hay detrás. No es un efecto de pantalla, es anti-wallhack. Los arbustos y los barriles frenan las balas pero te dejan ver.",
    fig("8-disparando", "La misma escena con cuñas oscuras detrás de cada pared y contenedor, marcando lo que el jugador no puede ver"),
  )}

  ${step(
    "Cuando alguien cae, te enterás",
    "El kill feed aparece bajo el minimapa: quién mató, con qué arma y a quién, cada nombre en su color. Si estás involucrado, la línea se resalta. La zona y las granadas tienen su propio icono.",
    `<div class="small">
      ${fig("16-killfeed-cerca", "Una línea del kill feed que dice Bot1, un icono de pistola, y Bot4, cada nombre en su color")}
      <div>
        <p class="caption" style="margin-left:0">Al recibir un tiro la pantalla se sacude y aparece una <b>flecha apuntando al origen</b> del daño — que es lo que te salva cuando el que dispara está escondido detrás de una pared y no lo ves.</p>
        <p class="caption" style="margin-left:0">Los golpes que pegás vos muestran el número de daño sobre el enemigo y una marca en la mira. Los de los demás no: con todos en pantalla no se lee nada.</p>
      </div>
    </div>`,
  )}

  ${step(
    "Con Tab ves cómo van todos",
    "Vivos arriba, muertos en gris, ordenados por kills. La tabla se arma con una lista aparte del snapshot: si usara la de posiciones, el que está detrás de una pared aparecería como muerto.",
    fig("9-tabla", "Tabla de posiciones superpuesta sobre el juego"),
  )}

  ${step(
    "El mapa entero, desde el minimapa",
    "",
    `<div class="small">
      ${fig("10-minimapa", "Minimapa circular con los lugares rotulados y la red de caminos que los une")}
      <div>
        <p class="caption" style="margin-left:0">Los caminos salen de la ciudad como rayos, se cierran en un anillo entre barrios vecinos y tiran ramales a los lugares chicos. El círculo celeste es la zona actual; el punteado, adónde se va a cerrar.</p>
        <p class="caption" style="margin-left:0">El mapa se genera con una semilla y <b>no viaja por la red</b>: el cliente y el servidor corren la misma función y llegan al mismo resultado.</p>
      </div>
    </div>`,
  )}

  <footer>
    <p>Capturas tomadas con <b>Playwright</b> sobre una partida real: el script camina hacia el centro del mapa, rodea cuando choca contra una pared, busca una caja usando el propio cartel del HUD como sensor y fotografía el antes y el después. Se regeneran con <b>node scripts/showcase.mjs</b> y esta página con <b>node scripts/gallery.mjs</b>.</p>
  </footer>

</div>
`;

const head = readFileSync(resolve(here, "gallery/head.html"), "utf8");
writeFileSync(OUT, `${head}\n${body}`);

const kb = Math.round(Buffer.byteLength(head + body) / 1024);
console.log(`galeria.html — ${kb} KB, ${n} secciones`);
if (faltan.length) console.log(`faltan capturas: ${faltan.join(", ")}`);
