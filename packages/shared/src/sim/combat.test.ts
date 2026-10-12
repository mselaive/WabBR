import { describe, expect, it } from "vitest";
import {
  DT,
  EXPLOSION_MAX_DAMAGE,
  EXPLOSION_MIN_DAMAGE,
  EXPLOSION_RADIUS,
  GRENADE_FUSE_TICKS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  SPRINT_MULT,
  STAMINA_MAX,
  STAMINA_REGEN_DELAY,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
} from "../constants.js";
import { WEAPON_IDS, weaponStats } from "../items.js";
import { packResults, unpackResult } from "../protocol/codec.js";
import { generateArena, type ArenaMap, type ObstacleKind } from "../map/arena.js";
import { ObstacleGrid } from "./collision.js";
import { createGameState, createPlayer, startMatch, step, stepPlayerMovement } from "./step.js";
import {
  ACT_THROW,
  CAUSE_EXPLOSION,
  CAUSE_ZONE,
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

function arenaWith(kind: ObstacleKind, x: number, y: number, w: number, h: number): ArenaMap {
  const obstacles = [{ kind, x, y, w, h, variant: 0 }];
  return { ...EMPTY, obstacles, grid: new ObstacleGrid(obstacles) };
}

const run = (input: Partial<PlayerInput>, seq: number): PlayerInput => ({
  ...emptyInput(seq),
  ...input,
});

describe("correr", () => {
  it("corriendo se avanza más rápido y se gasta estamina", () => {
    const p = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    stepPlayerMovement(p, run({ moveX: 1, sprint: true }, 1), EMPTY);

    const moved = p.x - WORLD_CENTER_X;
    expect(moved).toBeCloseTo(PLAYER_SPEED * SPRINT_MULT * DT, 5);
    expect(p.stamina).toBeLessThan(STAMINA_MAX);
  });

  it("quieto no se gasta estamina aunque tengas la tecla apretada", () => {
    // Si no, apoyarse en Shift mientras mirás el mapa te dejaría sin nada.
    const p = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    stepPlayerMovement(p, run({ sprint: true }, 1), EMPTY);
    expect(p.stamina).toBe(STAMINA_MAX);
  });

  it("sin estamina se vuelve a la velocidad normal", () => {
    const p = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    p.stamina = 0;
    stepPlayerMovement(p, run({ moveX: 1, sprint: true }, 1), EMPTY);
    expect(p.x - WORLD_CENTER_X).toBeCloseTo(PLAYER_SPEED * DT, 5);
  });

  it("la estamina se agota en unos segundos y se recupera tras una pausa", () => {
    const p = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);

    let ticks = 0;
    while (p.stamina > 0 && ticks < 400) {
      stepPlayerMovement(p, run({ moveX: 1, sprint: true }, ++ticks), EMPTY);
    }
    // Entre 2 y 6 segundos de sprint continuo: ni un sprint infinito ni inútil.
    expect(ticks / 20).toBeGreaterThan(2);
    expect(ticks / 20).toBeLessThan(6);

    // Quieto: primero la pausa, y recién después empieza a subir.
    stepPlayerMovement(p, run({}, ++ticks), EMPTY);
    expect(p.stamina).toBe(0);

    for (let i = 0; i < STAMINA_REGEN_DELAY + 2; i++) {
      stepPlayerMovement(p, run({}, ++ticks), EMPTY);
    }
    expect(p.stamina).toBeGreaterThan(0);
  });
});

