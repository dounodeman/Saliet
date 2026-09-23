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
