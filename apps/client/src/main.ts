import { generateRoomCode, normalizeRoomCode } from "@wabbr/shared";
import { Game } from "./game.js";
import { UI } from "./ui.js";
import { recordsLine } from "./records.js";

let game!: Game;

function enterRoom(code: string, name: string): void {
  // El código queda en la URL: recargar la página te devuelve a la misma sala
  // y el link es directamente la invitación.
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url);
  game.connect(code, name);
}

const ui = new UI({
  onCreate: (name) => enterRoom(generateRoomCode(), name),

  onJoin: (name, code) => {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      ui.showError("Ese código no existe. Son 6 caracteres, sin vocales.");
      return;
    }
    enterRoom(normalized, name);
  },

  onReady: (ready) => game.setReady(ready),
  onStart: () => game.requestStart(),
  onKick: (id) => game.kick(id),
  onAddBot: () => game.addBot(),
  onMode: (teamSize) => game.setMode(teamSize),
  onPartner: (id) => game.setPartner(id),
  onBotSkill: (skill) => game.setBotSkill(skill),
  onLeave: () => {
    game.disconnect();
    ui.showScreen("menu");
  },
});

game = new Game(ui);
// Tus números de siempre, guardados en este navegador.
ui.setMyStats(recordsLine());

/*
 * OJO: acá NO puede ir `await game.init()` en el nivel superior del módulo.
 *
 * Un `await` de nivel superior deja el módulo de entrada "evaluándose" hasta que
 * la promesa se resuelve, y en ESM cualquier módulo que dependa de él tiene que
 * esperar a que termine. En producción Rollup mete el núcleo de PixiJS dentro
 * del mismo chunk de entrada y deja el renderizador en un chunk aparte, así que
 * se arma un abrazo mortal: la entrada espera a `init()`, `init()` espera al
 * chunk del renderizador, y ese chunk espera a que la entrada termine de
 * evaluarse. La promesa no se resuelve nunca.
 *
 * El síntoma es feo de diagnosticar porque no hay error ni petición fallida: el
 * chunk se descarga con 200, y la página queda sin canvas y sin explicación. En
 * desarrollo no pasa, porque Vite sirve los módulos sin empaquetar.
 */
ui.setEntryEnabled(false);
game.init().then(
  () => {
    ui.setEntryEnabled(true);
    ui.showScreen("menu");
  },
  (err) => {
    console.error("No arrancó el juego:", err);
    ui.showError("No se pudo iniciar el juego. Probá recargar la página.");
  },
);
