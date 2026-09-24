import { Terrain } from '../sim/terrain';
import { unitStrength } from '../sim/units';
import type { PlayerView, UnitView } from '../sim/view';
import type { Vec2 } from '../sim/types';

/** Sum of unit strengths of `team` within radius r, weighted toward the centre. */
export function strengthNear(units: readonly UnitView[], team: number, x: number, y: number, r: number): number {
  let s = 0;
  const r2 = r * r;
  for (const u of units) {
    if (u.team !== team) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    s += unitStrength(u) * (1 - 0.5 * (Math.sqrt(d2) / r));
  }
  return s;
}

/** Fraction of passable cells around a point that are plains (heavy-friendly ground). */
export function plainsFraction(view: PlayerView, x: number, y: number, r: number): number {
  const { map } = view;
  let plains = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(map.width - 1, Math.floor(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(map.height - 1, Math.floor(y + r));
  for (let cy = y0; cy <= y1; cy += 2) {
    for (let cx = x0; cx <= x1; cx += 2) {
      const t = map.terrain[cy * map.width + cx];
      if (t === Terrain.Mountains) continue;
      total++;
      if (t === Terrain.Plains) plains++;
    }
  }
  return total > 0 ? plains / total : 0;
}

export function centroid(pts: readonly Vec2[]): Vec2 | null {
  if (pts.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export interface FrontSector {
  /** Polyline (on our side of the border) for a line command. */
  line: Vec2[];
  center: Vec2;
  /** Number of border cells in the sector (its width). */
  size: number;
}

/**
 * The front: our territory cells touching enemy territory, split into sectors
 * along the axis perpendicular to "us → them". Each sector becomes a line our
 * units can hold, pulled back a little onto our own side.
 */
export function findFront(view: PlayerView, maxSectors: number): FrontSector[] {
  const { map, territory, team } = view;
  const W = map.width;
  const H = map.height;
  const foe = 1 - team;
  const cells: Vec2[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (territory[i] !== team || map.terrain[i] === Terrain.Mountains) continue;
      if (territory[i - 1] === foe || territory[i + 1] === foe || territory[i - W] === foe || territory[i + W] === foe) {
        cells.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  if (cells.length === 0) return [];
  const mine = centroid(view.cities.filter((c) => c.owner === team)) ?? centroid(cells)!;
  const theirs =
    centroid(view.cities.filter((c) => c.owner === foe)) ??
    centroid(view.units.filter((u) => u.team === foe)) ??
    { x: W - mine.x, y: H - mine.y };
  let ax = theirs.x - mine.x;
  let ay = theirs.y - mine.y;
  const len = Math.hypot(ax, ay) || 1;
  ax /= len;
  ay /= len;
  // Perpendicular axis along which the front runs.
  const px = -ay;
  const py = ax;
  cells.sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py) || a.x - b.x || a.y - b.y);
  const k = Math.max(1, Math.min(maxSectors, Math.round(cells.length / 14)));
  const sectors: FrontSector[] = [];
  const back = 1.2; // stand a little behind the border
  for (let s = 0; s < k; s++) {
    const chunk = cells.slice(Math.floor((s * cells.length) / k), Math.floor(((s + 1) * cells.length) / k));
    if (chunk.length === 0) continue;
    const pick = (p: Vec2) => ({ x: p.x - ax * back, y: p.y - ay * back });
    const line = [pick(chunk[0]), pick(chunk[Math.floor(chunk.length / 2)]), pick(chunk[chunk.length - 1])];
    sectors.push({ line, center: centroid(chunk)!, size: chunk.length });
  }
  return sectors;
}
