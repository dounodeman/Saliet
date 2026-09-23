import { TERRAIN_MODS, TERRAIN_NAMES, UNIT_TYPES, type TerrainMod, type TerrainName, type UnitType } from '../config';
import type { MapData } from './types';

export const Terrain = {
  Plains: 0,
  Forest: 1,
  Hills: 2,
  Water: 3,
  Mountains: 4,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_COUNT = 5;

const IMPASSABLE: TerrainMod = { speed: 0, damageDealt: 0, damageTaken: 1, staminaDrain: 1 };

/** MOD_TABLE[unitTypeIndex][terrain] */
const MOD_TABLE: Record<UnitType, TerrainMod[]> = {} as Record<UnitType, TerrainMod[]>;
for (const type of UNIT_TYPES) {
  MOD_TABLE[type] = TERRAIN_NAMES.map((name) => (name === 'mountains' ? IMPASSABLE : TERRAIN_MODS[name][type]));
}

export function terrainFromName(name: string): Terrain {
  const i = (TERRAIN_NAMES as readonly string[]).indexOf(name);
  if (i < 0) throw new Error(`Unknown terrain "${name}"`);
  return i as Terrain;
}

export function terrainName(t: Terrain): TerrainName {
  return TERRAIN_NAMES[t];
}

export function isPassable(t: number): boolean {
  return t !== Terrain.Mountains;
}

export function terrainMod(t: number, type: UnitType): TerrainMod {
  return MOD_TABLE[type][t] ?? IMPASSABLE;
}

/** Terrain at a world position; outside the map counts as mountains (impassable). */
export function terrainAt(map: MapData, x: number, y: number): Terrain {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return Terrain.Mountains;
  return map.terrain[cy * map.width + cx] as Terrain;
}

export function passableAt(map: MapData, x: number, y: number): boolean {
  return isPassable(terrainAt(map, x, y));
}

export function cellIndex(map: { width: number }, x: number, y: number): number {
  return Math.floor(y) * map.width + Math.floor(x);
}
