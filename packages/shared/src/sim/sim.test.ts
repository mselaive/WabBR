import { describe, expect, it } from "vitest";
import {
  DT,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  WORLD_RADIUS,
  ZONE_PHASES,
  AIRDROP_FALL_TICKS,
} from "../constants.js";
import {
  buildingInterior,
  distToPaths,
  districtAt,
  generateArena,
  lootCrates,
  spawnPoint,
  type ArenaMap,
} from "../map/arena.js";
import {
  CONSUMABLES,
  ITEM_CONSUMABLE,
  ITEM_WEAPON,
  WEAPONS,
  weaponAt,
  weaponStats,
} from "../items.js";
import { ObstacleGrid, circleHitsBox, insideArena } from "./collision.js";
import { rollCrateContents } from "../map/loot.js";
import { createGameState, createPlayer, startMatch, step, stepPlayerMovement } from "./step.js";
import type { PlayerState } from "./types.js";
import {
  ACT_NONE,
  ACT_PICKUP,
  ACT_SLOT_0,
  ACT_USE_BASE,
  emptyInput,
  type GameState,
  type PlayerInput,
  type SimEvent,
} from "./types.js";

const arena = generateArena();
/** Arena sin obstáculos: el grid también tiene que quedar vacío, no sólo la lista. */
const EMPTY_ARENA = {
  obstacles: [],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([]),
};

function scriptedInput(tick: number, seq: number): PlayerInput {
  // Un recorrido variado: garantiza que se ejerciten choques, disparos y giros.
  return {
    seq,
    moveX: [0, 1, 1, 0, -1, -1][tick % 6]!,
    moveY: [1, 1, 0, -1, -1, 0][tick % 6]!,
    aim: (tick % 64) * 0.1,
    shoot: tick % 5 === 0,
    reload: tick % 97 === 0,
    // Corre a ratos: mete la estamina dentro del test de determinismo.
    sprint: tick % 13 < 6,
    // Disparando con lo que veía unos ticks antes: mete el rebobinado de la
    // compensación de lag dentro del test de determinismo.
    view: tick - 3.4,
    // Recoger cada tanto: mete el inventario dentro del test de determinismo.
    act: tick % 11 === 0 ? ACT_PICKUP : ACT_NONE,
  };
}

function runMatch(ticks: number): GameState {
  const state = createGameState(12345);
  state.players.push(createPlayer(1), createPlayer(2));
  startMatch(state, 999);

  for (let t = 0; t < ticks; t++) {
    const inputs = new Map<number, PlayerInput>([
      [1, scriptedInput(t, t + 1)],
      [2, scriptedInput(t + 3, t + 1)],
    ]);
    const events: SimEvent[] = [];
    step(state, inputs, events, arena);
  }
  return state;
}

