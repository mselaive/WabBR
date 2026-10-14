import { describe, expect, it } from "vitest";
import { PLAYER_MAX_HP, RESPAWN_TICKS, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import type { ArenaMap } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { packResults, unpackResult } from "../protocol/codec.js";
import { applyExplosion, createGameState, createPlayer, step } from "./step.js";
import type { GameState, PlayerState, SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** `n` en pie, separados 500 px, con la segunda oportunidad prendida (o no). */
function match(n: number, secondChance = true): GameState {
  const state = createGameState(6);
  state.phase = "playing";
  state.secondChance = secondChance;
  for (let i = 0; i < n; i++) {
    const p = createPlayer(i + 1, WORLD_CENTER_X + i * 500 - 500, WORLD_CENTER_Y);
    p.alive = true;
    p.place = 0;
    state.players.push(p);
  }
  return state;
}

const tick = (state: GameState, events: SimEvent[] = []): SimEvent[] => {
  step(state, new Map(), events, EMPTY);
  return events;
};

/** Lo mata `byId` con una explosión justo encima (con 1 de vida, cualquier explosión mata). */
function kill(state: GameState, victim: PlayerState, byId: number): SimEvent[] {
  const events: SimEvent[] = [];
  victim.hp = 1;
  applyExplosion(state, victim.x, victim.y, byId, EMPTY, events);
  return events;
}

const wait = (state: GameState, ticks: number): SimEvent[] => {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) tick(state, events);
  return events;
};

describe("segunda oportunidad", () => {
  it("el que muere temprano vuelve una vez, con lo de arranque y sus kills", () => {
    const state = match(3);
    const victim = state.players[1]!;
    victim.kills = 2;
    victim.slots = [5, 6];
    const events = kill(state, victim, 1);

    expect(victim.alive).toBe(false);
    expect(events.find((e) => e.t === "kill")).toMatchObject({ targetId: 2, respawn: true });
    // Suelta lo que tenía, como cualquier muerto: matarlo sigue valiendo la pena.
    expect(state.items.some((i) => i.ref === 6)).toBe(true);
    expect(state.players[0]!.kills).toBe(1);

    const later = wait(state, RESPAWN_TICKS);
    expect(state.phase).toBe("playing");
    expect(victim.alive).toBe(true);
    expect(victim.place).toBe(0);
    expect(victim.hp).toBe(PLAYER_MAX_HP);
    expect(victim.slots).toEqual([0, -1]);
    expect(victim.kills).toBe(2);
    // El evento no dice dónde: le llega a todos.
    expect(later.find((e) => e.t === "respawn")).toEqual({ t: "respawn", id: 2 });
    // Adentro de la zona.
    const z = state.zone;
    expect(Math.hypot(victim.x - z.x, victim.y - z.y)).toBeLessThan(z.radius);
  });

  it("no vuelve antes de tiempo", () => {
    const state = match(3);
    kill(state, state.players[1]!, 1);
    wait(state, RESPAWN_TICKS - 2);
    expect(state.players[1]!.alive).toBe(false);
  });

  it("sólo una vez: la segunda muerte es la de verdad", () => {
    const state = match(3);
    const victim = state.players[1]!;
    kill(state, victim, 1);
    wait(state, RESPAWN_TICKS);
    expect(victim.alive).toBe(true);

    const events = kill(state, victim, 1);
    expect(events.find((e) => e.t === "kill")).not.toHaveProperty("respawn");
    wait(state, RESPAWN_TICKS + 5);
    expect(victim.alive).toBe(false);
    expect(victim.place).toBe(3);
  });

  it("cuando la zona ya empezó a cerrarse por segunda vez, no hay vuelta", () => {
    const state = match(3);
    state.zone.phase = 1;
    state.zone.shrinking = true;
    kill(state, state.players[1]!, 1);
    tick(state);
    expect(state.players[1]!.place).toBe(3);
    wait(state, RESPAWN_TICKS);
    expect(state.players[1]!.alive).toBe(false);
  });

  it("sin la opción, morir es morir", () => {
    const state = match(3, false);
    const events = kill(state, state.players[1]!, 1);
    expect(events.find((e) => e.t === "kill")).not.toHaveProperty("respawn");
    tick(state);
    expect(state.players[1]!.place).toBe(3);
  });

  it("con dos, la partida no termina mientras el otro espera para volver", () => {
    const state = match(2);
    kill(state, state.players[1]!, 1);
    wait(state, RESPAWN_TICKS - 2);
    expect(state.phase).toBe("playing");
    expect(state.players[1]!.place).toBe(0);
    wait(state, 2);
    expect(state.players.every((p) => p.alive)).toBe(true);
  });

  it("si se desconecta mientras espera, la pierde y queda afuera", () => {
    const state = match(2);
    kill(state, state.players[1]!, 1);
    state.players[1]!.connected = false;
    tick(state);
    expect(state.phase).toBe("ended");
    expect(state.winnerId).toBe(1);
    expect(state.players[1]!.place).toBe(2);
    // No volvió: no cuenta como vuelta (ni para el título de "Gato").
    expect(state.players[1]!.usedSecondChance).toBe(false);
  });

  it("vuelve lejos del que lo mató", () => {
    // Con distintas semillas: un lugar al azar caería cerca de vez en cuando.
    for (let seed = 1; seed <= 20; seed++) {
      const state = match(2);
      state.rng = seed;
      kill(state, state.players[1]!, 1);
      wait(state, RESPAWN_TICKS);
      const [killer, back] = state.players;
      expect(Math.hypot(back!.x - killer!.x, back!.y - killer!.y), `semilla ${seed}`).toBeGreaterThan(500);
    }
  });

  it("el resultado dice quién volvió, para el título", () => {
    const state = match(3);
    kill(state, state.players[1]!, 1);
    wait(state, RESPAWN_TICKS);
    // Más tarde, cuando ya no hay vuelta para nadie.
    state.zone.phase = 2;
    kill(state, state.players[1]!, 1);
    kill(state, state.players[2]!, 1);
    tick(state);
    expect(state.phase).toBe("ended");
    const rows = new Map(packResults(state).map(unpackResult).map((r) => [r.id, r]));
    expect(rows.get(2)?.cameBack).toBe(true);
    expect(rows.get(3)?.cameBack).toBe(false);
  });

  it("cuando quedan los dos últimos (contando al que espera volver), un aviso, una vez", () => {
    const state = match(4);
    state.startTeams = 4;
    kill(state, state.players[3]!, 1);
    state.players[3]!.respawnTick = -1; // Este no vuelve.
    const first = tick(state);
    expect(first.some((e) => e.t === "finalTwo")).toBe(false);
    // El 3 muere temprano y espera volver: siguen siendo tres en carrera.
    kill(state, state.players[2]!, 1);
    expect(tick(state).some((e) => e.t === "finalTwo")).toBe(false);
    state.zone.phase = 2;
    state.players[2]!.respawnTick = -1;
    expect(tick(state).some((e) => e.t === "finalTwo")).toBe(true);
    expect(tick(state).some((e) => e.t === "finalTwo")).toBe(false);
  });

  it("en un mano a mano no hay aviso de los dos últimos", () => {
    const state = match(2);
    state.startTeams = 2;
    expect(tick(state).some((e) => e.t === "finalTwo")).toBe(false);
  });
});
