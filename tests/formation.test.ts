import { describe, expect, it } from 'vitest';
import { assignSlots, groupMoveTargets, lineSlots, polylineLength, simplifyPolyline } from '../src/sim/formation';

describe('line formation', () => {
  it('spreads slots evenly along a straight line', () => {
    const slots = lineSlots([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
    expect(slots.map((s) => s.x)).toEqual([1, 3, 5, 7, 9]);
    expect(slots.every((s) => s.y === 0)).toBe(true);
  });

  it('spreads slots by arc length along a bent line', () => {
    const pts = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
    expect(polylineLength(pts)).toBe(8);
    const slots = lineSlots(pts, 4);
    expect(slots[0]).toEqual({ x: 1, y: 0 });
    expect(slots[1]).toEqual({ x: 3, y: 0 });
    expect(slots[2]).toEqual({ x: 4, y: 1 });
    expect(slots[3]).toEqual({ x: 4, y: 3 });
  });

  it('assigns units to slots without crossing', () => {
    // Units stacked in reverse order relative to the line.
    const units = [{ x: 9, y: 5 }, { x: 1, y: 5 }, { x: 5, y: 5 }];
    const slots = lineSlots([{ x: 0, y: 0 }, { x: 12, y: 0 }], 3);
    const a = assignSlots(units, slots, { x: 0, y: 0 }, { x: 12, y: 0 });
    expect(slots[a[1]].x).toBeLessThan(slots[a[2]].x);
    expect(slots[a[2]].x).toBeLessThan(slots[a[0]].x);
    expect(new Set(a).size).toBe(3);
  });

  it('group moves keep relative offsets but compress sprawl', () => {
    const t = groupMoveTargets([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 10, y: 10 });
    expect(t).toEqual([{ x: 9, y: 10 }, { x: 11, y: 10 }]);
    const far = groupMoveTargets([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 10, y: 10 });
    expect(Math.abs(far[1].x - far[0].x)).toBeLessThan(5);
  });

  it('simplifies nearly straight polylines', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: (i % 2) * 0.01 }));
    const s = simplifyPolyline(pts, 0.1);
    expect(s.length).toBe(2);
  });
});
