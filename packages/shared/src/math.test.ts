import { describe, expect, it } from "vitest";
import { lerpAngle } from "./math.js";

describe("lerpAngle", () => {
  it("va por el lado corto del círculo", () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 2);
    expect(lerpAngle(-3, 3, 0.5)).toBeCloseTo(-Math.PI, 2);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("con ángulos enormes o que no son números termina y da algo finito", () => {
    expect(Number.isFinite(lerpAngle(0, 1e20, 0.5))).toBe(true);
    expect(Math.abs(lerpAngle(0, 1e20, 0.5))).toBeLessThanOrEqual(Math.PI);
    expect(lerpAngle(0, Infinity, 0.5)).toBe(0);
    expect(lerpAngle(1, NaN, 0.5)).toBe(1);
  });
});
