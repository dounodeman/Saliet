import { describe, expect, it } from 'vitest';
import { TERRAIN_MODS, UNIT_STATS } from '../src/config';
import { damagePerSecond } from '../src/sim/combat';
import { Terrain, isPassable, terrainAt, terrainMod } from '../src/sim/terrain';
import { mapFromRows } from './helpers';

describe('terrain modifiers', () => {
  it('reads modifiers from the config table', () => {
    expect(terrainMod(Terrain.Forest, 'light')).toBe(TERRAIN_MODS.forest.light);
    expect(terrainMod(Terrain.Water, 'heavy')).toBe(TERRAIN_MODS.water.heavy);
  });

  it('mountains are impassable, everything else passable', () => {
    expect(isPassable(Terrain.Mountains)).toBe(false);
    for (const t of [Terrain.Plains, Terrain.Forest, Terrain.Hills, Terrain.Water]) expect(isPassable(t)).toBe(true);
    expect(terrainMod(Terrain.Mountains, 'light').speed).toBe(0);
  });

  it('heavies are only effective on plains', () => {
    for (const t of [Terrain.Forest, Terrain.Hills, Terrain.Water]) {
      expect(terrainMod(t, 'heavy').speed).toBeLessThan(terrainMod(Terrain.Plains, 'heavy').speed);
      expect(terrainMod(t, 'heavy').damageDealt).toBeLessThan(1);
      expect(terrainMod(t, 'heavy').damageTaken).toBeGreaterThan(1);
    }
  });

  it('water is slow and weak for everyone', () => {
    for (const type of ['light', 'heavy'] as const) {
      const w = terrainMod(Terrain.Water, type);
      expect(w.speed).toBeLessThanOrEqual(0.35);
      expect(w.damageDealt).toBeLessThan(0.5);
      expect(w.damageTaken).toBeGreaterThan(1.5);
    }
  });

  it('forest and hills protect light infantry', () => {
    const plains = damagePerSecond('light', Terrain.Plains, 100, 'light', Terrain.Plains);
    expect(damagePerSecond('light', Terrain.Plains, 100, 'light', Terrain.Forest)).toBeLessThan(plains);
    expect(damagePerSecond('light', Terrain.Plains, 100, 'light', Terrain.Hills)).toBeLessThan(plains);
    expect(damagePerSecond('light', Terrain.Hills, 100, 'light', Terrain.Plains)).toBeGreaterThan(plains);
  });

  it('heavy beats light on plains but loses in forest', () => {
    const hl = damagePerSecond('heavy', Terrain.Plains, 100, 'light', Terrain.Plains);
    const lh = damagePerSecond('light', Terrain.Plains, 100, 'heavy', Terrain.Plains);
    // time for each to kill the other
    expect(UNIT_STATS.light.maxHp / hl).toBeLessThan(UNIT_STATS.heavy.maxHp / lh);
    const hlF = damagePerSecond('heavy', Terrain.Forest, 100, 'light', Terrain.Forest);
    const lhF = damagePerSecond('light', Terrain.Forest, 100, 'heavy', Terrain.Forest);
    // Two lights (the heavy's cost) in forest kill a heavy faster than it kills them.
    expect(UNIT_STATS.heavy.maxHp / (2 * lhF)).toBeLessThan((2 * UNIT_STATS.light.maxHp) / hlF);
  });

  it('terrainAt treats out-of-map as mountains', () => {
    const m = mapFromRows(['.f', 'h~']);
    expect(terrainAt(m, 0.5, 0.5)).toBe(Terrain.Plains);
    expect(terrainAt(m, 1.5, 0.5)).toBe(Terrain.Forest);
    expect(terrainAt(m, 0.2, 1.9)).toBe(Terrain.Hills);
    expect(terrainAt(m, 1.9, 1.9)).toBe(Terrain.Water);
    expect(terrainAt(m, -0.1, 0)).toBe(Terrain.Mountains);
    expect(terrainAt(m, 2, 0)).toBe(Terrain.Mountains);
  });
});
