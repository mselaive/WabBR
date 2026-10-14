/**
 * Un título para cada uno al final de la partida: el ganador, los mejores en
 * algo y, para el resto, uno gracioso según lo que hizo ("Ciego: no dio una
 * bala"). Nadie se va sin nada: el que no hizo nada se lleva "Turista".
 *
 * Primero se reparten los títulos de "el mejor en algo" (uno por categoría,
 * para el mejor de verdad); después los que dependen de lo que hizo cada uno,
 * que pueden repetirse (dos ciegos en la misma partida es más gracioso, no
 * menos); al final, el de consuelo.
 */

export interface TitleStats {
  id: number;
  place: number;
  kills: number;
  damage: number;
  damageTaken: number;
  shots: number;
  hits: number;
  /** Segundos que aguantó vivo. */
  survived: number;
  /** En metros. */
  longestKill: number;
  healed: number;
  selfDamage: number;
  /** En metros. */
  traveled: number;
  thrown: number;
}

export interface Title {
  label: string;
  detail: string;
}

/** Menos disparos que esto y la puntería no dice nada. */
const MIN_SHOTS = 10;

export function titlesFor(rows: readonly TitleStats[]): Map<number, Title> {
  const out = new Map<number, Title>();
  const free = (): TitleStats[] => rows.filter((r) => !out.has(r.id));
  const give = (r: TitleStats | undefined, label: string, detail: string): void => {
    if (r && !out.has(r.id)) out.set(r.id, { label, detail });
  };
  /** El mejor de todos en algo, si supera el mínimo y no está empatado. */
  const best = (score: (r: TitleStats) => number, min: number): TitleStats | undefined => {
    let top: TitleStats | undefined;
    let tie = false;
    for (const r of rows) {
      const s = score(r);
      if (s < min) continue;
      if (!top || s > score(top)) {
        top = r;
        tie = false;
      } else if (s === score(top)) {
        tie = true;
      }
    }
    return tie ? undefined : top;
  };
  const accuracy = (r: TitleStats): number => (r.shots >= MIN_SHOTS ? r.hits / r.shots : 0);

  // Los que ganaron.
  for (const r of rows) if (r.place === 1) give(r, "Último en pie", "ganó la partida");

  // Los mejores en algo: uno por categoría, para el mejor de verdad.
  const killer = best((r) => r.kills, 2);
  give(killer, "Carnicero", `${killer?.kills} kills`);
  const damage = best((r) => r.damage, 100);
  give(damage, "Demoledor", `${Math.round(damage?.damage ?? 0)} de daño`);
  const aim = best(accuracy, 0.35);
  give(aim, "Ojo de halcón", `${Math.round(accuracy(aim ?? rows[0]!) * 100)}% de puntería`);
  const far = best((r) => r.longestKill, 25);
  give(far, "Francotirador", `una kill a ${far?.longestKill} m`);

  // Lo que hizo cada uno, para bien o para mal. Puede repetirse.
  for (const r of free()) {
    if (r.selfDamage >= 30) give(r, "Kamikaze", `se sacó ${Math.round(r.selfDamage)} de vida solo`);
    else if (r.shots >= 5 && r.hits === 0) give(r, "Ciego", "no dio una bala");
    else if (r.shots === 0 && r.survived >= 30) give(r, "Pacifista", "no disparó ni una vez");
  }

  // Más "el que más", ahora entre los que quedaron sin título.
  const healer = best((r) => (out.has(r.id) ? 0 : r.healed), 50);
  give(healer, "Enfermero", `se curó ${Math.round(healer?.healed ?? 0)}`);
  const sponge = best((r) => (out.has(r.id) ? 0 : r.damageTaken), 150);
  give(sponge, "Esponja", `se comió ${Math.round(sponge?.damageTaken ?? 0)} de daño`);
  const grenadier = best((r) => (out.has(r.id) ? 0 : r.thrown), 2);
  give(grenadier, "Granadero", `tiró ${grenadier?.thrown} granadas`);
  const trigger = best((r) => (out.has(r.id) || accuracy(r) > 0.2 ? 0 : r.shots), 30);
  give(trigger, "Gatillo fácil", `${trigger?.shots} tiros, casi todos al aire`);
  const runner = best((r) => (out.has(r.id) ? 0 : r.traveled), 400);
  give(runner, "Maratonista", `caminó ${runner?.traveled} m`);

  // El primero en caer, si cayó solo en el último puesto.
  const last = Math.max(...rows.map((r) => r.place));
  const firstOut = rows.filter((r) => r.place === last);
  if (firstOut.length === 1 && rows.length > 2) give(firstOut[0], "Primero en caer", `duró ${clock(firstOut[0]!.survived)}`);

  // Nadie se va con las manos vacías.
  for (const r of free()) {
    if (r.damage > 0) give(r, "Luchador", `${Math.round(r.damage)} de daño`);
    else give(r, "Turista", `paseó ${clock(r.survived)} sin hacer nada`);
  }
  return out;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
