import { describe, expect, it } from "vitest";
import { HAT_COUNT, sanitizeHat } from "./room.js";

describe("gorro pedido al conectarse", () => {
  it("sólo pasan los que existen; lo demás es la gorra de siempre", () => {
    expect(sanitizeHat("3")).toBe(3);
    expect(sanitizeHat(String(HAT_COUNT - 1))).toBe(HAT_COUNT - 1);
    for (const bad of [String(HAT_COUNT), "-1", "2.5", "abc", "", null, undefined, {}]) {
      expect(sanitizeHat(bad)).toBe(0);
    }
  });
});
