import type { PlayerMeta } from "@wabbr/shared";

/**
 * El resumen de la noche en la sala, para pegarlo en el grupo: la tabla por
 * ganadas (y kills para desempatar), cuántas partidas fueron y el link para
 * sumarse. Texto plano: WhatsApp y Discord lo muestran igual.
 */
export function nightSummary(roster: readonly PlayerMeta[], room: string, link: string): string | null {
  const played = Math.max(0, ...roster.map((p) => p.played ?? 0));
  if (played === 0) return null;
  const rows = roster
    .filter((p) => (p.played ?? 0) > 0)
    .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0) || (b.totalKills ?? 0) - (a.totalKills ?? 0) || a.id - b.id);
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const lines = rows.map((p, i) => {
    const parts = [plural(p.wins ?? 0, "ganada", "ganadas"), plural(p.totalKills ?? 0, "kill", "kills")];
    if (p.betsWon) parts.push(plural(p.betsWon, "apuesta", "apuestas"));
    return `${i + 1}. ${p.name} — ${parts.join(", ")}`;
  });
  return [`WabBR · sala ${room} · ${plural(played, "partida", "partidas")}`, ...lines, `Sumate: ${link}`].join("\n");
}
