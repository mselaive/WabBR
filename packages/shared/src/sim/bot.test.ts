import { describe, expect, it } from "vitest";
import { PLAYER_MAX_HP, WORLD_CENTER_X, WORLD_CENTER_Y } from "../constants.js";
import { ITEM_WEAPON, WEAPON_IDS } from "../items.js";
import { generateArena, type ArenaMap, type ObstacleKind } from "../map/arena.js";
import { botInput, createBotMemory, wants, type BotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, startMatch, step } from "./step.js";
import { ACT_SMOKE, ACT_THROW, type GameState, type PlayerInput, type SimEvent } from "./types.js";

const arena = generateArena();

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

function arenaWith(kind: ObstacleKind, x: number, y: number, w: number, h: number): ArenaMap {
  const obstacles = [{ kind, x, y, w, h, variant: 0 }];
  return { ...EMPTY, obstacles, grid: new ObstacleGrid(obstacles) };
}

/** Un duelo armado a mano: el bot (id 1) y un blanco quieto (id 2). */
function duel(dx: number, dy: number): GameState {
  const state = createGameState(1);
  state.phase = "playing";
  const bot = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
  const target = createPlayer(2, WORLD_CENTER_X + dx, WORLD_CENTER_Y + dy);
  bot.alive = true;
  target.alive = true;
  state.players.push(bot, target);
  return state;
}