describe("granadas", () => {
  function playing(arena: ArenaMap): GameState {
    const state = createGameState(5);
    state.phase = "playing";
    const a = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const b = createPlayer(2, WORLD_CENTER_X + 600, WORLD_CENTER_Y);
    a.alive = true;
    b.alive = true;
    a.grenades = 2;
    state.players.push(a, b);
    void arena;
    return state;
  }

  it("tirarla gasta una y pone una granada en el mundo", () => {
    const state = playing(EMPTY);
    const p = state.players[0]!;
    step(state, new Map([[p.id, run({ aim: 0, act: ACT_THROW }, 1)]]), [], EMPTY);

    expect(p.grenades).toBe(1);
    expect(state.grenades).toHaveLength(1);
    expect(state.grenades[0]!.ownerId).toBe(p.id);
  });

  it("sin granadas no pasa nada", () => {
    const state = playing(EMPTY);
    const p = state.players[0]!;
    p.grenades = 0;
    step(state, new Map([[p.id, run({ aim: 0, act: ACT_THROW }, 1)]]), [], EMPTY);
    expect(state.grenades).toHaveLength(0);
  });

  it("estalla al terminar la mecha y hace daño con caída por distancia", () => {
    const state = playing(EMPTY);
    const thrower = state.players[0]!;
    const victim = state.players[1]!;

    // La víctima, a media distancia del centro de la explosión.
    victim.x = WORLD_CENTER_X;
    victim.y = WORLD_CENTER_Y + EXPLOSION_RADIUS / 2;

    state.grenades.push({
      id: 1,
      ownerId: thrower.id,
      x: WORLD_CENTER_X,
      y: WORLD_CENTER_Y,
      vx: 0,
      vy: 0,
      fuse: 2,
    });

    const events: SimEvent[] = [];
    step(state, new Map(), events, EMPTY);
    expect(victim.hp).toBe(PLAYER_MAX_HP);

    step(state, new Map(), events, EMPTY);
    expect(events.some((e) => e.t === "explosion")).toBe(true);
    expect(state.grenades).toHaveLength(0);

    const taken = PLAYER_MAX_HP - victim.hp;
    expect(taken).toBeGreaterThan(EXPLOSION_MIN_DAMAGE);
    expect(taken).toBeLessThan(EXPLOSION_MAX_DAMAGE);
  });

  it("le pega también a quien la tiró", () => {
    // Es lo que hace que tirarla a los pies de alguien sea una decisión.
    const state = playing(EMPTY);
    const thrower = state.players[0]!;
    state.grenades.push({
      id: 1,
      ownerId: thrower.id,
      x: thrower.x + 20,
      y: thrower.y,
      vx: 0,
      vy: 0,
      fuse: 1,
    });

    step(state, new Map(), [], EMPTY);
    expect(thrower.hp).toBeLessThan(PLAYER_MAX_HP);
  });

  it("una pared frena la esquirla", () => {
    // Sin esto se podrían tirar granadas a través de las casas.
    const arena = arenaWith("buildingWall", WORLD_CENTER_X - 150, WORLD_CENTER_Y + 30, 300, 24);
    const state = playing(arena);
    const victim = state.players[1]!;
    victim.x = WORLD_CENTER_X;
    victim.y = WORLD_CENTER_Y + 80;

    state.grenades.push({
      id: 1,
      ownerId: 99,
      x: WORLD_CENTER_X,
      y: WORLD_CENTER_Y,
      vx: 0,
      vy: 0,
      fuse: 1,
    });

    step(state, new Map(), [], arena);
    expect(victim.hp).toBe(PLAYER_MAX_HP);
  });

  it("rebota contra las paredes en vez de atravesarlas", () => {
    const arena = arenaWith("buildingWall", WORLD_CENTER_X + 100, WORLD_CENTER_Y - 200, 24, 400);
    const state = playing(arena);

    state.grenades.push({
      id: 1,
      ownerId: 1,
      x: WORLD_CENTER_X,
      y: WORLD_CENTER_Y,
      vx: 400,
      vy: 0,
      fuse: GRENADE_FUSE_TICKS,
    });

    for (let i = 0; i < 12; i++) step(state, new Map(), [], arena);

    const g = state.grenades[0];
    expect(g, "la granada tendría que seguir viva").toBeDefined();
    // Quedó de este lado del muro, no lo cruzó.
    expect(g!.x).toBeLessThan(WORLD_CENTER_X + 100);
  });
});

