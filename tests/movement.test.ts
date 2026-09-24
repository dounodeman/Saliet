import { describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../src/config';
import { step } from '../src/sim/world';
import { mapFromRows, smallWorld, unit } from './helpers';

describe('movement', () => {
  it('moves a unit to its target at the configured speed', () => {
    const w = smallWorld([unit(0, 'light', 5.5, 10.5)]);
    const u = w.units[0];
    step(w, [{ kind: 'move', team: 0, unitIds: [u.id], x: 15.5, y: 10.5 }]);
    // Paths are planned on the tick the order arrives, so that tick moves too: 20 ticks = 1 s.
    for (let i = 0; i < 19; i++) step(w);
    expect(u.x).toBeCloseTo(5.5 + UNIT_STATS.light.speed, 1);
    for (let i = 0; i < 200; i++) step(w);
    expect(u.x).toBeCloseTo(15.5, 5);
    expect(u.waypoints.length).toBe(0);
  });

  it('ignores commands for units of another team', () => {
    const w = smallWorld([unit(1, 'light', 5.5, 10.5)]);
    const u = w.units[0];
    step(w, [{ kind: 'move', team: 0, unitIds: [u.id], x: 15.5, y: 10.5 }]);
    for (let i = 0; i < 40; i++) step(w);
    expect(u.x).toBe(5.5);
  });

  it('forest slows units down', () => {
    const rows = Array.from({ length: 20 }, () => 'f'.repeat(40));
    const w = smallWorld([unit(0, 'light', 5.5, 10.5)], { map: mapFromRows(rows) });
    const u = w.units[0];
    step(w, [{ kind: 'move', team: 0, unitIds: [u.id], x: 30.5, y: 10.5 }]);
    for (let i = 0; i < 19; i++) step(w);
    expect(u.x - 5.5).toBeCloseTo(UNIT_STATS.light.speed * 0.7, 1);
  });

  it('queued waypoints are visited in order', () => {
    const w = smallWorld([unit(0, 'light', 5.5, 5.5)]);
    const u = w.units[0];
    step(w, [
      { kind: 'move', team: 0, unitIds: [u.id], x: 10.5, y: 5.5 },
      { kind: 'move', team: 0, unitIds: [u.id], x: 10.5, y: 15.5, queue: true },
    ]);
    expect(u.waypoints.length).toBe(2);
    let reachedFirst = false;
    for (let i = 0; i < 400; i++) {
      step(w);
      if (Math.abs(u.x - 10.5) < 0.05 && Math.abs(u.y - 5.5) < 0.05) reachedFirst = true;
    }
    expect(reachedFirst).toBe(true);
    expect(u.x).toBeCloseTo(10.5, 3);
    expect(u.y).toBeCloseTo(15.5, 3);
  });

  it('halt clears orders', () => {
    const w = smallWorld([unit(0, 'light', 5.5, 5.5)]);
    const u = w.units[0];
    step(w, [{ kind: 'move', team: 0, unitIds: [u.id], x: 30.5, y: 5.5 }]);
    for (let i = 0; i < 10; i++) step(w);
    step(w, [{ kind: 'halt', team: 0, unitIds: [u.id] }]);
    const x = u.x;
    for (let i = 0; i < 20; i++) step(w);
    expect(u.x).toBe(x);
  });
});

describe('collision and formations', () => {
  function minGap(w: ReturnType<typeof smallWorld>): number {
    let min = Infinity;
    for (let i = 0; i < w.units.length; i++) {
      for (let j = i + 1; j < w.units.length; j++) {
        const a = w.units[i];
        const b = w.units[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - UNIT_STATS[a.type].radius - UNIT_STATS[b.type].radius;
        min = Math.min(min, gap);
      }
    }
    return min;
  }

  it('units ordered to the same point spread out instead of stacking', () => {
    const units = Array.from({ length: 12 }, (_, i) => unit(0, i % 4 === 0 ? 'heavy' : 'light', 5 + (i % 4) * 1.2, 5 + Math.floor(i / 4) * 1.2));
    const w = smallWorld(units);
    const ids = w.units.map((u) => u.id);
    step(w, [{ kind: 'move', team: 0, unitIds: ids, x: 25, y: 15 }]);
    for (let i = 0; i < 400; i++) step(w);
    expect(minGap(w)).toBeGreaterThan(-0.05);
    // Everyone arrived (stopped) near the target.
    for (const u of w.units) {
      expect(u.waypoints.length).toBe(0);
      expect(Math.hypot(u.x - 25, u.y - 15)).toBeLessThan(5);
    }
  });

  it('stacked units are pushed apart deterministically', () => {
    const w = smallWorld([unit(0, 'light', 10, 10), unit(0, 'light', 10, 10), unit(0, 'light', 10, 10)]);
    for (let i = 0; i < 40; i++) step(w);
    expect(minGap(w)).toBeGreaterThan(-0.05);
  });

  it('separation never pushes units into mountains', () => {
    const rows = Array.from({ length: 20 }, (_, y) => (y === 10 ? '.'.repeat(40) : 'M'.repeat(40)));
    const w = smallWorld(
      Array.from({ length: 8 }, (_, i) => unit(0, 'light', 10 + i * 0.3, 10.5)),
      { map: mapFromRows(rows) },
    );
    for (let i = 0; i < 60; i++) step(w);
    for (const u of w.units) expect(Math.floor(u.y)).toBe(10);
  });

  it('the line command spreads units evenly along the drawn line', () => {
    const units = Array.from({ length: 6 }, (_, i) => unit(0, 'light', 5 + i, 5));
    const w = smallWorld(units);
    const ids = w.units.map((u) => u.id);
    step(w, [{ kind: 'line', team: 0, unitIds: ids, points: [[20, 5], [20, 25]] }]);
    for (let i = 0; i < 600; i++) step(w);
    const ys = w.units.map((u) => u.y).sort((a, b) => a - b);
    for (const u of w.units) expect(u.x).toBeCloseTo(20, 0);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    for (const g of gaps) expect(g).toBeGreaterThan(2.5);
    expect(ys[0]).toBeLessThan(8);
    expect(ys[5]).toBeGreaterThan(22);
  });

  it('shift-queued line orders run after the current order', () => {
    const w = smallWorld([unit(0, 'light', 5, 5), unit(0, 'light', 6, 5)]);
    const ids = w.units.map((u) => u.id);
    step(w, [
      { kind: 'move', team: 0, unitIds: ids, x: 10, y: 5 },
      { kind: 'line', team: 0, unitIds: ids, points: [[15, 10], [15, 20]], queue: true },
    ]);
    for (const u of w.units) expect(u.waypoints.length).toBe(2);
    for (let i = 0; i < 600; i++) step(w);
    for (const u of w.units) expect(u.x).toBeCloseTo(15, 0);
  });
});

describe('holding position', () => {
  it('an idle unit shoved out of place walks back to its spot', () => {
    const w = smallWorld([unit(0, 'light', 10, 10)]);
    const u = w.units[0];
    u.x = 11.5;
    for (let i = 0; i < 60; i++) step(w);
    expect(Math.hypot(u.x - 10, u.y - 10)).toBeLessThan(0.4);
  });

  it('a unit passing through a line does not permanently break it', () => {
    const line = Array.from({ length: 5 }, (_, i) => unit(0, 'light', 20, 10 + i));
    const w = smallWorld([...line, unit(0, 'heavy', 14, 12)]);
    const heavy = w.units[w.units.length - 1];
    const before = w.units.slice(0, 5).map((u) => ({ x: u.x, y: u.y }));
    step(w, [{ kind: 'move', team: 0, unitIds: [heavy.id], x: 28, y: 12 }]);
    for (let i = 0; i < 500; i++) step(w);
    w.units.slice(0, 5).forEach((u, i) => expect(Math.hypot(u.x - before[i].x, u.y - before[i].y)).toBeLessThan(0.45));
  });
});