describe("determinismo", () => {
  it("dos corridas con los mismos inputs dan exactamente el mismo estado", () => {
    // Es la propiedad que sostiene toda la predicción del cliente: si esto
    // falla, cliente y servidor divergen y el juego tironea.
    const a = runMatch(300);
    const b = runMatch(300);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("el PRNG no depende de Math.random", () => {
    const original = Math.random;
    Math.random = () => 0.5;
    const a = runMatch(120);
    Math.random = () => 0.9;
    const b = runMatch(120);
    Math.random = original;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("movimiento y colisión", () => {
  it("la velocidad diagonal es la misma que la recta", () => {
    const straight = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const diagonal = createPlayer(2, WORLD_CENTER_X, WORLD_CENTER_Y);

    stepPlayerMovement(straight, { ...emptyInput(1), moveX: 1 }, EMPTY_ARENA);
    stepPlayerMovement(
      diagonal,
      { ...emptyInput(1), moveX: 1, moveY: 1 },
      EMPTY_ARENA,
    );

    const dStraight = Math.hypot(straight.x - WORLD_CENTER_X, straight.y - WORLD_CENTER_Y);
    const dDiagonal = Math.hypot(diagonal.x - WORLD_CENTER_X, diagonal.y - WORLD_CENTER_Y);
    expect(dDiagonal).toBeCloseTo(dStraight, 6);
    expect(dStraight).toBeCloseTo(PLAYER_SPEED * DT, 6);
  });

  it("no se puede caminar dentro de un obstáculo", () => {
    const box = arena.obstacles[0]!;
    // Arrancar a la izquierda de la caja y empujar hacia ella durante un segundo.
    const p = createPlayer(1, box.x - PLAYER_RADIUS - 40, box.y + box.h / 2);
    for (let i = 0; i < 20; i++) {
      stepPlayerMovement(p, { ...emptyInput(i + 1), moveX: 1 }, arena);
    }
    for (const o of arena.obstacles) {
      expect(circleHitsBox(p.x, p.y, PLAYER_RADIUS - 0.01, o)).toBe(false);
    }
  });

  it("el muro circular contiene al jugador", () => {
    const p = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    for (let i = 0; i < 300; i++) {
      stepPlayerMovement(p, { ...emptyInput(i + 1), moveX: 1 }, arena);
    }
    const d = Math.hypot(p.x - WORLD_CENTER_X, p.y - WORLD_CENTER_Y);
    expect(d).toBeLessThanOrEqual(WORLD_RADIUS - PLAYER_RADIUS + 0.001);
  });
});

describe("balas", () => {
  it("una bala impacta y hace daño aunque el blanco esté a más de un tick de distancia", () => {
    const state = createGameState(7);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    // 80 px: más de lo que la bala recorre en un tick (32 px). Sin test de
    // segmento la atravesaría sin tocarla.
    const target = createPlayer(2, WORLD_CENTER_X + 80, WORLD_CENTER_Y);
    shooter.alive = true;
    target.alive = true;
    state.players.push(shooter, target);

    const events: SimEvent[] = [];
    const shoot = new Map<number, PlayerInput>([
      [1, { ...emptyInput(1), aim: 0, shoot: true }],
      [2, emptyInput(1)],
    ]);
    step(state, shoot, events, EMPTY_ARENA);

    for (let i = 0; i < 4; i++) {
      step(
        state,
        new Map<number, PlayerInput>([
          [1, { ...emptyInput(i + 2), aim: 0 }],
          [2, emptyInput(i + 2)],
        ]),
        events,
        EMPTY_ARENA,
      );
    }

    // Se arranca con pistola, así que el daño es el de la pistola.
    expect(target.hp).toBe(PLAYER_MAX_HP - WEAPONS.pistol.damage);
    expect(events.some((e) => e.t === "hit")).toBe(true);
  });

  it("una bala no daña a quien la disparó", () => {
    const state = createGameState(7);
    state.phase = "playing";
    const shooter = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    shooter.alive = true;
    state.players.push(shooter);

    for (let i = 0; i < 10; i++) {
      step(
        state,
        new Map([[1, { ...emptyInput(i + 1), aim: 0, shoot: true }]]),
        [],
        EMPTY_ARENA,
      );
    }
    expect(shooter.hp).toBe(PLAYER_MAX_HP);
  });
});

describe("zona", () => {
  it("hace daño fuera del círculo y termina matando", () => {
    const state = createGameState(3);
    state.phase = "playing";
    const inside = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const outside = createPlayer(2, WORLD_CENTER_X, WORLD_CENTER_Y);
    inside.alive = true;
    outside.alive = true;
    state.players.push(inside, outside);
    // Zona ya cerrada alrededor del centro, con el jugador 2 bien afuera.
    state.zone.radius = 100;
    state.zone.ticksLeft = 10_000;
    outside.x = WORLD_CENTER_X + 400;

    const dps = ZONE_PHASES[0]!.dps;
    const ticksToKill = Math.ceil(PLAYER_MAX_HP / (dps * DT));

    // A mitad de camino todavía está vivo pero perdiendo vida.
    for (let i = 0; i < Math.floor(ticksToKill / 2); i++) {
      step(state, new Map(), [], EMPTY_ARENA);
    }
    expect(outside.alive).toBe(true);
    expect(outside.hp).toBeLessThan(PLAYER_MAX_HP * 0.6);

    // Un par de ticks de margen: la resta repetida en punto flotante no cae
    // exactamente en cero en el tick que dice la división.
    for (let i = 0; i < ticksToKill / 2 + 5; i++) {
      step(state, new Map(), [], EMPTY_ARENA);
    }

    expect(inside.hp).toBe(PLAYER_MAX_HP);
    expect(outside.alive).toBe(false);
  });
});

describe("fin de partida", () => {
  it("gana el último con vida", () => {
    const state = createGameState(5);
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, 42);
    state.players[1]!.alive = false;

    step(state, new Map(), [], arena);

    expect(state.phase).toBe("ended");
    expect(state.winnerId).toBe(1);
  });
});

describe("inventario", () => {
  function playing(): GameState {
    const state = createGameState(11);
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, 4242, arena);
    return state;
  }

  it("la partida reparte loot y arranca con la pistola", () => {
    const state = playing();
    expect(state.items.length).toBeGreaterThan(40);
    expect(state.players[0]!.slots).toEqual([0, -1]);
    expect(state.players[0]!.slotAmmo[0]).toBe(WEAPONS.pistol.magSize);
  });

  it("ningún objeto cae adentro de un obstáculo", () => {
    // Si cayera dentro de una caja sería imposible llegar a recogerlo.
    const state = playing();
    for (const item of state.items) {
      for (const o of arena.obstacles) {
        expect(circleHitsBox(item.x, item.y, PLAYER_RADIUS, o)).toBe(false);
      }
    }
  });

  it("recoger un arma la pone en la ranura vacía", () => {
    const state = playing();
    const p = state.players[0]!;
    // Un rifle justo a los pies del jugador.
    state.items = [{ id: 900, kind: ITEM_WEAPON, ref: 2, tier: 0, x: p.x, y: p.y, count: 1 }];

    step(state, new Map([[p.id, { ...emptyInput(1), act: ACT_PICKUP }]]), [], arena);

    expect(p.slots).toEqual([0, 2]);
    expect(p.activeSlot).toBe(1);
    expect(state.items).toHaveLength(0);
  });

  it("con las dos ranuras llenas, el arma que llevabas queda en el piso", () => {
    const state = playing();
    const p = state.players[0]!;
    p.slots = [0, 1];
    p.slotTier = [0, 0];
    p.slotAmmo = [12, 25];
    p.activeSlot = 1;
    state.items = [{ id: 901, kind: ITEM_WEAPON, ref: 4, tier: 0, x: p.x, y: p.y, count: 1 }];

    step(state, new Map([[p.id, { ...emptyInput(1), act: ACT_PICKUP }]]), [], arena);

    expect(p.slots).toEqual([0, 4]);
    // El subfusil que tenía en la mano quedó tirado donde estaba.
    expect(state.items.some((i) => i.kind === ITEM_WEAPON && i.ref === 1)).toBe(true);
  });

  it("el escudo se gasta antes que la vida", () => {
    const state = playing();
    const [shooter, target] = state.players as [PlayerState, PlayerState];
    target.shield = 50;
    target.x = shooter.x + 60;
    target.y = shooter.y;
    shooter.aim = 0;

    step(
      state,
      new Map([
        [shooter.id, { ...emptyInput(1), aim: 0, shoot: true }],
        [target.id, emptyInput(1)],
      ]),
      [],
      EMPTY_ARENA,
    );
    for (let i = 0; i < 4; i++) step(state, new Map(), [], EMPTY_ARENA);

    expect(target.hp).toBe(PLAYER_MAX_HP);
    expect(target.shield).toBe(50 - WEAPONS.pistol.damage);
  });

  it("curarse pide quedarse quieto y se corta si te mueven o te pegan", () => {
    const state = playing();
    const p = state.players[0]!;
    p.hp = 40;
    p.consumables[0] = 2;

    // Empieza a vendarse.
    step(state, new Map([[p.id, { ...emptyInput(1), act: ACT_USE_BASE }]]), [], EMPTY_ARENA);
    expect(p.useCd).toBeGreaterThan(0);

    // Un paso y se cancela: no se curó y no gastó la venda.
    step(state, new Map([[p.id, { ...emptyInput(2), moveX: 1 }]]), [], EMPTY_ARENA);
    expect(p.useCd).toBe(0);
    expect(p.hp).toBe(40);
    expect(p.consumables[0]).toBe(2);

    // Ahora quieto hasta el final.
    step(state, new Map([[p.id, { ...emptyInput(3), act: ACT_USE_BASE }]]), [], EMPTY_ARENA);
    for (let i = 0; i < CONSUMABLES.bandage.useTicks + 2; i++) {
      step(state, new Map([[p.id, emptyInput(4 + i)]]), [], EMPTY_ARENA);
    }

    expect(p.hp).toBe(65);
    expect(p.consumables[0]).toBe(1);
  });

  it("al morir se suelta lo que llevabas", () => {
    const state = playing();
    const victim = state.players[1]!;
    victim.slots = [0, 2];
    victim.slotTier = [0, 0];
    victim.consumables[0] = 3;
    state.items = [];

    killPlayerForTest(state, victim);

    expect(state.items.filter((i) => i.kind === ITEM_WEAPON)).toHaveLength(2);
    const bandages = state.items.find((i) => i.kind === ITEM_CONSUMABLE && i.ref === 0);
    expect(bandages?.count).toBe(3);
  });
});

/** Mata al jugador por daño, que es el camino que suelta el inventario. */
function killPlayerForTest(state: GameState, victim: PlayerState): void {
  victim.hp = 1;
  victim.shield = 0;
  const shooter = state.players.find((p) => p.id !== victim.id)!;
  shooter.x = victim.x - 60;
  shooter.y = victim.y;
  shooter.slots = [2, -1];
  shooter.slotTier = [0, 0];
  shooter.slotAmmo = [30, 0];
  shooter.fireCd = 0;
  step(
    state,
    new Map([[shooter.id, { ...emptyInput(1), aim: 0, shoot: true }]]),
    [],
    EMPTY_ARENA,
  );
  for (let i = 0; i < 5; i++) step(state, new Map(), [], EMPTY_ARENA);
}

describe("rarezas", () => {
  it("subir de rareza mejora el arma sin cambiar su carácter", () => {
    const comun = weaponStats(2, 0);
    const legendaria = weaponStats(2, 4);

    expect(legendaria.damage).toBeGreaterThan(comun.damage);
    expect(legendaria.magSize).toBeGreaterThan(comun.magSize);
    // Menor es mejor en estas dos.
    expect(legendaria.reloadTicks).toBeLessThan(comun.reloadTicks);
    expect(legendaria.spread).toBeLessThan(comun.spread);
    // La cadencia y el alcance no se tocan: un rifle legendario sigue siendo un rifle.
    expect(legendaria.fireCd).toBe(comun.fireCd);
    expect(legendaria.lifeTicks).toBe(comun.lifeTicks);
  });

  it("ningún arma puede matar de un tiro a alguien con la vida llena", () => {
    // Es la razón por la que el francotirador tope en épica. Si alguien sube un
    // multiplicador sin pensarlo, este test se lo avisa.
    for (let weapon = 0; weapon < 5; weapon++) {
      const top = weaponStats(weapon, weaponAt(weapon).maxTier);
      // En la escopeta el disparo entero son todos los perdigones juntos, que es
      // el caso peor: a bocajarro entran todos.
      const perShot = top.damage * top.pellets;
      expect(perShot, `${top.name} en su rareza máxima`).toBeLessThan(PLAYER_MAX_HP);
    }
  });

  it("la rareza se respeta al recoger, al guardar y al soltar", () => {
    const state = createGameState(11);
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, 4242, arena);
    const p = state.players[0]!;

    // Un rifle legendario a los pies.
    state.items = [{ id: 950, kind: ITEM_WEAPON, ref: 2, tier: 4, x: p.x, y: p.y, count: 1 }];
    step(state, new Map([[p.id, { ...emptyInput(1), act: ACT_PICKUP }]]), [], arena);

    expect(p.slots[1]).toBe(2);
    expect(p.slotTier[1]).toBe(4);
    // Y el cargador es el grande, no el del rifle común.
    expect(p.slotAmmo[1]).toBe(weaponStats(2, 4).magSize);

    // Vuelvo a la pistola: la rareza del rifle tiene que seguir guardada.
    step(state, new Map([[p.id, { ...emptyInput(2), act: ACT_SLOT_0 }]]), [], arena);
    expect(p.slotTier[1]).toBe(4);
  });

  it("las cajas reparten rarezas variadas y ninguna pasa del techo del arma", () => {
    // Se mide sobre el contenido de las cajas, que es de donde salen casi todas
    // las armas: en el suelo quedan tan pocas que la muestra no diría nada.
    let rng = 12345;
    const weapons: { ref: number; tier: number }[] = [];

    for (let i = 0; i < 200; i++) {
      const rolled = rollCrateContents(rng);
      rng = rolled.state;
      for (const item of rolled.items) {
        if (item.kind === ITEM_WEAPON) weapons.push({ ref: item.ref, tier: item.tier });
      }
    }

    expect(weapons.length).toBeGreaterThan(200);
    for (const w of weapons) {
      expect(w.tier).toBeLessThanOrEqual(weaponAt(w.ref).maxTier);
      expect(w.tier).toBeGreaterThanOrEqual(0);
    }

    // Las cinco rarezas tienen que aparecer: si el sorteo estuviera roto o el
    // techo mal puesto, faltaría alguna.
    expect(new Set(weapons.map((w) => w.tier)).size).toBe(5);
    // Y el francotirador nunca puede salir legendario.
    const snipers = weapons.filter((w) => w.ref === 4);
    expect(snipers.length).toBeGreaterThan(0);
    expect(Math.max(...snipers.map((w) => w.tier))).toBeLessThanOrEqual(3);
  });
});

describe("mapa", () => {
  /**
   * Rejilla de celdas caminables. Es la base del test de alcanzabilidad: sin
   * esto no hay forma de saber si una casa quedó sellada, porque a ojo el
   * layout se ve bien igual.
   */
  // 10 px y no 20: con celdas gruesas una puerta angosta puede quedarse sin
  // ningún centro de celda válido y el test da un falso negativo, aunque un
  // jugador de verdad pase sin problema.
  function walkableGrid(map: ArenaMap, cell = 10) {
    const min = WORLD_CENTER_X - WORLD_RADIUS;
    const n = Math.ceil((WORLD_RADIUS * 2) / cell);
    const walkable = new Uint8Array(n * n);
    const near: number[] = [];

    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const x = min + gx * cell + cell / 2;
        const y = min + gy * cell + cell / 2;
        if (!insideArena(x, y, PLAYER_RADIUS)) continue;

        map.grid.query(x, y, PLAYER_RADIUS, near);
        let blocked = false;
        for (const i of near) {
          if (circleHitsBox(x, y, PLAYER_RADIUS, map.obstacles[i]!)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) walkable[gy * n + gx] = 1;
      }
    }
    return { walkable, n, cell, min };
  }

  /** Inundación desde el punto de aparición: marca todo lo que se puede pisar. */
  function reachableFrom(
    grid: ReturnType<typeof walkableGrid>,
    startX: number,
    startY: number,
  ): Uint8Array {
    const { walkable, n, cell, min } = grid;
    const seen = new Uint8Array(n * n);
    const gx0 = Math.floor((startX - min) / cell);
    const gy0 = Math.floor((startY - min) / cell);

    const queue: number[] = [gy0 * n + gx0];
    seen[gy0 * n + gx0] = 1;

    while (queue.length > 0) {
      const at = queue.pop()!;
      const gx = at % n;
      const gy = Math.floor(at / n);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const idx = ny * n + nx;
        if (seen[idx] || !walkable[idx]) continue;
        seen[idx] = 1;
        queue.push(idx);
      }
    }
    return seen;
  }

  it("cada distrito genera lo suyo", () => {
    // Un distrito vacío se ve como campo abierto y el nombre del minimapa
    // miente. Este test cazó tres generadores que no producían NADA: las
    // cadenas de muros y vallas se colocan tocándose, y con un pad mayor que
    // cero el segundo tramo siempre chocaba contra el primero.
    // Seis distritos grandes más los puntos menores que hayan entrado.
    const majors = arena.districts.filter((d) => !d.minor);
    expect(majors).toHaveLength(6);
    expect(arena.districts.length).toBeGreaterThan(10);
    expect(arena.buildings.length).toBeGreaterThanOrEqual(6);
    expect(arena.ponds.length).toBeGreaterThan(0);

    const kinds = new Set(arena.obstacles.map((o) => o.kind));
    for (const kind of ["silo", "hayBale", "fence", "wall", "container", "lootCrate"] as const) {
      expect(kinds.has(kind), `falta el obstáculo ${kind}`).toBe(true);
    }

    for (const d of arena.districts) {
      const inside = arena.obstacles.filter(
        (o) => Math.hypot(o.x - d.x, o.y - d.y) < d.radius,
      ).length;
      expect(inside, d.name).toBeGreaterThan(d.minor ? 4 : 12);
    }
  });

  it("se puede entrar a todas las casas", () => {
    // El test que de verdad importa del generador: una casa sin puerta, o con
    // la puerta tapada por una caja, se ve perfecta en pantalla y arruina la
    // partida del que va hasta ahí.
    const grid = walkableGrid(arena);
    const spawn = spawnPoint(0, 8, 4242, arena);
    const reached = reachableFrom(grid, spawn.x, spawn.y);

    for (const b of arena.buildings) {
      const inside = buildingInterior(b);
      let anyReachable = false;

      for (let y = inside.y + 10; y < inside.y + inside.h - 10 && !anyReachable; y += grid.cell) {
        for (let x = inside.x + 10; x < inside.x + inside.w - 10; x += grid.cell) {
          const gx = Math.floor((x - grid.min) / grid.cell);
          const gy = Math.floor((y - grid.min) / grid.cell);
          if (reached[gy * grid.n + gx]) {
            anyReachable = true;
            break;
          }
        }
      }

      expect(anyReachable, `casa en ${Math.round(b.x)},${Math.round(b.y)}`).toBe(true);
    }
  });

  it("el punto de aparición de cada jugador es pisable", () => {
    for (let i = 0; i < 16; i++) {
      const sp = spawnPoint(i, 16, 4242, arena);
      for (const o of arena.obstacles) {
        expect(circleHitsBox(sp.x, sp.y, PLAYER_RADIUS, o)).toBe(false);
      }
    }
  });

  it("los caminos quedan despejados de árboles y rocas", () => {
    // Sólo se mide el relleno del campo abierto, que es lo único que se coloca
    // DESPUÉS de trazar las rutas y por lo tanto puede esquivarlas. Adentro de
    // un distrito la ruta pasa entre las cosas a propósito, y las paredes de una
    // casa la tocan porque el camino va justamente hasta la puerta.
    const relleno = new Set(["tree", "rock", "crate", "barrel", "lootCrate"]);
    for (const o of arena.obstacles) {
      if (!relleno.has(o.kind)) continue;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      if (districtAt(arena, cx, cy)) continue;
      expect(distToPaths(cx, cy, arena.paths)).toBeGreaterThan(0);
    }
  });

  it("el loot se reparte adentro de las casas", () => {
    const state = createGameState(9);
    state.players.push(createPlayer(1));
    startMatch(state, 777, arena);

    const insideCount = state.items.filter((item) =>
      arena.buildings.some((b) => {
        const inner = buildingInterior(b);
        return (
          item.x > inner.x && item.x < inner.x + inner.w &&
          item.y > inner.y && item.y < inner.y + inner.h
        );
      }),
    ).length;

    // No hace falta un número exacto: alcanza con que las casas sean el destino.
    expect(insideCount).toBeGreaterThan(8);
  });
});

describe("cajas de botín", () => {
  function matchWithCrates(): { state: GameState; player: PlayerState } {
    const state = createGameState(31);
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, 8080, arena);
    return { state, player: state.players[0]! };
  }

  /**
   * Deja al jugador pegado a la caja y aprieta la tecla de acción. Vacía el
   * loot del piso primero: la misma tecla abre cajas y levanta objetos, así que
   * con algo tirado al lado el test mediría la prioridad y no la apertura.
   */
  function openNearest(state: GameState, player: PlayerState, crateIndex: number, seq: number) {
    const crate = lootCrates(arena)[crateIndex]!;
    player.x = crate.x + crate.w / 2;
    player.y = crate.y + crate.h / 2 + 40;
    state.items = [];
    return step2(state, player, seq);
  }

  /** Aprieta la tecla de acción un tick y devuelve los eventos. */
  function step2(state: GameState, player: PlayerState, seq: number): SimEvent[] {
    const events: SimEvent[] = [];
    step(state, new Map([[player.id, { ...emptyInput(seq), act: ACT_PICKUP }]]), events, arena);
    return events;
  }

  it("el mapa tiene cajas y casi todas caen en algún distrito", () => {
    const crates = lootCrates(arena);
    expect(crates.length).toBeGreaterThanOrEqual(20);

    // Lo que importa no es que estén bajo techo sino que estén EN UN LUGAR: si
    // se repartieran por el campo abierto, los distritos dejarían de ser el
    // motivo para moverse.
    const inDistrict = crates.filter(
      (c) => districtAt(arena, c.x + c.w / 2, c.y + c.h / 2) !== undefined,
    ).length;
    expect(inDistrict).toBeGreaterThan(crates.length * 0.6);
  });

  it("abrir una caja siempre da al menos un arma", () => {
    // Si una caja pudiera salir sin arma, desviarse a abrirla sería una lotería.
    const { state, player } = matchWithCrates();
    const events = openNearest(state, player, 0, 1);

    // `openNearest` vacía el piso primero, así que todo lo que hay ahora salió
    // de la caja.
    expect(state.items.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.t === "crate")).toBe(true);
    expect(state.items.some((i) => i.kind === ITEM_WEAPON)).toBe(true);
  });

  it("una caja abierta no se puede volver a abrir", () => {
    const { state, player } = matchWithCrates();
    openNearest(state, player, 0, 1);
    expect(state.openedCrates).toEqual([0]);

    // Segundo intento pegado a la misma caja: no se vuelve a abrir, con lo cual
    // no aparece un segundo evento de apertura.
    const events = step2(state, player, 2);
    expect(state.openedCrates).toEqual([0]);
    expect(events.some((e) => e.t === "crate")).toBe(false);
  });

  it("las cajas son la fuente principal de armas y de curación, no el suelo", () => {
    const state = createGameState(4);
    state.players.push(createPlayer(1));
    startMatch(state, 5150, arena);

    // Poco tirado a la vista: es lo que mantiene el campo legible.
    expect(state.items.length).toBeLessThan(55);

    const crateCount = lootCrates(arena).length;
    const groundWeapons = state.items.filter((i) => i.kind === ITEM_WEAPON).length;
    // Cada caja da un arma garantizada, así que esto compara las dos fuentes.
    // Se mide en cantidad y no en proporción: al sacar curas del suelo la
    // proporción de armas sube sola sin que haya más armas tiradas.
    expect(groundWeapons).toBeLessThan(crateCount / 2);

    // Y la curación: la mayoría tiene que salir de abrir cajas, no del piso.
    const groundHeals = state.items
      .filter((i) => i.kind === ITEM_CONSUMABLE)
      .reduce((sum, i) => sum + i.count, 0);

    let rng = 777;
    let crateHeals = 0;
    for (let i = 0; i < crateCount; i++) {
      const rolled = rollCrateContents(rng);
      rng = rolled.state;
      for (const item of rolled.items) {
        if (item.kind === ITEM_CONSUMABLE) crateHeals += item.count;
      }
    }
    expect(crateHeals).toBeGreaterThan(groundHeals * 2);
  });
});

