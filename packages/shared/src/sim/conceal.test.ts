import { describe, expect, it } from "vitest";
import { bushAt, generateArena } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { BUSH_SHOT_REVEAL_TICKS, BUSH_SPOT_DISTANCE, concealedFrom } from "./sight.js";
import { createGameState, createPlayer, step } from "./step.js";
import { emptyInput, type GameState, type PlayerInput } from "./types.js";

const arena = generateArena();
const bush = arena.decor.find((d) => d.kind === "bush")!;
/** Un punto bien adentro del follaje de ese arbusto. */
const inside = { x: bush.x, y: bush.y - 14 * bush.scale };

/** Alguien parado en el arbusto y otro mirando desde `distance` px a la izquierda. */
function scene(distance: number): GameState {
  const state = createGameState(1);
  state.phase = "playing";
  const hider = createPlayer(1, inside.x, inside.y);
  const viewer = createPlayer(2, inside.x - distance, inside.y);
  // Un tercero lejos, para que la partida no termine.
  const other = createPlayer(3, 200, 1500);
  for (const p of [hider, viewer, other]) p.alive = true;
  state.players.push(hider, viewer, other);
  return state;
}

const idle = (state: GameState, extra: Map<number, PlayerInput[]> = new Map()): void => {
  const inputs = new Map<number, PlayerInput[]>(state.players.map((p) => [p.id, []]));
  for (const [id, list] of extra) inputs.set(id, list);
  step(state, inputs, [], arena);
};

describe("arbustos", () => {
  it("se sabe cuándo alguien está metido en uno", () => {
    expect(bushAt(arena, inside.x, inside.y)).toBe(true);
    // El centro de la ciudad es asfalto: ahí no hay arbustos.
    expect(bushAt(arena, 1500, 1500)).toBe(false);
  });

  it("de lejos no se ve al que está escondido; de muy cerca sí", () => {
    const far = scene(300);
    idle(far);
    expect(far.players[0]!.inBush).toBe(true);
    expect(concealedFrom(far, far.players[0]!, far.players[1]!.x, far.players[1]!.y)).toBe(true);

    const near = scene(BUSH_SPOT_DISTANCE - 20);
    idle(near);
    expect(concealedFrom(near, near.players[0]!, near.players[1]!.x, near.players[1]!.y)).toBe(false);
  });

  it("disparar te delata un rato", () => {
    const state = scene(300);
    // Tira para el otro lado: lo que importa es que tiró.
    idle(state, new Map([[1, [{ ...emptyInput(1), aim: Math.PI / 2, shoot: true }]]]));
    const viewer = state.players[1]!;
    expect(concealedFrom(state, state.players[0]!, viewer.x, viewer.y)).toBe(false);
    for (let t = 0; t < BUSH_SHOT_REVEAL_TICKS + 1; t++) idle(state);
    expect(concealedFrom(state, state.players[0]!, viewer.x, viewer.y)).toBe(true);
  });

  it("los bots tampoco ven al que está escondido", () => {
    const state = scene(300);
    idle(state);
    const mem = createBotMemory(1);
    for (let t = 0; t < 40; t++) {
      expect(botInput(state, state.players[1]!, mem, arena).shoot).toBe(false);
    }

    // Control: si el escondido se delata disparando, el mismo bot sí le tira.
    // Sin esto, el test pasaría también si algo le tapara la vista.
    state.players[0]!.lastShotTick = state.tick;
    const shots: boolean[] = [];
    for (let t = 0; t < 25; t++) shots.push(botInput(state, state.players[1]!, mem, arena).shoot);
    expect(shots.some(Boolean)).toBe(true);
  });
});
