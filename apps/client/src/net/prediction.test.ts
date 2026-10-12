import { describe, expect, it } from "vitest";
import {
  DT,
  PLAYER_SPEED,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  createPlayer,
  emptyInput,
  generateArena,
  stepPlayerMovement,
  type ArenaMap,
  type PlayerInput,
  type PlayerState,
  type UnpackedPlayer,
} from "@wabbr/shared";
import { Predictor } from "./prediction.js";

const arena: ArenaMap = generateArena();

/** Igual que el codec: las posiciones viajan redondeadas a 0.1 px. */
const quantize = (v: number): number => Math.round(v * 10) / 10;

function snapshotOf(p: PlayerState, lastSeq: number): UnpackedPlayer {
  return {
    id: p.id,
    x: quantize(p.x),
    y: quantize(p.y),
    aim: p.aim,
    hp: p.hp,
    alive: true,
    reloading: false,
    connected: true,
    ammo: 30,
    kills: 0,
    lastSeq,
    shield: 0,
    activeSlot: 0,
    slots: [0, -1],
    slotTiers: [0, 0],
    ammoOther: 0,
    consumables: [0, 0, 0],
    useCd: 0,
    useIndex: -1,
    boostTicks: 0,
    stamina: 100,
    staminaDelay: 0,
    grenades: 0,
    fireCd: 0,
    reloadCd: 0,
  };
}

function scripted(tick: number, seq: number): PlayerInput {
  return {
    seq,
    moveX: [1, 1, 0, -1, -1, 0, 1, 0][tick % 8]!,
    moveY: [0, 1, 1, 1, 0, -1, -1, -1][tick % 8]!,
    aim: (tick % 32) * 0.2,
    shoot: false,
    reload: false,
    sprint: false,
    view: -1,
    act: 0,
  };
}

/**
 * Simula cliente y servidor en memoria con latencia inyectada.
 * Devuelve la corrección más grande que tuvo que aplicar la reconciliación:
 * si el modelo funciona, tiene que ser prácticamente cero, porque el cliente
 * llega a la misma posición que el servidor por su cuenta.
 */
function simulate(opts: { ticks: number; latencyTicks: number; dropRate?: number }): number {
  const { ticks, latencyTicks, dropRate = 0 } = opts;
  const spawnX = WORLD_CENTER_X - 300;
  const spawnY = WORLD_CENTER_Y - 120;

  const server = createPlayer(1, spawnX, spawnY);
  server.alive = true;

  const client = new Predictor(1);
  client.reset(spawnX, spawnY);

  const toServer: { at: number; input: PlayerInput }[] = [];
  const toClient: { at: number; snap: UnpackedPlayer }[] = [];
  const serverQueue: PlayerInput[] = [];
  let serverLast = emptyInput(0);
  let sent = 0;
  let received = 0;
  let maxCorrection = 0;

  // Descarte determinista de paquetes, para que el test no dependa del azar.
  let dropSeed = 1;
  const shouldDrop = (): boolean => {
    dropSeed = (dropSeed * 1103515245 + 12345) & 0x7fffffff;
    return dropRate > 0 && (dropSeed % 1000) / 1000 < dropRate;
  };

  for (let t = 0; t < ticks; t++) {
    // --- cliente: aplica su input al instante y lo manda
    const input = scripted(t, t + 1);
    client.apply(input, arena);
    if (!shouldDrop()) toServer.push({ at: t + latencyTicks, input });

    // --- servidor: recibe lo que ya llegó y simula un input por tick
    while (sent < toServer.length && toServer[sent]!.at <= t) {
      serverQueue.push(toServer[sent]!.input);
      sent++;
    }
    const next = serverQueue.shift();
    if (next) serverLast = next;
    stepPlayerMovement(server, serverLast, arena);
    toClient.push({ at: t + latencyTicks, snap: snapshotOf(server, serverLast.seq) });

    // --- cliente: reconcilia con los snapshots que ya llegaron
    while (received < toClient.length && toClient[received]!.at <= t) {
      const before = { x: client.state.x, y: client.state.y };
      client.reconcile(toClient[received]!.snap, arena);
      received++;
      maxCorrection = Math.max(
        maxCorrection,
        Math.hypot(before.x - client.state.x, before.y - client.state.y),
      );
    }
  }

  return maxCorrection;
}

describe("reconciliación", () => {
  it("sin latencia el cliente coincide con el servidor", () => {
    expect(simulate({ ticks: 200, latencyTicks: 0 })).toBeLessThan(0.2);
  });

  it("con 200 ms de ida y vuelta la corrección sigue siendo imperceptible", () => {
    // 4 ticks de ida + 4 de vuelta a 20 Hz = 200 ms de RTT: la peor conexión
    // razonable entre amigos. La única diferencia debería ser el redondeo.
    const correction = simulate({ ticks: 400, latencyTicks: 4 });
    expect(correction).toBeLessThan(0.5);
  });

  it("con 20 % de pérdida de paquetes el error queda acotado", () => {
    // Perder inputs sí produce saltos: lo que importa es que no crezcan.
    //
    // La cota sale de la cuenta, no del ojo. Un input perdido cuesta como mucho
    // un tick de movimiento, y sólo pueden estar en vuelo los inputs de la
    // ventana de latencia (ida + vuelta). Si se perdieran TODOS:
    const enVuelo = 3 * 2;
    const porTick = PLAYER_SPEED * DT;
    // Más un margen por las colisiones, que al reaplicar pueden empujar el
    // rebobinado a un lado distinto del obstáculo.
    const cota = enVuelo * porTick * 1.5;

    const correction = simulate({ ticks: 600, latencyTicks: 3, dropRate: 0.2 });
    expect(correction).toBeLessThan(cota);

    // Y lo que de verdad se está probando: correr cuatro veces más tiempo no
    // agranda el error. Si se acumulara, el personaje terminaría en otro lado.
    const largo = simulate({ ticks: 2400, latencyTicks: 3, dropRate: 0.2 });
    expect(largo).toBeLessThan(cota);
  });

  it("un teletransporte grande se muestra de una y no se suaviza", () => {
    const client = new Predictor(1);
    client.reset(WORLD_CENTER_X, WORLD_CENTER_Y);
    const far = createPlayer(1, WORLD_CENTER_X + 500, WORLD_CENTER_Y);
    client.reconcile(snapshotOf(far, 0), arena);

    // En cualquier punto del tick: un salto no deja tramo que interpolar, así
    // que no puede verse al muñeco deslizándose desde donde ya no está.
    for (const alpha of [0, 0.5, 1]) {
      const pos = client.renderPosition(1 / 60, alpha);
      expect(Math.hypot(pos.x - far.x, pos.y - far.y)).toBeLessThan(1);
    }
  });

  it("dibuja posiciones intermedias entre dos pasos de simulación", () => {
    const client = new Predictor(1);
    client.reset(WORLD_CENTER_X, WORLD_CENTER_Y);

    const antes = client.renderPosition(0, 1).x;
    client.apply(
      { seq: 1, moveX: 1, moveY: 0, aim: 0, shoot: false, reload: false, sprint: false, view: -1, act: 0 },
      arena,
    );
    const despues = client.renderPosition(0, 1).x;
    expect(despues).toBeGreaterThan(antes);

    // A mitad de tick tiene que estar a mitad de camino. Sin esto la pantalla
    // dibuja 20 posiciones por segundo aunque vaya a 60 cuadros.
    const medio = client.renderPosition(0, 0.5).x;
    expect(medio).toBeCloseTo((antes + despues) / 2, 4);
  });
});