describe("aparición", () => {
  /** Ángulo alrededor del centro en que aparece cada jugador, en una partida de `n`. */
  function spawnAngles(n: number, seed: number): number[] {
    const state = createGameState(1);
    for (let id = 1; id <= n; id++) state.players.push(createPlayer(id));
    startMatch(state, seed, arena);
    return state.players.map((p) => Math.atan2(p.y - WORLD_CENTER_Y, p.x - WORLD_CENTER_X));
  }

  const quadrant = (a: number): number =>
    Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2));

  it("el que crea la sala no aparece siempre en el mismo lugar", () => {
    // Antes el ángulo salía del orden de llegada: el primero, siempre al este.
    const quadrants = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) quadrants.add(quadrant(spawnAngles(3, seed * 7919)[0]!));
    expect(quadrants.size).toBe(4);
  });

  it("tampoco se repite al lado de quién aparecés", () => {
    // Con el anillo girando pero el orden fijo, el segundo en entrar quedaría
    // siempre del mismo lado del primero.
    const sides = new Set<boolean>();
    for (let seed = 1; seed <= 40; seed++) {
      const [a, b] = spawnAngles(3, seed * 7919);
      const d = Math.atan2(Math.sin(b! - a!), Math.cos(b! - a!));
      sides.add(d > 0);
    }
    expect(sides.size).toBe(2);
  });

  it("siguen apareciendo lejos unos de otros", () => {
    const state = createGameState(1);
    for (let id = 1; id <= 8; id++) state.players.push(createPlayer(id));
    startMatch(state, 31337, arena);
    for (const a of state.players) {
      for (const b of state.players) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(400);
      }
    }
  });
});

