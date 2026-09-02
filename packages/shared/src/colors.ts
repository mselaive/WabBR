/**
 * Paleta de jugadores. Se transmite el índice, no el color, así cliente y
 * servidor no pueden desincronizarse y cambiar la paleta es un solo lugar.
 */
export const PLAYER_COLORS: readonly number[] = [
  0x4aa3ff, // azul
  0xff5c5c, // rojo
  0x5cd97a, // verde
  0xffc94a, // amarillo
  0xc07cff, // violeta
  0xff8f3f, // naranja
  0x3fe0d0, // turquesa
  0xff7ac0, // rosa
  0x9fe04a, // lima
  0x7a8cff, // índigo
  0xd6b483, // arena
  0xa0a6b0, // gris
  0x00b894, // esmeralda
  0xe17055, // terracota
  0x74b9ff, // celeste
  0xfd79a8, // magenta
];

export function playerColor(index: number): number {
  return PLAYER_COLORS[index % PLAYER_COLORS.length]!;
}
