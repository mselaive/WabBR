import { beforeEach, describe, expect, it } from "vitest";
import { addMatch, loadRecords, recordsLine } from "./records.js";

/** Un localStorage de mentira: los tests corren en Node, sin navegador. */
function fakeStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("récords personales", () => {
  beforeEach(fakeStorage);

  it("la primera partida no rompe récords: no había nada que romper", () => {
    expect(addMatch({ won: false, kills: 3, damage: 210, longestKill: 15 })).toEqual([]);
    expect(loadRecords()).toMatchObject({ played: 1, wins: 0, bestKills: 3, bestDamage: 210, longestKill: 15 });
  });

  it("superarlos lo dice, con el anterior; empatarlos no", () => {
    addMatch({ won: false, kills: 3, damage: 210, longestKill: 15 });
    expect(addMatch({ won: true, kills: 3, damage: 100, longestKill: 15 })).toEqual([]);
    const broken = addMatch({ won: false, kills: 5, damage: 300, longestKill: 40 });
    expect(broken).toEqual(["5 kills (antes 3)", "300 de daño (antes 210)", "tiro de 40 m (antes 15 m)"]);
    expect(loadRecords()).toMatchObject({ played: 3, wins: 1, bestKills: 5 });
  });

  it("la línea del menú", () => {
    expect(recordsLine()).toBe("");
    addMatch({ won: true, kills: 6, damage: 400, longestKill: 32 });
    expect(recordsLine()).toBe("1 partida · 1 ganada · récord: 6 kills · tiro más largo: 32 m");
  });

  it("sin almacenamiento no revienta", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(addMatch({ won: false, kills: 1, damage: 10, longestKill: 0 })).toEqual([]);
    expect(recordsLine()).toBe("");
  });
});