describe("bots", () => {
  it("una partida entre bots se juega entera: abren cajas, pelean y gana uno", () => {
    const state = createGameState(1);
    const memories = new Map<number, BotMemory>();
    for (let id = 1; id <= 6; id++) {
      state.players.push(createPlayer(id));
      memories.set(id, createBotMemory(id * 7919));
    }
    startMatch(state, 2024, arena);

    let kills = 0;
    for (let t = 0; t < 20 * 60 * 8 && state.phase === "playing"; t++) {
      const inputs = new Map<number, PlayerInput[]>();
      for (const p of state.players) {
        if (p.alive) inputs.set(p.id, [botInput(state, p, memories.get(p.id)!, arena)]);
      }
      const events: SimEvent[] = [];
      step(state, inputs, events, arena);
      kills += events.filter((e) => e.t === "kill" && e.byId >= 0).length;
    }

    expect(state.phase).toBe("ended");
    // Se matan entre ellos: no gana la zona sola.
    expect(kills).toBeGreaterThan(0);
    // Y lootean: si no, pelearían con la pistola de arranque toda la partida.
    expect(state.openedCrates.length).toBeGreaterThan(3);
  });

  it("tarda un instante en reaccionar y después le tira al que ve", () => {
    const state = duel(250, 0);
    const mem = createBotMemory(1);
    const shots: boolean[] = [];
    for (let t = 0; t < 30; t++) shots.push(botInput(state, state.players[0]!, mem, EMPTY).shoot);

    expect(shots[0]).toBe(false);
    expect(shots.slice(20).every(Boolean)).toBe(true);
    // Apunta para el lado del blanco, con un error chico.
    expect(Math.abs(botInput(state, state.players[0]!, mem, EMPTY).aim)).toBeLessThan(0.3);
  });

  it("no le tira al que está detrás de una pared", () => {
    const state = duel(250, 0);
    const wall = arenaWith("wall", WORLD_CENTER_X + 100, WORLD_CENTER_Y - 100, 30, 200);
    const mem = createBotMemory(1);
    for (let t = 0; t < 40; t++) {
      expect(botInput(state, state.players[0]!, mem, wall).shoot).toBe(false);
    }
  });

  describe("granadas", () => {
    /** Corre el duelo con el bot sin arma (así lo único que lastima es la granada). */
    function play(state: GameState, map: ArenaMap, ticks: number): { throws: number; blasts: SimEvent[] } {
      const bot = state.players[0]!;
      bot.slots = [-1, -1];
      bot.grenades = 2;
      const mem = createBotMemory(3);
      let throws = 0;
      const blasts: SimEvent[] = [];
      for (let t = 0; t < ticks; t++) {
        const input = botInput(state, bot, mem, map);
        if (input.act === ACT_THROW) throws++;
        const events: SimEvent[] = [];
        step(state, new Map([[1, [input]], [2, []]]), events, map);
        blasts.push(...events.filter((e) => e.t === "explosion"));
      }
      return { throws, blasts };
    }

    it("le tira una al que está a tiro y le pega", () => {
      const state = duel(310, 0);
      const { throws, blasts } = play(state, EMPTY, 70);
      expect(throws).toBe(1);
      expect(blasts).toHaveLength(1);
      expect(state.players[1]!.hp).toBeLessThan(PLAYER_MAX_HP);
      expect(state.players[0]!.hp).toBe(PLAYER_MAX_HP);
    });

    it("se escapa de una granada a punto de estallar", () => {
      // El otro lejos y del otro lado: lo único que lo mueve es la granada.
      const state = duel(-900, 0);
      state.grenades.push({ id: 1, ownerId: 2, kind: 0, x: WORLD_CENTER_X + 40, y: WORLD_CENTER_Y, vx: 0, vy: 0, fuse: 20 });
      const input = botInput(state, state.players[0]!, createBotMemory(1), EMPTY);
      expect(input.moveX).toBe(-1);
      expect(input.sprint).toBe(true);

      // Control: con mecha larga todavía no corre por ella.
      state.grenades[0]!.fuse = 39;
      expect(botInput(state, state.players[0]!, createBotMemory(1), EMPTY).sprint).toBe(false);
    });

    it("no le tira a un barril que tiene al lado", () => {
      const state = duel(250, 0);
      const barrel = arenaWith("barrel", WORLD_CENTER_X + 50, WORLD_CENTER_Y - 12, 24, 24);
      const mem = createBotMemory(1);
      for (let t = 0; t < 40; t++) expect(botInput(state, state.players[0]!, mem, barrel).shoot).toBe(false);
      // Control: si el barril ya estalló, sí tira.
      state.explodedBarrels.push(0);
      const shots: boolean[] = [];
      for (let t = 0; t < 10; t++) shots.push(botInput(state, state.players[0]!, mem, barrel).shoot);
      expect(shots.some(Boolean)).toBe(true);
    });

    it("con poca vida tira humo entre él y el otro; sano, no", () => {
      const smokesWith = (hp: number): number => {
        const state = duel(420, 0);
        const bot = state.players[0]!;
        bot.hp = hp;
        bot.smokes = 1;
        const mem = createBotMemory(5);
        let n = 0;
        for (let t = 0; t < 40; t++) if (botInput(state, bot, mem, EMPTY).act === ACT_SMOKE) n++;
        return n;
      };
      expect(smokesWith(30)).toBe(1);
      expect(smokesWith(100)).toBe(0);
    });

    it("de cerca no: la granada rodaría de largo", () => {
      const state = duel(140, 0);
      expect(play(state, EMPTY, 70).throws).toBe(0);
    });

    it("no la tira contra una caja que se la devolvería", () => {
      // Una caja baja: deja ver al otro pero frena la granada. Sin correr la
      // simulación, para que el bot no se corra de costado hasta pasarla (y
      // ahí el tiro sí sería bueno).
      const throwsWith = (map: ArenaMap): number => {
        const state = duel(310, 0);
        state.players[0]!.grenades = 2;
        const mem = createBotMemory(3);
        let throws = 0;
        for (let t = 0; t < 70; t++) if (botInput(state, state.players[0]!, mem, map).act === ACT_THROW) throws++;
        return throws;
      };
      expect(throwsWith(arenaWith("crate", WORLD_CENTER_X + 50, WORLD_CENTER_Y - 60, 30, 120))).toBe(0);
      // Control: la misma escena sin la caja, sí.
      expect(throwsWith(EMPTY)).toBe(1);
    });
  });

  it("afuera de la zona corre para adentro", () => {
    const state = duel(0, 900);
    // El otro, lejos y fuera de la vista, para que no haya pelea.
    state.players[1]!.x = WORLD_CENTER_X - 1200;
    state.zone.x = WORLD_CENTER_X + 600;
    state.zone.y = WORLD_CENTER_Y;
    state.zone.radius = 200;
    const input = botInput(state, state.players[0]!, createBotMemory(1), EMPTY);
    expect(input.moveX).toBe(1);
    expect(input.sprint).toBe(true);
  });

  it("cambia el arma en la mano sólo por una mejor", () => {
    // Con las dos ranuras llenas, recoger cambia la de la mano por la del piso.
    const me = createPlayer(1);
    me.slots = [WEAPON_IDS.indexOf("rifle"), WEAPON_IDS.indexOf("smg")];
    me.slotTier = [4, 2];
    me.activeSlot = 0;
    const pistol = { id: 9, kind: ITEM_WEAPON, ref: 0, tier: 0, x: 0, y: 0, count: 1 };
    expect(wants(me, pistol)).toBe(false);

    // Con la pistola en la mano, un rifle raro sí vale la pena.
    me.slots = [0, WEAPON_IDS.indexOf("smg")];
    me.slotTier = [0, 0];
    expect(wants(me, { ...pistol, ref: WEAPON_IDS.indexOf("rifle"), tier: 2 })).toBe(true);
  });

  it("con poca vida y un botiquín, sin nadie cerca, se cura quieto", () => {
    const state = duel(0, 0);
    state.players[1]!.x = WORLD_CENTER_X - 1200;
    const me = state.players[0]!;
    me.hp = PLAYER_MAX_HP * 0.4;
    me.consumables[1] = 1;
    const input = botInput(state, me, createBotMemory(1), EMPTY);
    expect(input.act).toBe(4 + 1);
    expect(input.moveX).toBe(0);
    expect(input.moveY).toBe(0);
  });
});