describe("paquetes aéreos", () => {
  /** Una partida de dos que no se mueven ni se mueren: lo que se mira es el cielo. */
  function quietMatch(seed: number): GameState {
    const state = createGameState(1);
    state.players.push(createPlayer(1), createPlayer(2));
    startMatch(state, seed, arena);
    for (const p of state.players) p.hp = 1e9;
    return state;
  }

  const idle = (state: GameState, events: SimEvent[] = []): void => {
    step(state, new Map(state.players.map((p) => [p.id, [] as PlayerInput[]])), events, arena);
  };

  it("cae uno cuando la zona empieza a cerrarse, adentro de la próxima zona y en un lugar libre", () => {
    const state = quietMatch(4242);
    while (!state.zone.shrinking) idle(state);

    expect(state.airdrops).toHaveLength(1);
    const drop = state.airdrops[0]!;
    const z = state.zone;
    expect(Math.hypot(drop.x - z.targetX, drop.y - z.targetY)).toBeLessThanOrEqual(z.targetRadius * 0.7 + 1);
    for (const o of arena.obstacles) expect(circleHitsBox(drop.x, drop.y, 40, o)).toBe(false);
  });

  it("al aterrizar suelta un arma épica o legendaria, el chaleco pesado, un botiquín y granadas", () => {
    const state = quietMatch(4242);
    while (!state.zone.shrinking) idle(state);
    const before = state.items.length;

    const events: SimEvent[] = [];
    for (let t = 0; t < AIRDROP_FALL_TICKS; t++) idle(state, events);

    expect(state.airdrops).toHaveLength(0);
    expect(events.some((e) => e.t === "airdrop")).toBe(true);
    const loot = state.items.slice(before);
    const weapon = loot.find((i) => i.kind === ITEM_WEAPON)!;
    expect(weapon.ref).not.toBe(0);
    expect(weapon.tier).toBe(Math.min(weaponAt(weapon.ref).maxTier, weapon.tier));
    expect(weapon.tier).toBeGreaterThanOrEqual(3);
    expect(loot.filter((i) => i.kind !== ITEM_WEAPON)).toHaveLength(3);
  });

  it("son dos por partida: en las fases tardías ya no hace falta juntar a nadie", () => {
    const state = quietMatch(777);
    let launched = 0;
    let lastId = 0;
    while (state.zone.phase < 3 && state.phase === "playing") {
      idle(state);
      for (const d of state.airdrops) {
        if (d.id > lastId) {
          launched++;
          lastId = d.id;
        }
      }
    }
    expect(launched).toBe(2);
  });
});
