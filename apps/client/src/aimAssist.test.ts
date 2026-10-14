import { describe, expect, it } from "vitest";
import { assistAim } from "./aimAssist.js";

const me = { x: 0, y: 0 };

describe("ayuda de puntería del stick", () => {
  it("casi en la línea, la mira se corre hacia el rival", () => {
    const target = { x: 400, y: 40 }; // ~5,7° de la horizontal
    const aim = assistAim(me, 0, [target]);
    const to = Math.atan2(40, 400);
    expect(aim).toBeGreaterThan(to * 0.6);
    expect(aim).toBeLessThan(to);
  });

  it("lejos de la línea, lejos del todo o sin nadie, no toca nada", () => {
    expect(assistAim(me, 0, [{ x: 400, y: 200 }])).toBe(0);
    expect(assistAim(me, 0, [{ x: 900, y: 10 }])).toBe(0);
    expect(assistAim(me, 1, [])).toBe(1);
  });

  it("con dos, el más cercano a la línea; y funciona del otro lado de ±π", () => {
    const aim = assistAim(me, 0, [{ x: 300, y: 45 }, { x: 300, y: -10 }]);
    expect(aim).toBeLessThan(0);
    const back = assistAim(me, Math.PI - 0.05, [{ x: -400, y: -20 }]);
    expect(Math.cos(back)).toBeLessThan(-0.99);
  });
});