describe("eventos de combate", () => {
  it("el impacto dice cuánto pegó y desde qué dirección vino", () => {
    // Sin la dirección, desde que hay línea de vista te disparan desde algo que
    // no ves y no tenés forma de saber para dónde mirar.
    const state = createGameState(9);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const target = createPlayer(2, WORLD_CENTER_X + 90, WORLD_CENTER_Y);
    shooter.alive = true;
    target.alive = true;
    state.players.push(shooter, target);

    const events: SimEvent[] = [];
    step(state, new Map([[shooter.id, run({ aim: 0, shoot: true }, 1)]]), events, EMPTY);
    for (let i = 0; i < 4; i++) step(state, new Map(), events, EMPTY);

    const hit = events.find((e) => e.t === "hit");
    expect(hit).toBeDefined();
    if (hit?.t !== "hit") throw new Error("no hubo impacto");

    expect(hit.amount).toBeGreaterThan(0);
    expect(hit.targetId).toBe(target.id);
    // Disparó hacia la derecha (aim 0), así que la bala viajaba hacia +x.
    expect(Math.cos(hit.dir)).toBeGreaterThan(0.9);
  });

  it("la muerte dice con qué te mataron", () => {
    const state = createGameState(9);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const target = createPlayer(2, WORLD_CENTER_X + 90, WORLD_CENTER_Y);
    shooter.alive = true;
    target.alive = true;
    target.hp = 5;
    // Rifle en la mano, para comprobar que el kill feed reciba ESA arma.
    shooter.slots = [2, -1];
    shooter.slotTier = [0, 0];
    shooter.slotAmmo = [30, 0];
    state.players.push(shooter, target);

    const events: SimEvent[] = [];
    step(state, new Map([[shooter.id, run({ aim: 0, shoot: true }, 1)]]), events, EMPTY);
    for (let i = 0; i < 4; i++) step(state, new Map(), events, EMPTY);

    const kill = events.find((e) => e.t === "kill");
    if (kill?.t !== "kill") throw new Error("no hubo muerte");
    expect(kill.cause).toBe(2);
    expect(kill.byId).toBe(shooter.id);
  });

  it("morir por granada y por zona se distinguen del arma", () => {
    const state = createGameState(9);
    state.phase = "playing";
    const a = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const b = createPlayer(2, WORLD_CENTER_X + 800, WORLD_CENTER_Y);
    // Un tercero sano y a salvo en el centro: sin él la partida termina en
    // cuanto muere el primero y la zona nunca llega a matar al segundo.
    const survivor = createPlayer(3, WORLD_CENTER_X, WORLD_CENTER_Y);
    a.alive = true;
    b.alive = true;
    survivor.alive = true;
    a.hp = 5;
    b.hp = 1;
    state.players.push(a, b, survivor);

    // La granada mata a `a`.
    state.grenades.push({
      id: 1,
      ownerId: 99,
      x: a.x,
      y: a.y,
      vx: 0,
      vy: 0,
      fuse: 1,
    });
    // Y la zona, ya cerrada en el centro, mata a `b`.
    state.zone.radius = 100;
    state.zone.ticksLeft = 10_000;

    // La zona hace 2 de daño por segundo, así que bajar 1 de vida lleva 10
    // ticks; con margen de sobra para que entren las dos muertes.
    const events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) step(state, new Map(), events, EMPTY);

    const kills = events.filter((e) => e.t === "kill");
    const causes = new Set(kills.map((k) => (k.t === "kill" ? k.cause : 0)));
    expect(causes.has(CAUSE_EXPLOSION), "faltó la muerte por granada").toBe(true);
    expect(causes.has(CAUSE_ZONE), "faltó la muerte por zona").toBe(true);
  });
});

