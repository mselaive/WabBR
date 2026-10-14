import { describe, expect, it } from "vitest";
import {
  ObstacleGrid,
  WORLD_CENTER_X,
  WORLD_CENTER_Y,
  createPlayer,
  emptyInput,
  packPlayer,
  stepPlayerMovement,
  unpackPlayer,
  type ArenaMap,
  type PlayerInput,
  type UnpackedPlayer,
} from "@wabbr/shared";
import { Predictor } from "./prediction.js";

const pad = { x: WORLD_CENTER_X, y: WORLD_CENTER_Y };
const wall = { kind: "wall" as const, x: pad.x + 150, y: pad.y - 100, w: 30, h: 200, variant: 0 };
const map: ArenaMap = {
  obstacles: [wall],
  decor: [],
  buildings: [],
  paths: [],
  ponds: [],
  districts: [],
  grid: new ObstacleGrid([wall]),
  jumpPads: [pad],
};

describe("salto predicho", () => {
  it("con 150 ms de ping, el cliente vuela y cae donde el servidor", () => {
    const latency = 3;
    const server = createPlayer(1, pad.x - 120, pad.y);
    server.alive = true;
    const client = new Predictor(1);
    client.reset(server.x, server.y);

    const toServer: { at: number; input: PlayerInput }[] = [];
    const toClient: { at: number; snap: UnpackedPlayer }[] = [];
    let sent = 0;
    let received = 0;
    let maxCorrection = 0;

    for (let t = 0; t < 80; t++) {
      // Camina a la derecha, pisa el hongo, vuela, cae y sigue.
      const input: PlayerInput = { ...emptyInput(t + 1), moveX: 1 };
      client.apply(input, map);
      toServer.push({ at: t + latency, input });

      while (sent < toServer.length && toServer[sent]!.at <= t) {
        stepPlayerMovement(server, toServer[sent]!.input, map);
        toClient.push({ at: t + latency, snap: unpackPlayer(packPlayer(server, true)) });
        sent++;
      }
      while (received < toClient.length && toClient[received]!.at <= t) {
        const before = { x: client.state.x, y: client.state.y };
        client.reconcile(toClient[received]!.snap, map);
        received++;
        maxCorrection = Math.max(maxCorrection, Math.hypot(before.x - client.state.x, before.y - client.state.y));
      }
    }

    // Saltó de verdad (pasó la pared) y la predicción no tuvo que corregir nada.
    expect(server.x).toBeGreaterThan(wall.x + wall.w);
    expect(maxCorrection).toBeLessThan(0.5);
  });
});
