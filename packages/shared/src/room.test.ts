import { describe, expect, it } from "vitest";
import { HAT_COUNT, MAX_CHAT_LENGTH, sanitizeChat, sanitizeHat } from "./room.js";

describe("gorro pedido al conectarse", () => {
  it("sólo pasan los que existen; lo demás es la gorra de siempre", () => {
    expect(sanitizeHat("3")).toBe(3);
    expect(sanitizeHat(String(HAT_COUNT - 1))).toBe(HAT_COUNT - 1);
    for (const bad of [String(HAT_COUNT), "-1", "2.5", "abc", "", null, undefined, {}]) {
      expect(sanitizeHat(bad)).toBe(0);
    }
  });

  it("el chat del lobby: sin invisibles, sin espacios de más, cortado; vacío no se manda", () => {
    expect(sanitizeChat("  hola   che  ")).toBe("hola che");
    expect(sanitizeChat("ho\u200bla")).toBe("hola");
    expect(sanitizeChat("\u200b \u200b")).toBeNull();
    expect(sanitizeChat(42)).toBeNull();
    expect(sanitizeChat("x".repeat(500))!.length).toBe(MAX_CHAT_LENGTH);
  });
});
