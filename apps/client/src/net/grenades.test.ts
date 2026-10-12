import { describe, expect, it } from "vitest";
import {
  ACT_THROW,
  InputQueue,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  createGameState,
  createPlayer,
  emptyInput,
  generateArena,
  packAim,
  packPlayer,
  step,
  unpackAim,
  unpackPlayer,
  type PlayerInput,
  type SimEvent,
  type UnpackedPlayer,
} from "@wabbr/shared";
import { LocalGrenades } from "./grenades.js";
import { Predictor } from "./prediction.js";

const arena = generateArena();

describe("granadas propias", () => {
  it("con 200 ms de ping, la granada dibujada rueda y estalla donde la del servidor", () => {
    const state = createGameState(5);
    state.phase = "playing";
    // En el centro de la ciudad: con paredes cerca, así también se prueban los rebotes.
    const me = createPlayer(1, WORLD_CENTER_X, WORLD_CENTER_Y);
    const other = createPlayer(2, WORLD_CENTER_X, WORLD_CENTER_Y + 1200);
    me.alive = true;
    other.alive = true;
    me.grenades = 2;
    state.players.push(me, other);

    const queue = new InputQueue();
    const client = new Predictor(1);
    client.reset(me.x, me.y);
    const local = new LocalGrenades();

    const toServer: { at: number; input: PlayerInput }[] = [];
    const toClient: { at: number; me: UnpackedPlayer; events: SimEvent[] }[] = [];
    let sent = 0;
    let received = 0;
    const localBlasts: { x: number; y: number }[] = [];
    const serverBlasts: { x: number; y: number }[] = [];
    let confirmed = 0;

    for (let t = 0; t < 140; t++) {
      // Dos granadas, para un lado y para el otro, caminando en el medio.
      const input: PlayerInput = {
        ...emptyInput(t + 1),
        moveX: t < 30 ? 1 : 0,
        aim: unpackAim(packAim(t < 50 ? 0.4 : 2.6)),
        act: t === 20 || t === 60 ? ACT_THROW : 0,
      };
      client.apply(input, arena);
      const thrown = client.takeThrow();
      if (thrown) local.throw(thrown.seq, thrown.launch);
      localBlasts.push(...local.tick(arena));
      toServer.push({ at: t + 2, input });

      while (sent < toServer.length && toServer[sent]!.at <= t) queue.push(toServer[sent++]!.input);
      const events: SimEvent[] = [];
      step(state, new Map([[1, queue.take()], [2, []]]), events, arena);
      for (const e of events) if (e.t === "explosion") serverBlasts.push({ x: e.x, y: e.y });
      toClient.push({ at: t + 2, me: unpackPlayer(packPlayer(me, true)), events });

      while (received < toClient.length && toClient[received]!.at <= t) {
        const snap = toClient[received++]!;
        client.reconcile(snap.me, arena);
        for (const e of snap.events) {
          if (e.t === "throw" && e.byId === 1 && local.confirm(e.seq, e.grenade)) confirmed++;
        }
        local.settle(snap.me.lastSeq);
      }
    }

    expect(localBlasts).toHaveLength(2);
    expect(serverBlasts).toHaveLength(2);
    expect(confirmed).toBe(2);
    localBlasts.forEach((b, i) => {
      // Lo único que las puede separar es el redondeo de la posición en el snapshot.
      expect(Math.hypot(b.x - serverBlasts[i]!.x, b.y - serverBlasts[i]!.y)).toBeLessThan(0.5);
    });
  });

  it("si el servidor no la tiró, la dibujada desaparece al confirmarse ese input", () => {
    const local = new LocalGrenades();
    local.throw(7, { x: 0, y: 0, vx: 100, vy: 0, fuse: 40 });
    expect(local.grenades(0)).toHaveLength(1);
    local.settle(6);
    expect(local.grenades(0)).toHaveLength(1);
    local.settle(7);
    expect(local.grenades(0)).toHaveLength(0);
  });
});
