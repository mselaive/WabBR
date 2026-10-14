/**
 * Logros y gorros, sin cuentas: se guardan en este navegador, como los
 * récords. Cada logro desbloquea un gorro que todos ven sobre tu muñeco. Para
 * un juego de amigos no hace falta más: si alguien se los inventa editando el
 * navegador, es un gorro.
 */

export interface Achievement {
  id: string;
  name: string;
  /** Cómo se consigue, para el menú. */
  how: string;
  /** El gorro que desbloquea (índice; 0 es la gorra de siempre). */
  hat: number;
  hatName: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "firstKill", name: "Primera sangre", how: "Hacé tu primera kill", hat: 9, hatName: "Galera" },
  { id: "win", name: "Campeón", how: "Ganá una partida", hat: 1, hatName: "Corona" },
  { id: "fiveKills", name: "Masacre", how: "5 kills en una partida", hat: 2, hatName: "Casco" },
  { id: "longShot", name: "Ojo de águila", how: "Una kill a 40 m o más", hat: 3, hatName: "Sombrero vaquero" },
  { id: "veteran", name: "Veterano", how: "Jugá 10 partidas", hat: 4, hatName: "Gorro de fiesta" },
  { id: "rocketKill", name: "Demolición", how: "Una kill con el lanzacohetes", hat: 5, hatName: "Cuernos" },
  { id: "fireKill", name: "Pirómano", how: "Una kill con una molotov", hat: 6, hatName: "Bandana" },
  { id: "revive", name: "Ángel guardián", how: "Levantá a tu compañero", hat: 7, hatName: "Aureola" },
  { id: "nightWin", name: "Búho", how: "Ganá una partida de noche", hat: 8, hatName: "Gorro de mago" },
  { id: "chicken", name: "Cazador", how: "Cazá la gallina dorada", hat: 10, hatName: "Cresta" },
  { id: "bet", name: "Vidente", how: "Acertá una apuesta de espectador", hat: 11, hatName: "Turbante" },
];

const UNLOCKED_KEY = "wabbr:achievements";
const HAT_KEY = "wabbr:hat";

export function unlockedAchievements(): Set<string> {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Desbloquea un logro. Devuelve el logro si es nuevo (para avisarlo), o null. */
export function unlock(id: string): Achievement | null {
  const done = unlockedAchievements();
  if (done.has(id)) return null;
  const achievement = ACHIEVEMENTS.find((a) => a.id === id);
  if (!achievement) return null;
  done.add(id);
  try {
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...done]));
  } catch {
    // Sin almacenamiento, el logro vale por esta sesión nada más.
  }
  return achievement;
}

/** ¿Se puede usar este gorro? La gorra de siempre (0), sí. */
export function hatUnlocked(hat: number, done: Set<string> = unlockedAchievements()): boolean {
  if (hat === 0) return true;
  return ACHIEVEMENTS.some((a) => a.hat === hat && done.has(a.id));
}

/** El gorro elegido, si sigue desbloqueado; si no, la gorra de siempre. */
export function selectedHat(): number {
  try {
    const hat = Number(localStorage.getItem(HAT_KEY) ?? 0);
    return Number.isInteger(hat) && hatUnlocked(hat) ? hat : 0;
  } catch {
    return 0;
  }
}

export function selectHat(hat: number): void {
  if (!hatUnlocked(hat)) return;
  try {
    localStorage.setItem(HAT_KEY, String(hat));
  } catch {
    // Igual se usa en esta sesión: el que llama guarda el valor.
  }
}
