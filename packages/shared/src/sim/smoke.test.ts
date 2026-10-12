import { describe, expect, it } from "vitest";
import {
  GRENADE_FUSE_TICKS,
  PLAYER_MAX_HP,
  SMOKE_MAX_STACK,
  SMOKE_RADIUS,
  SMOKE_SPOT_DISTANCE,
  SMOKE_TICKS,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
} from "../constants.js";
import { ITEM_GRENADE, itemName } from "../items.js";
import type { ArenaMap } from "../map/arena.js";
import { packPlayer, unpackPlayer } from "../protocol/codec.js";
import { botInput, createBotMemory } from "./bot.js";
import { ObstacleGrid } from "./collision.js";
import { concealedFrom, smokeRadius } from "./sight.js";
import { createGameState, createPlayer, step } from "./step.js";
import {
  ACT_PICKUP,
  ACT_SMOKE,
  ACT_THROW,
  GRENADE_SMOKE,
  emptyInput,
  type GameState,
  type PlayerInput,
  type SimEvent,
} from "./types.js";

const EMPTY: ArenaMap = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

/** Dos jugadores a 400 px, uno a cada lado del centro, y un tercero lejos. */
function scene(): GameState {
  const state = createGameState(9);
  state.phase = "playing";
  const a = createPlayer(1, WORLD_CENTER_X - 200, WORLD_CENTER_Y);
  const b = createPlayer(2, WORLD_CENTER_X + 200, WORLD_CENTER_Y);
  const c = createPlayer(3, WORLD_CENTER_X, WORLD_CENTER_Y + 900);
  for (const p of [a, b, c]) p.alive = true;
  state.players.push(a, b, c);
  return state;
}

/** Una nube ya formada en el medio de los dos. */
function withSmoke(state: GameState, x = WORLD_CENTER_X, y = WORLD_CENTER_Y): void {
  state.smokes.push({ id: 99, x, y, ticksLeft: SMOKE_TICKS - 30 });
}

function idle(state: GameState, inputs: Map<number, PlayerInput[]> = new Map(), events: SimEvent[] = []): void {
  const all = new Map<number, PlayerInput[]>(state.players.map((p) => [p.id, []]));
  for (const [id, list] of inputs) all.set(id, list);
  step(state, all, events, EMPTY);
}

