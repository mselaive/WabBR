import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from "./constants.js";

/** Sin vocales ni caracteres ambiguos (0/O, 1/I): códigos fáciles de dictar. */
const CODE_ALPHABET = "23456789BCDFGHJKLMNPQRSTVWXYZ";

export function generateRoomCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/**
 * Caracteres de control e invisibles (zero-width, marcas de dirección, BOM).
 * Se filtran por code point en vez de con un regex literal para que el archivo
 * fuente no tenga que contener bytes de control.
 */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f || // control C0
    code === 0x7f || // DEL
    (code >= 0x80 && code <= 0x9f) || // control C1
    (code >= 0x200b && code <= 0x200f) || // zero-width y marcas LTR/RTL
    code === 0x2028 ||
    code === 0x2029 || // separadores de línea/párrafo
    (code >= 0x202a && code <= 0x202e) || // overrides de dirección
    code === 0x2060 ||
    code === 0xfeff // word joiner y BOM
  );
}

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  let cleaned = "";
  for (const ch of s) {
    if (!isInvisible(ch.codePointAt(0) ?? 0)) cleaned += ch;
  }
  cleaned = cleaned.trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : "Jugador";
}