describe("puestos", () => {
  /** Una partida con `n` jugadores recién arrancada. */
  function match(n: number): GameState {
    const state = createGameState(1);
    for (let id = 1; id <= n; id++) state.players.push(createPlayer(id));
    startMatch(state, 7);
    return state;
  }

  /** Un tick sin que nadie haga nada. */
  const tick = (state: GameState): void => {
    step(state, new Map(state.players.map((p) => [p.id, [] as PlayerInput[]])), []);
  };

  const places = (state: GameState): number[] => state.players.map((p) => p.place);

  it("el que cae queda detrás de los que siguen en pie, y el último gana", () => {
    const state = match(4);
    expect(places(state)).toEqual([0, 0, 0, 0]);

    // Da igual cómo cae: muerto o desconectado, el puesto sale igual.
    state.players[2]!.alive = false;
    tick(state);
    expect(places(state)).toEqual([0, 0, 4, 0]);

    state.players[0]!.alive = false;
    tick(state);
    state.players[3]!.alive = false;
    tick(state);

    expect(places(state)).toEqual([3, 1, 4, 2]);
    expect(state.phase).toBe("ended");
  });

  it("los que caen en el mismo tick empatan", () => {
    // Una granada o la zona pueden llevarse a dos a la vez: ninguno de los dos
    // aguantó más que el otro.
    const state = match(4);
    state.players[0]!.alive = false;
    state.players[1]!.alive = false;
    tick(state);
    expect(places(state)).toEqual([3, 3, 0, 0]);
  });

  it("si no queda nadie, los últimos en caer comparten el primer puesto", () => {
    const state = match(3);
    state.players[0]!.alive = false;
    tick(state);
    state.players[1]!.alive = false;
    state.players[2]!.alive = false;
    tick(state);
    expect(places(state)).toEqual([3, 1, 1]);
    expect(state.winnerId).toBe(-1);
  });

  it("el que entró a mirar con la partida empezada no tiene puesto", () => {
    const state = match(3);
    state.players.push(createPlayer(9));
    tick(state);
    expect(state.players[3]!.place).toBe(-1);
  });
});

describe("escopeta", () => {
  const SHOTGUN = WEAPON_IDS.indexOf("shotgun");

  /**
   * Cuánto daño hace la escopeta común contra alguien quieto a `distance` px,
   * apuntándole al centro, con `shots` disparos.
   */
  function blast(distance: number, shots: number): { damage: number; dead: boolean } {
    const state = createGameState(3);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const target = createPlayer(2, WORLD_CENTER_X + distance, WORLD_CENTER_Y);
    // Un tercero lejos, para que la partida no termine al morir el blanco.
    const other = createPlayer(3, WORLD_CENTER_X, WORLD_CENTER_Y + 900);
    for (const p of [shooter, target, other]) p.alive = true;
    shooter.slots[0] = SHOTGUN;
    shooter.slotAmmo[0] = weaponStats(SHOTGUN, 0).magSize;
    state.players.push(shooter, target, other);

    let fired = 0;
    for (let t = 1; t <= 60; t++) {
      const shoot = fired < shots;
      const events: SimEvent[] = [];
      step(state, new Map([[1, { ...emptyInput(t), aim: 0, shoot }]]), events, EMPTY);
      if (events.some((e) => e.t === "shot")) fired++;
    }
    return { damage: PLAYER_MAX_HP - Math.max(0, target.hp), dead: !target.alive };
  }

  it("de cerca mata en dos tiros", () => {
    // Es lo que la hace valer la pena: antes, a 90 px entraban la mitad de los
    // perdigones y hacían falta tres o cuatro.
    expect(blast(90, 1).dead).toBe(false);
    expect(blast(90, 2).dead).toBe(true);
  });

  it("el cono es cerrado: a 150 px todavía entra la mitad", () => {
    // Antes abría tanto que a esta distancia pegaban dos perdigones de ocho.
    expect(blast(150, 1).damage).toBeGreaterThanOrEqual(weaponStats(SHOTGUN, 0).damage * 4);
  });

  it("de lejos no compite con el rifle", () => {
    // A 300 px un rifle común pega 18 por bala, cuatro veces por segundo.
    expect(blast(300, 1).damage).toBeLessThan(30);
  });
});

