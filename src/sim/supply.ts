import { SUPPLY } from '../config';
import { NEUTRAL, type Unit, type World } from './types';

export function supplyCap(world: World, team: number): number {
  let owned = 0;
  for (const c of world.cities) if (c.owner === team) owned++;
  return owned * SUPPLY.perCity;
}

export function unitCount(world: World, team: number): number {
  let n = 0;
  for (const u of world.units) if (u.team === team) n++;
  return n;
}

/**
 * Supply distance per cell for one team: a bucketed 0‑1‑2 BFS from its cities,
 * free through its own territory, `costNeutral` per neutral cell and `costEnemy`
 * per enemy cell, blocked by mountains. Cells farther than SUPPLY.range are 255.
 */
export function computeSupplyDistance(world: World, team: number, out: Uint8Array): void {
  const { width: W, height: H } = world.map;
  const owner = world.territory.owner;
  const passable = world.nav.passable;
  const range = SUPPLY.range;
  out.fill(255);
  const buckets: number[][] = [];
  for (let d = 0; d <= range; d++) buckets.push([]);
  for (const c of world.cities) {
    if (c.owner !== team) continue;
    const i = Math.floor(c.y) * W + Math.floor(c.x);
    out[i] = 0;
    buckets[0].push(i);
  }
  for (let d = 0; d <= range; d++) {
    const bucket = buckets[d];
    for (let k = 0; k < bucket.length; k++) {
      const cell = bucket[k];
      if (out[cell] !== d) continue; // stale entry
      const cx = cell % W;
      const cy = (cell - cx) / W;
      for (let dir = 0; dir < 4; dir++) {
        const nx = dir === 0 ? cx + 1 : dir === 1 ? cx - 1 : cx;
        const ny = dir === 2 ? cy + 1 : dir === 3 ? cy - 1 : cy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (passable[n] === 0) continue;
        const o = owner[n];
        const nd = d + (o === team ? 0 : o === NEUTRAL ? SUPPLY.costNeutral : SUPPLY.costEnemy);
        if (nd <= range && nd < out[n]) {
          out[n] = nd;
          buckets[nd].push(n);
        }
      }
    }
  }
}

export function isSuppliedAt(world: World, team: number, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= world.map.width || cy >= world.map.height) return false;
  return world.supplyDist[team][cy * world.map.width + cx] <= SUPPLY.range;
}

/**
 * Recomputes the supply network and marks units that are cut off (`supplied`)
 * or above their team's supply cap (`starving`: the ones farthest from a
 * friendly city, newest first on ties).
 */
export function updateSupply(world: World): void {
  for (let t = 0; t < world.teams.length; t++) computeSupplyDistance(world, t, world.supplyDist[t]);
  for (const u of world.units) u.supplied = isSuppliedAt(world, u.team, u.x, u.y);

  for (let t = 0; t < world.teams.length; t++) {
    const mine: Unit[] = [];
    for (const u of world.units) {
      if (u.team === t) {
        u.starving = false;
        mine.push(u);
      }
    }
    const excess = mine.length - supplyCap(world, t);
    if (excess <= 0) continue;
    const cities = world.cities.filter((c) => c.owner === t);
    const distTo = new Map<number, number>();
    for (const u of mine) {
      let best = Infinity;
      for (const c of cities) best = Math.min(best, (c.x - u.x) * (c.x - u.x) + (c.y - u.y) * (c.y - u.y));
      distTo.set(u.id, best);
    }
    mine.sort((a, b) => distTo.get(b.id)! - distTo.get(a.id)! || b.id - a.id);
    for (let k = 0; k < excess; k++) mine[k].starving = true;
  }
}
