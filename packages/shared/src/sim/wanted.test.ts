import { describe, expect, it } from "vitest";
import { PLAYER_MAX_HP, WANTED_REVEAL_TICKS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import type { ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { applyExplosion, createGameState, createPlayer, step } from "./step.js";
import type { GameState, SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** Cuatro en pie, lejos entre sí; el 1 con `kills` muertes encima. */
function match(kills: number): GameState {
  const state = createGameState(6);
  state.phase = "playing";
  for (let i = 0; i < 4; i++) {
    const p = createPlayer(i + 1, WORLD_CENTER_X + i * 500 - 750, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    state.players.push(p);
  }
  state.players[0]!.kills = kills;
  return state;
}

const tick = (state: GameState, events: SimEvent[] = []): SimEvent[] => {
  step(state, new Map(), events, EMPTY);
  return events;
};

describe("el más buscado", () => {
  it("con 4 kills y 2 de ventaja, pasa a ser el más buscado y se lo ve en el mapa", () => {
    const state = match(4);
    const events = tick(state);
    expect(events.some((e) => e.t === "wanted" && e.id === 1)).toBe(true);
    expect(state.wanted?.id).toBe(1);
    expect(state.wanted?.x).toBe(state.players[0]!.x);
  });

  it("si no domina de verdad, no hay: menos de 4, o menos de 2 de ventaja", () => {
    const few = match(3);
    tick(few);
    expect(few.wanted).toBeNull();

    const close = match(4);
    close.players[1]!.kills = 3;
    tick(close);
    expect(close.wanted).toBeNull();
  });

  it("la posición es una pista: se refresca cada tanto, no en cada tick", () => {
    const state = match(4);
    tick(state);
    const leader = state.players[0]!;
    const seenX = leader.x;
    leader.x += 300;
    for (let t = 0; t < WANTED_REVEAL_TICKS - 2; t++) tick(state);
    expect(state.wanted?.x).toBe(seenX);
    tick(state);
    tick(state);
    expect(state.wanted?.x).toBe(leader.x);
  });

  it("lo sigue siendo mientras vaya primero solo; si lo alcanzan, deja de serlo", () => {
    const state = match(4);
    tick(state);
    state.players[1]!.kills = 3;
    tick(state);
    expect(state.wanted?.id).toBe(1);
    state.players[1]!.kills = 4;
    tick(state);
    expect(state.wanted).toBeNull();
    state.players[1]!.kills = 6;
    const events = tick(state);
    expect(state.wanted?.id).toBe(2);
    expect(events.some((e) => e.t === "wanted" && e.id === 2)).toBe(true);
  });

  it("el que lo mata cobra la recompensa: vida llena", () => {
    const state = match(4);
    tick(state);
    const [leader, hunter] = state.players;
    hunter!.hp = 20;
    leader!.hp = 1;
    hunter!.x = leader!.x + 200;
    const events: SimEvent[] = [];
    applyExplosion(state, leader!.x, leader!.y + 10, hunter!.id, EMPTY, events);
    expect(leader!.alive).toBe(false);
    expect(hunter!.hp).toBe(PLAYER_MAX_HP);
    expect(events.some((e) => e.t === "bounty" && e.byId === 2 && e.targetId === 1)).toBe(true);
    expect(state.wanted).toBeNull();
  });

  it("los bots armados van a buscarlo; con la pistola de arranque, no", () => {
    const state = match(4);
    tick(state);
    const bot = state.players[3]!;
    // Lejos de todos los demás para que no haya pelea a la vista: sólo la pista.
    bot.x = state.players[0]!.x + 1000;
    bot.y = state.players[0]!.y + 600;
    state.players[1]!.y += 2000;
    state.players[2]!.y += 2000;
    bot.slots = [0, -1];
    const unarmed = botInput(state, bot, createBotMemory(4), EMPTY);
    bot.slots = [0, 2];
    const armed = botInput(state, bot, createBotMemory(4), EMPTY);
    // Armado va hacia la izquierda y arriba, donde se lo vio.
    expect(armed.moveX).toBe(-1);
    expect(armed.moveY).toBe(-1);
    expect(unarmed.moveX === -1 && unarmed.moveY === -1).toBe(false);
  });
});
