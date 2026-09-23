import { MOVEMENT } from '../config';
import type { Vec2 } from './types';

/**
 * Group move: every unit keeps its offset from the group's centroid, but a
 * sprawling group is compressed to roughly `spacing * sqrt(n)` so a selection
 * spread across the map arrives as a compact blob in the same arrangement.
 */
export function groupMoveTargets(starts: readonly Vec2[], target: Vec2, spacing = MOVEMENT.formationSpacing): Vec2[] {
  const n = starts.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: target.x, y: target.y }];
  let cx = 0;
  let cy = 0;
  for (const p of starts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let maxR = 0;
  for (const p of starts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy));
  }
  const allowed = spacing * Math.sqrt(n) * 0.8;
  const scale = maxR > allowed ? allowed / maxR : 1;
  return starts.map((p) => ({ x: target.x + (p.x - cx) * scale, y: target.y + (p.y - cy) * scale }));
}

/** Total arc length of a polyline. */
export function polylineLength(points: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/** Point at arc-length distance `d` along the polyline. */
export function pointAlong(points: readonly Vec2[], d: number): Vec2 {
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  let remaining = d;
  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1].x;
    const ay = points[i - 1].y;
    const dx = points[i].x - ax;
    const dy = points[i].y - ay;
    const seg = Math.sqrt(dx * dx + dy * dy);
    if (remaining <= seg || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, remaining / seg)) : 0;
      return { x: ax + dx * t, y: ay + dy * t };
    }
    remaining -= seg;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

/** `n` slots spread evenly along the polyline (each in the middle of its share). */
export function lineSlots(points: readonly Vec2[], n: number): Vec2[] {
  if (n <= 0 || points.length === 0) return [];
  const len = polylineLength(points);
  const slots: Vec2[] = [];
  for (let i = 0; i < n; i++) slots.push(pointAlong(points, ((i + 0.5) / n) * len));
  return slots;
}

/**
 * Assigns units to slots so paths don't cross: both are sorted along the
 * line's main axis (first→last point) and paired in order. Returns, for each
 * unit index, the index of its slot.
 */
export function assignSlots(units: readonly Vec2[], slots: readonly Vec2[], axisFrom: Vec2, axisTo: Vec2): number[] {
  let ax = axisTo.x - axisFrom.x;
  let ay = axisTo.y - axisFrom.y;
  const len = Math.sqrt(ax * ax + ay * ay);
  if (len < 1e-9) {
    ax = 1;
    ay = 0;
  } else {
    ax /= len;
    ay /= len;
  }
  const proj = (p: Vec2) => p.x * ax + p.y * ay;
  const unitOrder = units.map((_, i) => i).sort((a, b) => proj(units[a]) - proj(units[b]) || a - b);
  // Slots are already ordered along the drawn line; the line's direction
  // decides which end is "first", so sort them by the same axis for robustness.
  const slotOrder = slots.map((_, i) => i).sort((a, b) => proj(slots[a]) - proj(slots[b]) || a - b);
  const result = new Array<number>(units.length);
  for (let k = 0; k < unitOrder.length; k++) result[unitOrder[k]] = slotOrder[k];
  return result;
}

/** Douglas–Peucker simplification (used to keep drawn lines short). */
export function simplifyPolyline(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const dx = points[b].x - ax;
    const dy = points[b].y - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = len2 > 0 ? ((points[i].x - ax) * dx + (points[i].y - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = points[i].x - (ax + dx * t);
      const ey = points[i].y - (ay + dy * t);
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance * tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
