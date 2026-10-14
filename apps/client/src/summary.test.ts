import { describe, expect, it } from "vitest";
import type { PlayerMeta } from "@wabbr/shared";
import { nightSummary } from "./summary.js";

const meta = (id: number, name: string, extra: Partial<PlayerMeta> = {}): PlayerMeta => ({
  id,
  name,
  colorIndex: id,
  ready: false,
  ...extra,
});

describe("el resumen de la noche", () => {
  it("sin partidas jugadas no hay nada que contar", () => {
    expect(nightSummary([meta(1, "Mati")], "KCHSTR", "x")).toBeNull();
  });

  it("ordena por ganadas, desempata por kills y deja el link", () => {
    const text = nightSummary(
      [
        meta(1, "Mati", { played: 4, wins: 1, totalKills: 9, betsWon: 2 }),
        meta(2, "Juan", { played: 4, wins: 2, totalKills: 3 }),
        meta(3, "Bot Lola", { played: 4, wins: 1, totalKills: 11, bot: true }),
        meta(4, "Recién", {}),
      ],
      "KCHSTR",
      "https://www.wabbo.org/?room=KCHSTR",
    )!;
    expect(text.split("\n")).toEqual([
      "WabBR · sala KCHSTR · 4 partidas",
      "1. Juan — 2 ganadas, 3 kills",
      "2. Bot Lola — 1 ganada, 11 kills",
      "3. Mati — 1 ganada, 9 kills, 2 apuestas",
      "Sumate: https://www.wabbo.org/?room=KCHSTR",
    ]);
  });
});
