import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/maps';
import { rasterizeMapDef, validateMapDef } from '../src/sim/mapdef';
import { generateScenario } from '../src/sim/mapgen';
import { buildNavGrid, reachableCells } from '../src/sim/pathfinding';
import { Terrain } from '../src/sim/terrain';
import type { Scenario } from '../src/sim/types';

function checkPlayable(sc: Scenario) {
  const nav = buildNavGrid(sc.map);
  const cap = sc.cities.find((c) => c.owner === 0)!;
  const reach = reachableCells(nav, cap.x, cap.y);
  for (const c of sc.cities) {
    expect(reach[Math.floor(c.y) * sc.map.width + Math.floor(c.x)], `city ${c.name} reachable`).toBe(1);
  }
  expect(sc.cities.some((c) => c.owner === 0)).toBe(true);
  expect(sc.cities.some((c) => c.owner === 1)).toBe(true);
  expect(sc.units.some((u) => u.team === 0)).toBe(true);
  expect(sc.units.some((u) => u.team === 1)).toBe(true);
}

function isPointSymmetric(sc: Scenario): boolean {
  const t = sc.map.terrain;
  for (let i = 0; i < t.length; i++) if (t[i] !== t[t.length - 1 - i]) return false;
  return true;
}

describe('map definitions', () => {
  it('rasterizes regions in order onto the base terrain', () => {
    const sc = rasterizeMapDef(
      validateMapDef({
        name: 't',
        width: 20,
        height: 20,
        base: 'plains',
        regions: [
          { terrain: 'forest', rect: [0, 0, 10, 20] },
          { terrain: 'water', circle: [5, 5, 2] },
          { terrain: 'mountains', polygon: [[12, 12], [18, 12], [18, 18], [12, 18]] },
          { terrain: 'hills', path: [[0, 15], [10, 15]], width: 2 },
        ],
        cities: [{ name: 'c', x: 15, y: 5, owner: 0 }],
        units: [],
      }),
    );
    const at = (x: number, y: number) => sc.map.terrain[y * 20 + x];
    expect(at(8, 1)).toBe(Terrain.Forest);
    expect(at(5, 5)).toBe(Terrain.Water);
    expect(at(15, 15)).toBe(Terrain.Mountains);
    expect(at(3, 15)).toBe(Terrain.Hills);
    expect(at(15, 1)).toBe(Terrain.Plains);
  });

  it('keeps city surroundings passable', () => {
    const sc = rasterizeMapDef(
      validateMapDef({
        name: 't',
        width: 20,
        height: 20,
        base: 'mountains',
        regions: [],
        cities: [{ name: 'c', x: 10, y: 10 }],
        units: [],
      }),
    );
    expect(sc.map.terrain[10 * 20 + 10]).toBe(Terrain.Plains);
  });

  it('rejects malformed maps with a readable error', () => {
    expect(() => validateMapDef({ name: 'x', width: 10, height: 10 })).toThrow(/Invalid map/);
    expect(() =>
      validateMapDef({ name: 'x', width: 30, height: 30, base: 'lava', regions: [], cities: [], units: [] }),
    ).toThrow(/base terrain/);
  });

  for (const entry of MAPS.filter((m) => m.id !== 'random')) {
    it(`${entry.name} is playable and symmetric`, () => {
      const sc = entry.build(1);
      checkPlayable(sc);
      expect(isPointSymmetric(sc)).toBe(true);
      expect(sc.cities.length).toBeGreaterThanOrEqual(10);
    });
  }
});

describe('procedural generator', () => {
  it('is deterministic per seed', () => {
    const a = generateScenario(42);
    const b = generateScenario(42);
    expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
    expect(a.cities).toEqual(b.cities);
    const c = generateScenario(43);
    expect(Array.from(c.map.terrain)).not.toEqual(Array.from(a.map.terrain));
  });

  it('produces playable, symmetric maps across many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sc = generateScenario(seed);
      checkPlayable(sc);
      expect(isPointSymmetric(sc)).toBe(true);
      expect(sc.cities.length).toBeGreaterThanOrEqual(8);
    }
  });
});
