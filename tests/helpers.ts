import type { UnitType } from '../src/config';
import { Terrain } from '../src/sim/terrain';
import type { CitySpec, MapData, Rules, Scenario, UnitSpec } from '../src/sim/types';
import { createWorld } from '../src/sim/world';

/** Builds a map from rows of characters: . plains, f forest, h hills, ~ water, M mountains. */
export function mapFromRows(rows: string[], name = 'test'): MapData {
  const H = rows.length;
  const W = rows[0].length;
  const terrain = new Uint8Array(W * H);
  const code: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    h: Terrain.Hills,
    '~': Terrain.Water,
    M: Terrain.Mountains,
  };
  rows.forEach((row, y) => {
    if (row.length !== W) throw new Error('ragged rows');
    for (let x = 0; x < W; x++) terrain[y * W + x] = code[row[x]];
  });
  return { name, width: W, height: H, terrain };
}

export function plainMap(w: number, h: number): MapData {
  return mapFromRows(Array.from({ length: h }, () => '.'.repeat(w)));
}

export function scenario(map: MapData, cities: CitySpec[], units: UnitSpec[]): Scenario {
  return { map, cities, units };
}

export function unit(team: number, type: UnitType, x: number, y: number): UnitSpec {
  return { team, type, x, y };
}

export function city(name: string, x: number, y: number, owner = -1): CitySpec {
  return { name, x, y, owner };
}

/**
 * A small world on plains with one city per team in the corners. By default it is
 * a sandbox (no victory checks, no supply) so unit-level behaviour can be tested
 * in isolation; pass `rules` to switch systems back on.
 */
export function smallWorld(
  units: UnitSpec[],
  opts: { w?: number; h?: number; seed?: number; map?: MapData; rules?: Partial<Rules>; cities?: CitySpec[] } = {},
) {
  const w = opts.w ?? 40;
  const h = opts.h ?? 30;
  const map = opts.map ?? plainMap(w, h);
  const cities = opts.cities ?? [city('A', 3, 3, 0), city('B', map.width - 3, map.height - 3, 1)];
  return createWorld(scenario(map, cities, units), opts.seed ?? 1, { victory: false, supply: false, ...opts.rules });
}