describe("estadísticas de la partida", () => {
  function duel(): { state: GameState; shooter: ReturnType<typeof createPlayer>; target: ReturnType<typeof createPlayer> } {
    const state = createGameState(3);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const target = createPlayer(2, WORLD_CENTER_X + 90, WORLD_CENTER_Y);
    const other = createPlayer(3, WORLD_CENTER_X, WORLD_CENTER_Y + 900);
    for (const p of [shooter, target, other]) {
      p.alive = true;
      p.place = 0;
    }
    state.players.push(shooter, target, other);
    return { state, shooter, target };
  }

  it("cuenta disparos, aciertos y el daño que de verdad entró", () => {
    const { state, shooter, target } = duel();
    target.shield = 20;
    // Pistola: un tiro al blanco y otro al aire.
    step(state, new Map([[1, { ...emptyInput(1), aim: 0, shoot: true }]]), [], EMPTY);
    for (let t = 2; t < 7; t++) step(state, new Map([[1, { ...emptyInput(t), aim: 0 }]]), [], EMPTY);
    step(state, new Map([[1, { ...emptyInput(7), aim: Math.PI, shoot: true }]]), [], EMPTY);
    for (let t = 8; t < 40; t++) step(state, new Map([[1, emptyInput(t)]]), [], EMPTY);

    const pistol = weaponStats(0, 0).damage;
    expect(shooter.shotsFired).toBe(2);
    expect(shooter.shotsHit).toBe(1);
    // El escudo también cuenta: es daño que le hiciste.
    expect(shooter.damageDealt).toBe(pistol);
    expect(target.damageTaken).toBe(pistol);
    expect(target.hp + target.shield).toBe(PLAYER_MAX_HP + 20 - pistol);
  });

  it("no cuenta el daño que sobra: rematar con 64 a alguien con 10 suma 10", () => {
    const { state, shooter, target } = duel();
    shooter.slots[0] = WEAPON_IDS.indexOf("shotgun");
    shooter.slotAmmo[0] = 6;
    target.hp = 10;
    step(state, new Map([[1, { ...emptyInput(1), aim: 0, shoot: true }]]), [], EMPTY);
    for (let t = 2; t < 20; t++) step(state, new Map([[1, emptyInput(t)]]), [], EMPTY);

    expect(target.alive).toBe(false);
    expect(shooter.damageDealt).toBe(10);
    // Cada perdigón es un disparo: la puntería de la escopeta se mide igual.
    expect(shooter.shotsFired).toBe(8);
  });

  it("el resultado dice cuánto aguantó cada uno", () => {
    const { state, target } = duel();
    for (let t = 1; t <= 30; t++) step(state, new Map([[1, emptyInput(t)]]), [], EMPTY);
    // Se desconecta: no pasa por killPlayer, pero el tiempo vivo se corta igual.
    target.alive = false;
    for (let t = 31; t <= 60; t++) step(state, new Map([[1, emptyInput(t)]]), [], EMPTY);
    // Y se va el tercero: termina la partida con el primero de ganador.
    state.players[2]!.alive = false;
    step(state, new Map([[1, emptyInput(61)]]), [], EMPTY);
    expect(state.phase).toBe("ended");

    const rows = new Map(packResults(state).map(unpackResult).map((r) => [r.id, r]));
    expect(rows.get(2)!.survivedTicks).toBe(31);
    expect(rows.get(3)!.survivedTicks).toBe(61);
    expect(rows.get(1)!.survivedTicks).toBe(61);
  });

  it("una granada propia no suma daño hecho", () => {
    const { state, shooter } = duel();
    shooter.grenades = 1;
    step(state, new Map([[1, { ...emptyInput(1), act: ACT_THROW, aim: Math.PI / 2 }]]), [], EMPTY);
    for (let t = 2; t < 30; t++) step(state, new Map([[1, emptyInput(t)]]), [], EMPTY);
    // Pararse encima antes de que estalle.
    shooter.x = state.grenades[0]!.x;
    shooter.y = state.grenades[0]!.y;
    for (let t = 30; t < 80; t++) step(state, new Map([[1, emptyInput(t)]]), [], EMPTY);
    expect(shooter.damageTaken).toBeGreaterThan(0);
    expect(shooter.damageDealt).toBe(0);
  });
});
