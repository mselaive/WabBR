import { generateRoomCode, normalizeRoomCode } from "@wabbr/shared";
import { Game } from "./game.js";
import { UI } from "./ui.js";

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
  onLeave: () => {
    game.disconnect();
    ui.showScreen("menu");
  },
});

game = new Game(ui);

await game.init();
ui.showScreen("menu");
