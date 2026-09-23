/** Colours for the "paper map" look. Everything visual reads from here. */

export type RGB = readonly [number, number, number];

export const TERRAIN_RGB: readonly RGB[] = [
  [233, 227, 203], // plains — parchment
  [182, 204, 152], // forest
  [221, 204, 160], // hills
  [152, 192, 215], // water
  [168, 160, 149], // mountains
];

/** Ink colour for each terrain's edge and decorations. */
export const TERRAIN_INK: readonly RGB[] = [
  [196, 186, 150],
  [104, 146, 88],
  [170, 146, 96],
  [96, 146, 184],
  [110, 102, 94],
];

export interface TeamColors {
  name: string;
  main: string;
  dark: string;
  light: string;
  rgb: RGB;
}

export const TEAM_COLORS: readonly TeamColors[] = [
  { name: 'Cobalt', main: '#2f5fd0', dark: '#1a3478', light: '#9db6ef', rgb: [47, 95, 208] },
  { name: 'Vermilion', main: '#d6452a', dark: '#7c2111', light: '#f0a896', rgb: [214, 69, 42] },
];

export const NEUTRAL_COLOR = { main: '#8d877a', dark: '#4f4a41', light: '#d8d2c2' };

export const BACKGROUND = '#c9c1a6';
export const INK = '#2d2a24';
export const SELECTION = '#ffffff';

export function teamColor(team: number): TeamColors | typeof NEUTRAL_COLOR {
  return TEAM_COLORS[team] ?? NEUTRAL_COLOR;
}

export function rgba(rgb: RGB, a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}