describe("granada de humo", () => {
  it("con H se tira la de humo, no la otra, y avisa cuál es", () => {
    const state = scene();
    const p = state.players[0]!;
    p.grenades = 1;
    p.smokes = 2;
    const events: SimEvent[] = [];
    idle(state, new Map([[p.id, [{ ...emptyInput(1), aim: 0, act: ACT_SMOKE }]]]), events);

    expect(p.smokes).toBe(1);
    expect(p.grenades).toBe(1);
    expect(state.grenades[0]!.kind).toBe(GRENADE_SMOKE);
    const thrown = events.find((e) => e.t === "throw");
    expect(thrown?.t === "throw" && thrown.kind).toBe(GRENADE_SMOKE);
  });

  it("sin humo, H no tira nada (tampoco una granada común)", () => {
    const state = scene();
    const p = state.players[0]!;
    p.grenades = 1;
    idle(state, new Map([[p.id, [{ ...emptyInput(1), aim: 0, act: ACT_SMOKE }]]]));
    expect(state.grenades).toHaveLength(0);
    expect(p.grenades).toBe(1);
  });

  it("al terminar la mecha suelta una nube y no lastima a nadie", () => {
    const state = scene();
    const p = state.players[0]!;
    p.smokes = 1;
    const events: SimEvent[] = [];
    // Tirada para abajo, donde no hay nadie: lo que importa es que no estalla.
    idle(state, new Map([[p.id, [{ ...emptyInput(1), aim: Math.PI / 2, act: ACT_SMOKE }]]]), events);
    for (let t = 0; t < GRENADE_FUSE_TICKS + 2; t++) idle(state, new Map(), events);

    expect(state.grenades).toHaveLength(0);
    expect(state.smokes).toHaveLength(1);
    expect(events.some((e) => e.t === "smoke")).toBe(true);
    expect(events.some((e) => e.t === "explosion")).toBe(false);
    expect(p.hp).toBe(PLAYER_MAX_HP);
  });

  it("tapa la vista a través de la nube; sin nube, se ven", () => {
    const state = scene();
    const [a, b] = state.players;
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(false);

    withSmoke(state);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(true);
    expect(concealedFrom(state, a!, b!.x, b!.y)).toBe(true);
  });

  it("el que está adentro no ve afuera, ni lo ven; muy cerca, sí", () => {
    const state = scene();
    const [a, b] = state.players;
    // La nube encima de b, lejos del segmento hasta a sólo por b.
    withSmoke(state, b!.x, b!.y);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(true);
    expect(concealedFrom(state, a!, b!.x, b!.y)).toBe(true);

    a!.x = b!.x - (SMOKE_SPOT_DISTANCE - 10);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(false);
  });

  it("una nube al costado no tapa", () => {
    const state = scene();
    const [a, b] = state.players;
    withSmoke(state, WORLD_CENTER_X, WORLD_CENTER_Y + SMOKE_RADIUS + 40);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(false);
  });

  it("crece de a poco, se disipa y desaparece", () => {
    const state = scene();
    const [a, b] = state.players;
    state.smokes.push({ id: 7, x: WORLD_CENTER_X, y: WORLD_CENTER_Y, ticksLeft: SMOKE_TICKS });
    expect(smokeRadius(state.smokes[0]!)).toBe(0);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(false);

    for (let t = 0; t < 30; t++) idle(state);
    expect(smokeRadius(state.smokes[0]!)).toBe(SMOKE_RADIUS);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(true);

    for (let t = 0; t < SMOKE_TICKS; t++) idle(state);
    expect(state.smokes).toHaveLength(0);
    expect(concealedFrom(state, b!, a!.x, a!.y)).toBe(false);
  });

  it("se junta del piso, hasta el tope, y se suelta al morir", () => {
    const state = scene();
    const p = state.players[0]!;
    state.items.push({ id: 1, kind: ITEM_GRENADE, ref: GRENADE_SMOKE, tier: 1, x: p.x, y: p.y, count: 2 });
    state.nextItemId = 2;
    expect(itemName(state.items[0]!)).toBe("Humo x2");
    idle(state, new Map([[p.id, [{ ...emptyInput(1), act: ACT_PICKUP }]]]));
    expect(p.smokes).toBe(SMOKE_MAX_STACK);
    expect(p.grenades).toBe(0);

    const events: SimEvent[] = [];
    p.hp = 1;
    // La zona lo termina: lo que importa es qué suelta.
    state.zone.radius = 10;
    state.zone.ticksLeft = 10_000;
    for (let t = 0; t < 40 && p.alive; t++) idle(state, new Map(), events);
    expect(p.alive).toBe(false);
    const dropped = state.items.find((i) => i.kind === ITEM_GRENADE && i.ref === GRENADE_SMOKE);
    expect(dropped?.count).toBe(SMOKE_MAX_STACK);
  });

  it("viaja en el snapshot, sin correr los relojes del arma del propio", () => {
    const p = createPlayer(1);
    p.smokes = 2;
    p.grenades = 1;
    p.fireCd = 5;
    p.reloadCd = 7;
    const own = unpackPlayer(packPlayer(p, true));
    expect(own.smokes).toBe(2);
    expect(own.grenades).toBe(1);
    expect(own.fireCd).toBe(5);
    expect(own.reloadCd).toBe(7);
  });

  it("los bots no tiran a través del humo", () => {
    const state = scene();
    const [a, b] = state.players;
    withSmoke(state);
    const mem = createBotMemory(1);
    for (let t = 0; t < 40; t++) {
      expect(botInput(state, a!, mem, EMPTY).shoot).toBe(false);
    }

    // Control: sin el humo, el mismo bot sí le tira. Sin esto el test pasaría
    // también si el bot no viera a b por otra razón.
    state.smokes = [];
    const shots: boolean[] = [];
    for (let t = 0; t < 25; t++) shots.push(botInput(state, a!, mem, EMPTY).shoot);
    expect(shots.some(Boolean)).toBe(true);
    void b;
  });

  it("ACT_THROW sigue tirando la común", () => {
    const state = scene();
    const p = state.players[0]!;
    p.grenades = 1;
    p.smokes = 1;
    idle(state, new Map([[p.id, [{ ...emptyInput(1), aim: 0, act: ACT_THROW }]]]));
    expect(state.grenades[0]!.kind).toBe(0);
    expect(p.smokes).toBe(1);
  });
});
