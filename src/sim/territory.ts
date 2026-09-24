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
  if (smoothTerritory(t, step)) changed = true;
  if (fillEnclosed(t)) changed = true;
  if (changed) t.version++;
}

let visited = new Uint8Array(0);
const MAX_HOLE = 220;

/**
 * Neutral pockets completely enclosed by one team's land (not touching the map
 * edge, at most MAX_HOLE cells) are absorbed by that team — e.g. the forest a
 * column marched around.
 */
function fillEnclosed(t: Territory): boolean {
  const W = t.width;
  const H = t.height;
  const n = W * H;
  if (visited.length !== n) visited = new Uint8Array(n);
  else visited.fill(0);
  let changed = false;
  const stack: number[] = [];
  const comp: number[] = [];
  for (let start = 0; start < n; start++) {
    if (visited[start] || t.owner[start] !== NEUTRAL) continue;
    stack.push(start);
    visited[start] = 1;
    comp.length = 0;
    let border = 0;
    let edge = false;
    while (stack.length > 0) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % W;
      const y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j < 0) continue;
        const o = t.owner[j];
        if (o !== NEUTRAL) {
          border |= 1 << o;
        } else if (!visited[j]) {
          visited[j] = 1;
          stack.push(j);
        }
      }
    }
    if (edge || comp.length > MAX_HOLE || border === 0 || (border & (border - 1)) !== 0) continue;
    const team = 31 - Math.clz32(border);
    for (const i of comp) {
      if (presence[i] !== 0) continue;
      t.owner[i] = team;
      t.control[i] = 0.5;
      changed = true;
    }
  }
  return changed;
}

let snapshot = new Int8Array(0);

/**
 * Cells nobody is standing on follow their neighbourhood: a cell surrounded by
 * another team's land (5+ of 8 neighbours) drifts to that team, a neutral cell
 * with 5+ neighbours of one team is absorbed, and specks cut off in neutral land
 * fade. Thin trails left by raiders erode, holes fill in, and each side's land
 * stays a coherent region with a clear front line.
 */
function smoothTerritory(t: Territory, step: number): boolean {
  const W = t.width;
  const H = t.height;
  const n = W * H;
  if (snapshot.length !== n) snapshot = new Int8Array(n);
  snapshot.set(t.owner);
  let changed = false;
  const counts = [0, 0];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (presence[i] !== 0) continue;
      counts[0] = 0;
      counts[1] = 0;
      let neutral = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const o = snapshot[i + dy * W + dx];
          if (o === NEUTRAL) neutral++;
          else counts[o]++;
        }
      }
      const cur = snapshot[i];
      const major = counts[0] >= counts[1] ? 0 : 1;
      if (cur === NEUTRAL) {
        if (counts[major] >= 5) {
          t.owner[i] = major;
          t.control[i] = step;
          changed = true;
        }
      } else if (counts[cur] <= 2) {
        const other = 1 - cur;
        if (counts[other] >= 5 || neutral >= 6) {
          const c = t.control[i] - step;
          if (c <= 0) {
            t.owner[i] = counts[other] >= 5 ? other : NEUTRAL;
            t.control[i] = counts[other] >= 5 ? Math.min(1, -c) : 0;
          } else {
            t.control[i] = c;
          }
          changed = true;
        }
      }
    }
  }
  return changed;
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
