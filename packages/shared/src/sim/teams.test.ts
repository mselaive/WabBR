import { describe, expect, it } from "vitest";
import {
  DOWNED_BLEED_TICKS,
  DOWNED_HP,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  REVIVE_HP,
  REVIVE_TICKS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
} from "../constants.js";
import { generateArena, type ArenaMap } from "../map/arena.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { applyExplosion, canThrow, createGameState, createPlayer, startMatch, step } from "./step.js";
import { ACT_PICKUP, ACT_USE_BASE, emptyInput, type GameState, type PlayerInput, type SimEvent } from "./types.js";

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

  it("tríos: equipos de tres que aparecen juntos, sin uno encima del otro", () => {
    const arena = generateArena();
    const state = createGameState(3);
    state.teamSize = 3;
    for (let i = 1; i <= 7; i++) state.players.push(createPlayer(i));
    startMatch(state, 4242, arena);

    const teams = new Map<number, typeof state.players>();
    for (const p of state.players) teams.set(p.team, [...(teams.get(p.team) ?? []), p]);
    // 7 jugadores: dos de tres y el que sobra, solo.
    expect([...teams.values()].map((t) => t.length).sort()).toEqual([1, 3, 3]);
    expect(state.startTeams).toBe(3);
    for (const team of teams.values()) {
      for (let a = 0; a < team.length; a++) {
        for (let b = a + 1; b < team.length; b++) {
          const d = Math.hypot(team[a]!.x - team[b]!.x, team[a]!.y - team[b]!.y);
          expect(d).toBeLessThan(100);
          expect(d).toBeGreaterThan(20);
        }
      }
    }
  });

  it("tríos con tres o menos: todos contra todos", () => {
    const state = createGameState(3);
    state.teamSize = 3;
    for (let i = 1; i <= 3; i++) state.players.push(createPlayer(i));
    startMatch(state, 4242, generateArena());
    expect(new Set(state.players.map((p) => p.team)).size).toBe(3);
  });

  it("las parejas elegidas en el lobby se respetan; las inválidas se ignoran", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createGameState(3);
      state.teamSize = 2;
      for (let i = 1; i <= 6; i++) state.players.push(createPlayer(i));
      // 1 con 4 vale; 2 consigo mismo, 9 que no está y 4 repetido, no.
      state.pairs = [[1, 4], [2, 2], [3, 9], [4, 5]];
      startMatch(state, seed);
      const team = (id: number) => state.players.find((p) => p.id === id)!.team;
      expect(team(1)).toBe(team(4));
      expect(team(5)).not.toBe(team(4));
      expect(new Set(state.players.map((p) => p.team)).size).toBe(3);
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

  it("con dos jugadores no hay parejas: serían compañeros y terminaría al empezar", () => {
    const state = createGameState(3);
    state.teamSize = 2;
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, 7);
    expect(state.players[0]!.team).not.toBe(state.players[1]!.team);
    step(state, new Map(), [], EMPTY);
    expect(state.phase).toBe("playing");
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

  describe("caído", () => {
    /** El 3 (rival) le pega al 2 hasta tirarlo; el 1 es su compañero, en pie. */
    function knock(state: GameState, events: SimEvent[] = []): void {
      const victim = state.players[1]!;
      victim.hp = 1;
      applyExplosion(state, victim.x, victim.y + 20, 3, EMPTY, events);
    }

    it("con el compañero en pie, a cero no muere: cae", () => {
      const state = line();
      const events: SimEvent[] = [];
      knock(state, events);
      const victim = state.players[1]!;
      expect(victim.alive).toBe(true);
      expect(victim.downed).toBe(true);
      expect(victim.hp).toBe(DOWNED_HP);
      expect(events.some((e) => e.t === "down" && e.targetId === 2 && e.byId === 3)).toBe(true);
      expect(events.some((e) => e.t === "kill")).toBe(false);
      expect(state.players[2]!.kills).toBe(0);
    });

    it("solo, o con el compañero ya caído, muere como siempre", () => {
      const state = line();
      state.players[0]!.alive = false;
      const events: SimEvent[] = [];
      knock(state, events);
      expect(state.players[1]!.alive).toBe(false);
      expect(events.some((e) => e.t === "kill")).toBe(true);
    });

    it("caído se arrastra despacio y no dispara", () => {
      const state = line();
      knock(state);
      const victim = state.players[1]!;
      const x0 = victim.y;
      const events: SimEvent[] = [];
      idle(state, new Map([[2, [{ ...emptyInput(1), moveY: 1, sprint: true, shoot: true, aim: Math.PI / 2 }]]]), events);
      expect(victim.y - x0).toBeLessThan(PLAYER_SPEED * 0.05 * 0.5);
      expect(events.some((e) => e.t === "shot")).toBe(false);
    });

    it("se desangra y la kill es del que lo tiró", () => {
      const state = line();
      knock(state);
      const events: SimEvent[] = [];
      for (let t = 0; t < DOWNED_BLEED_TICKS + 2; t++) idle(state, new Map(), events);
      expect(state.players[1]!.alive).toBe(false);
      expect(state.players[2]!.kills).toBe(1);
    });

    it("el compañero lo levanta quedándose quieto al lado; moverse lo corta", () => {
      const state = line();
      knock(state);
      const [mate, victim] = state.players;
      mate!.x = victim!.x - 30;
      const press = (seq: number) => new Map([[1, [{ ...emptyInput(seq), act: ACT_PICKUP }]]]);

      // Empieza y se mueve a la mitad: no lo levanta.
      idle(state, press(1));
      expect(mate!.reviving).toBe(2);
      for (let t = 0; t < 10; t++) idle(state);
      idle(state, new Map([[1, [{ ...emptyInput(2), moveX: 1 }]]]));
      expect(mate!.reviving).toBe(-1);
      for (let t = 0; t < REVIVE_TICKS; t++) idle(state);
      expect(victim!.downed).toBe(true);

      // Quieto todo el tiempo: sí.
      mate!.x = victim!.x - 30;
      const events: SimEvent[] = [];
      idle(state, press(3), events);
      for (let t = 0; t < REVIVE_TICKS + 1; t++) idle(state, new Map(), events);
      expect(victim!.downed).toBe(false);
      expect(victim!.hp).toBe(REVIVE_HP);
      expect(events.some((e) => e.t === "revive" && e.targetId === 2 && e.byId === 1)).toBe(true);
    });

    it("rematarlo es la kill del que remata", () => {
      const state = line();
      knock(state);
      applyExplosion(state, state.players[1]!.x, state.players[1]!.y + 20, 4, EMPTY, []);
      applyExplosion(state, state.players[1]!.x, state.players[1]!.y + 20, 4, EMPTY, []);
      expect(state.players[1]!.alive).toBe(false);
      expect(state.players[3]!.kills).toBe(1);
      expect(state.players[2]!.kills).toBe(0);
    });

    it("si cae el último en pie de la pareja, el caído también se termina", () => {
      const state = line();
      knock(state);
      state.players[0]!.hp = 1;
      applyExplosion(state, state.players[0]!.x, state.players[0]!.y + 20, 3, EMPTY, []);
      idle(state);
      expect(state.players[0]!.alive).toBe(false);
      expect(state.players[1]!.alive).toBe(false);
      expect(state.phase).toBe("ended");
      expect(state.players[2]!.place).toBe(1);
      expect(state.players[0]!.place).toBe(2);
    });

    it("levantar es sólo eso: curarse, recargar o la zona lo cortan; apretar E otra vez no reinicia", () => {
      const state = line();
      knock(state);
      const [mate, victim] = state.players;
      mate!.x = victim!.x - 30;
      mate!.consumables[1] = 1;
      mate!.hp = 50;
      idle(state, new Map([[1, [{ ...emptyInput(1), act: ACT_PICKUP }]]]));
      for (let t = 0; t < 20; t++) idle(state);
      const left = mate!.reviveTicks;
      idle(state, new Map([[1, [{ ...emptyInput(2), act: ACT_PICKUP }]]]));
      expect(mate!.reviveTicks).toBe(left - 1);

      idle(state, new Map([[1, [{ ...emptyInput(3), act: ACT_USE_BASE + 1 }]]]));
      expect(mate!.reviving).toBe(-1);

      idle(state, new Map([[1, [{ ...emptyInput(4), act: ACT_PICKUP }]]]));
      expect(mate!.reviving).toBe(2);
      expect(mate!.useCd).toBe(0);
      idle(state, new Map([[1, [{ ...emptyInput(5), reload: true }]]]));
      expect(mate!.reviving).toBe(-1);
    });

    it("caído no puede tirar granadas (tampoco en la predicción)", () => {
      const state = line();
      knock(state);
      const victim = state.players[1]!;
      victim.grenades = 2;
      victim.smokes = 1;
      expect(canThrow(victim)).toBe(false);
      expect(canThrow(victim, 1)).toBe(false);
    });

    it("el bot caído se queda quieto mientras lo levantan", () => {
      const state = line();
      knock(state);
      const [mate, victim] = state.players;
      mate!.x = victim!.x - 30;
      mate!.reviving = victim!.id;
      mate!.reviveTicks = 50;
      // Con un rival a la vista, igual no se arrastra.
      const input = botInput(state, victim!, createBotMemory(2), EMPTY);
      expect(input.moveX).toBe(0);
      expect(input.moveY).toBe(0);

      // Control: sin nadie levantándolo, se aleja del rival.
      mate!.reviving = -1;
      const away = botInput(state, victim!, createBotMemory(2), EMPTY);
      expect(away.moveX !== 0 || away.moveY !== 0).toBe(true);
    });

    it("desangrarse lejos no cuenta como tiro largo", () => {
      const state = line();
      knock(state);
      // Como si lo hubiera tirado con el rifle (la explosión no cuenta como tiro).
      state.players[1]!.downedCause = 2;
      const shooter = state.players[2]!;
      // El que lo tiró se va lejísimo mientras el otro se desangra.
      shooter.x += 3000;
      for (let t = 0; t < DOWNED_BLEED_TICKS + 2; t++) idle(state);
      expect(state.players[1]!.alive).toBe(false);
      expect(shooter.kills).toBe(1);
      expect(shooter.longestKill).toBe(0);
    });
  });
});
