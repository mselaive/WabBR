/**
 * Récords personales, guardados en este navegador. Sin cuentas: si borrás los
 * datos del navegador o cambiás de compu, empezás de cero. Alcanza para tener
 * algo que superar ("mi récord son 6 kills") sin pedirle nada a nadie.
 */

const KEY = "wabbr:records";

export interface Records {
  played: number;
  wins: number;
  bestKills: number;
  bestDamage: number;
  /** En metros (ver PX_PER_METER). */
  longestKill: number;
}

/** El mapa no tiene escala real: 20 px por metro hace que un muñeco mida ~1,2 m. */
export const PX_PER_METER = 20;

const EMPTY: Records = { played: 0, wins: 0, bestKills: 0, bestDamage: 0, longestKill: 0 };

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Records>) };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Suma una partida y devuelve los récords que se rompieron, ya escritos para
 * mostrar. El primer partido no rompe récords: no había nada que romper.
 */
export function addMatch(m: { won: boolean; kills: number; damage: number; longestKill: number }): string[] {
  const r = loadRecords();
  const first = r.played === 0;
  const broken: string[] = [];
  if (!first && m.kills > r.bestKills && m.kills > 0) broken.push(`${m.kills} kills (antes ${r.bestKills})`);
  if (!first && m.damage > r.bestDamage && m.damage > 0) broken.push(`${Math.round(m.damage)} de daño (antes ${Math.round(r.bestDamage)})`);
  if (!first && m.longestKill > r.longestKill && m.longestKill > 0) {
    broken.push(`tiro de ${m.longestKill} m (antes ${r.longestKill} m)`);
  }
  r.played++;
  if (m.won) r.wins++;
  r.bestKills = Math.max(r.bestKills, m.kills);
  r.bestDamage = Math.max(r.bestDamage, Math.round(m.damage));
  r.longestKill = Math.max(r.longestKill, m.longestKill);
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Sin almacenamiento no hay récords, y no pasa nada.
  }
  return broken;
}

/** Una línea para el menú: "12 partidas · 3 ganadas · récord: 6 kills". Vacía si nunca jugó. */
export function recordsLine(r: Records = loadRecords()): string {
  if (r.played === 0) return "";
  const parts = [`${r.played} ${r.played === 1 ? "partida" : "partidas"}`, `${r.wins} ${r.wins === 1 ? "ganada" : "ganadas"}`];
  if (r.bestKills > 0) parts.push(`récord: ${r.bestKills} kills`);
  if (r.longestKill > 0) parts.push(`tiro más largo: ${r.longestKill} m`);
  return parts.join(" · ");
}
