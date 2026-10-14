import { beforeEach, describe, expect, it } from "vitest";
import { ACHIEVEMENTS, hatUnlocked, selectHat, selectedHat, unlock, unlockedAchievements } from "./achievements.js";

function fakeStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("logros y gorros", () => {
  beforeEach(fakeStorage);

  it("un logro se desbloquea una sola vez", () => {
    expect(unlock("firstKill")?.name).toBe("Primera sangre");
    expect(unlock("firstKill")).toBeNull();
    expect(unlock("noExiste")).toBeNull();
    expect(unlockedAchievements().has("firstKill")).toBe(true);
  });

  it("cada logro desbloquea un gorro distinto, y la gorra de siempre está siempre", () => {
    const hats = ACHIEVEMENTS.map((a) => a.hat);
    expect(new Set(hats).size).toBe(hats.length);
    expect(hats.includes(0)).toBe(false);
    expect(hatUnlocked(0)).toBe(true);
    const win = ACHIEVEMENTS.find((a) => a.id === "win")!;
    expect(hatUnlocked(win.hat)).toBe(false);
    unlock("win");
    expect(hatUnlocked(win.hat)).toBe(true);
  });

  it("no se puede elegir un gorro bloqueado", () => {
    const crown = ACHIEVEMENTS.find((a) => a.id === "win")!.hat;
    selectHat(crown);
    expect(selectedHat()).toBe(0);
    unlock("win");
    selectHat(crown);
    expect(selectedHat()).toBe(crown);
  });
});
