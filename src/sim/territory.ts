import { DT, TERRITORY } from '../config';
import { NEUTRAL, type Territory, type World } from './types';

export function createTerritory(width: number, height: number): Territory {
  const n = width * height;
  return {
    width,
    height,
    owner: new Int8Array(n).fill(NEUTRAL),
    control: new Float64Array(n),
    version: 0,
  };
}

/** Each owned city starts with the land around it (nearest city wins overlaps). */
export function initTerritory(world: World): void {
  const t = world.territory;
  const R2 = TERRITORY.initialRadius * TERRITORY.initialRadius;
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      let best = -1;
      let bestD = R2;
      for (const c of world.cities) {
        if (c.owner === NEUTRAL) continue;
        const dx = x + 0.5 - c.x;
        const dy = y + 0.5 - c.y;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = c.owner;
        }
      }
      const i = y * t.width + x;
      t.owner[i] = best;
      t.control[i] = best === NEUTRAL ? 0 : 1;
    }
  }
  t.version++;
}

let presence = new Uint8Array(0);

function stamp(t: Territory, cx: number, cy: number, r: number, bit: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(t.width - 1, Math.floor(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(t.height - 1, Math.floor(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) presence[y * t.width + x] |= bit;
    }
  }
}

/**
 * Units (and owned cities) assert presence around themselves. A cell with
 * presence from exactly one team drifts toward that team: its current owner's
 * control is drained first, then the cell flips. Contested and empty cells
 * keep their state, so the border settles exactly where armies meet.
 */
export function updateTerritory(world: World): void {
  const t = world.territory;
  const n = t.width * t.height;
  if (presence.length !== n) presence = new Uint8Array(n);
  else presence.fill(0);
  for (const u of world.units) stamp(t, u.x, u.y, TERRITORY.unitRadius, 1 << u.team);
  for (const c of world.cities) {
    if (c.owner !== NEUTRAL) stamp(t, c.x, c.y, TERRITORY.cityRadius, 1 << c.owner);
  }
  const step = TERRITORY.gainPerSec * TERRITORY.intervalTicks * DT;
  let changed = false;
  for (let i = 0; i < n; i++) {
    const p = presence[i];
    if (p === 0 || (p & (p - 1)) !== 0) continue; // nobody, or contested
    const team = 31 - Math.clz32(p);
    if (t.owner[i] === team) {
      if (t.control[i] < 1) {
        t.control[i] = Math.min(1, t.control[i] + step);
        changed = true;
      }
    } else {
      const c = t.control[i] - step;
      if (c <= 0) {
        t.owner[i] = team;
        t.control[i] = Math.min(1, -c);
      } else {
        t.control[i] = c;
      }
      changed = true;
    }
  }
  if (changed) t.version++;
}

export function territoryOwnerAt(t: Territory, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= t.width || cy >= t.height) return NEUTRAL;
  return t.owner[cy * t.width + cx];
}

/** Cells owned per team. */
export function territoryCounts(t: Territory, teams: number): number[] {
  const counts = new Array<number>(teams).fill(0);
  for (let i = 0; i < t.owner.length; i++) {
    const o = t.owner[i];
    if (o >= 0) counts[o]++;
  }
  return counts;
}
