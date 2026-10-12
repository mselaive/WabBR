import { describe, expect, it } from "vitest";
import { PLAYER_MAX_HP, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { generateArena, type ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { applyExplosion, createGameState, createPlayer, startMatch, step } from "./step.js";
import { emptyInput, type GameState, type PlayerInput, type SimEvent } from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/**
 * Tres en fila sobre el eje x: el 1 tira, el 2 (su compañero) está en el medio
 * y el 3 (rival) detrás. Un cuarto, compañero del 3, lejos.
 */
function line(): GameState {
  const state = createGameState(1);
  state.phase = "playing";
  state.teamSize = 2;
  const xs = [0, 120, 240, 0];
  const ys = [0, 0, 0, 900];
  for (let i = 0; i < 4; i++) {
    const p = createPlayer(i + 1, WORLD_CENTER_X + xs[i]!, WORLD_CENTER_Y + ys[i]!);
    p.alive = true;
    p.place = 0;
    p.team = i < 2 ? -1 : -2;
    state.players.push(p);
  }
  return state;
}

function idle(state: GameState, inputs: Map<number, PlayerInput[]> = new Map(), events: SimEvent[] = []): void {
  const all = new Map<number, PlayerInput[]>(state.players.map((p) => [p.id, []]));
  for (const [id, list] of inputs) all.set(id, list);
  step(state, all, events, EMPTY);
}

describe("dúos", () => {
  it("arma parejas que aparecen juntas, y cada pareja lejos de las otras", () => {
    const arena = generateArena();
    const state = createGameState(3);
    state.teamSize = 2;
    for (let i = 1; i <= 6; i++) state.players.push(createPlayer(i));
    startMatch(state, 4242, arena);

    const teams = new Map<number, typeof state.players>();
    for (const p of state.players) teams.set(p.team, [...(teams.get(p.team) ?? []), p]);
    expect(teams.size).toBe(3);
    const pairs = [...teams.values()];
    for (const pair of pairs) {
      expect(pair).toHaveLength(2);
      expect(Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.y - pair[1]!.y)).toBeLessThan(60);
    }
    // Las parejas, separadas entre sí como en el anillo de siempre.
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        const pa = pairs[a]![0]!;
        const pb = pairs[b]![0]!;
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(400);
      }
    }
  });

  it("con número impar, el que sobra juega solo", () => {
    const state = createGameState(3);
    state.teamSize = 2;
    for (let i = 1; i <= 5; i++) state.players.push(createPlayer(i));
    startMatch(state, 7);
    const sizes = new Map<number, number>();
    for (const p of state.players) sizes.set(p.team, (sizes.get(p.team) ?? 0) + 1);
    expect([...sizes.values()].sort()).toEqual([1, 2, 2]);
  });

  it("en todos contra todos, cada uno es su propio equipo", () => {
    const state = createGameState(3);
    for (let i = 1; i <= 4; i++) state.players.push(createPlayer(i));
    startMatch(state, 7);
    expect(new Set(state.players.map((p) => p.team)).size).toBe(4);
  });

  it("la bala atraviesa al compañero y le pega al rival de atrás", () => {
    const state = line();
    const [shooter, mate, rival] = state.players;
    const events: SimEvent[] = [];
    idle(state, new Map([[1, [{ ...emptyInput(1), aim: 0, shoot: true }]]]), events);
    for (let t = 0; t < 10; t++) idle(state, new Map(), events);

    expect(mate!.hp).toBe(PLAYER_MAX_HP);
    expect(rival!.hp).toBeLessThan(PLAYER_MAX_HP);
    expect(events.some((e) => e.t === "hit" && e.targetId === mate!.id)).toBe(false);
    void shooter;
  });

  it("la granada no lastima al compañero, sí al que la tiró y al rival", () => {
    const state = line();
    const [thrower, mate, rival] = state.players;
    // Entre los tres, al alcance de todos.
    applyExplosion(state, WORLD_CENTER_X + 120, WORLD_CENTER_Y + 30, thrower!.id, EMPTY, []);
    expect(mate!.hp).toBe(PLAYER_MAX_HP);
    expect(thrower!.hp).toBeLessThan(PLAYER_MAX_HP);
    expect(rival!.hp).toBeLessThan(PLAYER_MAX_HP);
  });

  it("termina cuando queda una pareja, y gana entera aunque uno haya caído", () => {
    const state = line();
    const [a, b, c, d] = state.players;
    b!.alive = false;
    idle(state);
    // El compañero sigue: la pareja todavía no tiene puesto.
    expect(state.phase).toBe("playing");
    expect(b!.place).toBe(0);
    expect(b!.diedAtTick).toBeGreaterThanOrEqual(0);

    c!.alive = false;
    d!.alive = false;
    idle(state);
    expect(state.phase).toBe("ended");
    expect(a!.place).toBe(1);
    expect(b!.place).toBe(1);
    expect(c!.place).toBe(2);
    expect(d!.place).toBe(2);
    expect([a!.id, b!.id]).toContain(state.winnerId);
  });

  it("los bots no le tiran al compañero", () => {
    const state = line();
    // Sólo el compañero a la vista.
    state.players[2]!.x = WORLD_CENTER_X - 2000;
    state.players[3]!.x = WORLD_CENTER_X - 2000;
    const mem = createBotMemory(1);
    for (let t = 0; t < 40; t++) expect(botInput(state, state.players[0]!, mem, EMPTY).shoot).toBe(false);

    // Control: el mismo bot, con el rival a la vista, sí tira.
    state.players[2]!.x = WORLD_CENTER_X + 240;
    const shots: boolean[] = [];
    for (let t = 0; t < 30; t++) shots.push(botInput(state, state.players[0]!, mem, EMPTY).shoot);
    expect(shots.some(Boolean)).toBe(true);
  });
});
