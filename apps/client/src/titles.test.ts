import { describe, expect, it } from "vitest";
import { titlesFor, type TitleStats } from "./titles.js";

/** Uno que no hizo nada, con lo que se le cambie encima. */
const row = (id: number, place: number, extra: Partial<TitleStats> = {}): TitleStats => ({
  id,
  place,
  kills: 0,
  damage: 0,
  damageTaken: 0,
  shots: 0,
  hits: 0,
  survived: 60,
  longestKill: 0,
  healed: 0,
  selfDamage: 0,
  traveled: 0,
  thrown: 0,
  ...extra,
});

describe("un título para cada uno", () => {
  it("nadie se va sin nada", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, i + 1, { kills: i % 3, damage: (i * 37) % 200, shots: i * 4, hits: i }));
    const titles = titlesFor(rows);
    for (const r of rows) expect(titles.get(r.id)?.label).toBeTruthy();
  });

  it("el que ganó, el carnicero y el ciego", () => {
    const titles = titlesFor([
      row(1, 1, { kills: 1, damage: 90, shots: 20, hits: 4 }),
      row(2, 2, { kills: 4, damage: 300, shots: 40, hits: 10 }),
      row(3, 3, { shots: 12, hits: 0 }),
      row(4, 4),
    ]);
    expect(titles.get(1)).toEqual({ label: "Último en pie", detail: "ganó la partida" });
    expect(titles.get(2)?.label).toBe("Carnicero");
    expect(titles.get(3)).toEqual({ label: "Ciego", detail: "no dio una bala" });
  });

  it("empatados en kills, no hay carnicero", () => {
    const titles = titlesFor([row(1, 1), row(2, 2, { kills: 3 }), row(3, 3, { kills: 3 })]);
    expect([...titles.values()].some((t) => t.label === "Carnicero")).toBe(false);
  });

  it("los de lo que hizo cada uno pueden repetirse", () => {
    const titles = titlesFor([row(1, 1), row(2, 2, { shots: 8 }), row(3, 3, { shots: 9 })]);
    expect(titles.get(2)?.label).toBe("Ciego");
    expect(titles.get(3)?.label).toBe("Ciego");
  });

  it("kamikaze, pacifista y turista", () => {
    const titles = titlesFor([
      row(1, 1),
      row(2, 2, { selfDamage: 45, damage: 10 }),
      row(3, 3, { survived: 120 }),
      row(4, 4, { survived: 10 }),
      row(5, 5, { survived: 5 }),
    ]);
    expect(titles.get(2)?.label).toBe("Kamikaze");
    expect(titles.get(3)?.label).toBe("Pacifista");
    expect(titles.get(5)?.label).toBe("Primero en caer");
    expect(titles.get(4)?.label).toBe("Turista");
  });

  it("el que volvió con la segunda oportunidad es un gato", () => {
    const titles = titlesFor([
      row(1, 1, { kills: 2, damage: 150, shots: 20, hits: 8 }),
      row(2, 2, { cameBack: true, damage: 40, shots: 8, hits: 2 }),
      row(3, 3, { damage: 30, shots: 9, hits: 2 }),
    ]);
    expect(titles.get(2)).toEqual({ label: "Gato", detail: "volvió de la muerte" });
    expect(titles.get(3)?.label).not.toBe("Gato");
  });

  it("el que apostó bien desde afuera es adivino", () => {
    const titles = titlesFor([
      row(1, 1, { kills: 2, damage: 150, shots: 20, hits: 8 }),
      row(2, 2, { damage: 40, shots: 8, hits: 2 }),
      row(3, 3, { guessed: true, damage: 10, shots: 6, hits: 1 }),
    ]);
    expect(titles.get(3)).toEqual({ label: "Adivino", detail: "apostó por el que ganó" });
  });
});
