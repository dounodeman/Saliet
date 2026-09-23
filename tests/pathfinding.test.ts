import { describe, expect, it } from 'vitest';
import { buildNavGrid, findPath, pathLength, segmentClear, snapToPassable } from '../src/sim/pathfinding';
import { terrainAt } from '../src/sim/terrain';
import type { Vec2 } from '../src/sim/types';
import { mapFromRows } from './helpers';

function walk(from: Vec2, path: Vec2[], step = 0.05): Vec2[] {
  const out: Vec2[] = [];
  let p = from;
  for (const q of path) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n });
    p = q;
  }
  return out;
}

describe('pathfinding', () => {
  const wall = mapFromRows([
    '..........',
    '....M.....',
    '....M.....',
    '....M.....',
    '....M.....',
    '....M.....',
    '..........',
  ]);

  it('goes straight on open ground', () => {
    const nav = buildNavGrid(mapFromRows(['..........', '..........', '..........']));
    const p = findPath(nav, 'light', 0.5, 1.5, 9.5, 1.5)!;
    expect(p).not.toBeNull();
    expect(p.length).toBe(1);
    expect(p[0]).toEqual({ x: 9.5, y: 1.5 });
  });

  it('routes around mountains and never enters them', () => {
    const nav = buildNavGrid(wall);
    const start = { x: 1.5, y: 3.5 };
    const p = findPath(nav, 'light', start.x, start.y, 8.5, 3.5)!;
    expect(p).not.toBeNull();
    expect(p[p.length - 1]).toEqual({ x: 8.5, y: 3.5 });
    for (const q of walk(start, p)) expect(terrainAt(wall, q.x, q.y)).not.toBe(4);
    expect(pathLength(start, p)).toBeGreaterThan(7);
  });

  it('returns null when the target is unreachable or impassable', () => {
    const sealed = mapFromRows(['..M..', '..M..', '..M..']);
    const nav = buildNavGrid(sealed);
    expect(findPath(nav, 'light', 0.5, 1.5, 4.5, 1.5)).toBeNull();
    expect(findPath(nav, 'light', 0.5, 1.5, 2.5, 1.5)).toBeNull();
  });

  it('prefers faster terrain: heavies detour around forest, lights too if cheap', () => {
    const m = mapFromRows([
      '............',
      '.ffffffffff.',
      '.ffffffffff.',
      '.ffffffffff.',
      '............',
    ]);
    const nav = buildNavGrid(m);
    const start = { x: 0.5, y: 2.5 };
    const heavy = findPath(nav, 'heavy', start.x, start.y, 11.5, 2.5)!;
    const forestSteps = walk(start, heavy).filter((q) => terrainAt(m, q.x, q.y) === 1).length;
    expect(forestSteps).toBe(0);
  });

  it('avoids swimming across a river when a bridge exists', () => {
    const m = mapFromRows([
      '.....~~.....',
      '.....~~.....',
      '.....~~.....',
      '.....~~.....',
      '............',
    ]);
    const nav = buildNavGrid(m);
    const start = { x: 1.5, y: 0.5 };
    const p = findPath(nav, 'light', start.x, start.y, 10.5, 0.5)!;
    const wet = walk(start, p).filter((q) => terrainAt(m, q.x, q.y) === 3).length;
    expect(wet).toBe(0);
  });

  it('smoothing never shortcuts through worse terrain', () => {
    const m = mapFromRows(['.....', '.fff.', '.....']);
    const nav = buildNavGrid(m);
    expect(segmentClear(nav, 'light', { x: 0.5, y: 1.5 }, { x: 4.5, y: 1.5 }, 1)).toBe(false);
    expect(segmentClear(nav, 'light', { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toBe(true);
  });

  it('snaps targets out of mountains to the nearest passable cell', () => {
    const nav = buildNavGrid(wall);
    const s = snapToPassable(nav, 4.5, 3.5);
    expect([3.5, 5.5]).toContain(s.x);
    expect(s.y).toBe(3.5);
  });
});
