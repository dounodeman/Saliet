import { COMBAT, DT, MOVEMENT, UNIT_STATS } from '../config';
import { requestPath } from './commands';
import { staminaSpeedFactor } from './combat';
import { findPath, isPointPassable } from './pathfinding';
import type { SpatialHash } from './spatial';
import { terrainAt, terrainMod } from './terrain';
import type { Unit, World } from './types';
import { DIR8 } from './vec';

/** Plans paths for queued units, at most `pathsPerTick` per tick, FIFO. */
export function processPathQueue(world: World): void {
  let budget = MOVEMENT.pathsPerTick;
  while (budget > 0 && world.pathQueue.length > 0) {
    const id = world.pathQueue.shift()!;
    const u = world.unitById.get(id);
    if (!u || !u.pathPending) continue;
    u.pathPending = false;
    budget--;
    planPath(world, u);
  }
}

function planPath(world: World, u: Unit): void {
  while (u.waypoints.length > 0) {
    const wp = u.waypoints[0];
    const path = findPath(world.nav, u.type, u.x, u.y, wp.x, wp.y);
    if (path) {
      u.path = path;
      u.pathIndex = 0;
      u.stallTicks = 0;
      return;
    }
    u.waypoints.shift(); // unreachable: drop it and try the next one
  }
  u.path = null;
}

function arrive(world: World, u: Unit): void {
  u.waypoints.shift();
  u.path = null;
  u.pathIndex = 0;
  u.stallTicks = 0;
  if (u.waypoints.length > 0) requestPath(world, u);
}

export function unitSpeed(world: World, u: Unit): number {
  const t = terrainAt(world.map, u.x, u.y);
  let speed = UNIT_STATS[u.type].speed * terrainMod(t, u.type).speed * staminaSpeedFactor(u.stamina);
  if (u.engaged) speed *= COMBAT.engagedSpeedMult;
  return speed;
}

/** Advances every unit along its path. */
export function moveUnits(world: World): void {
  for (const u of world.units) {
    u.moving = false;
    if (!u.path || u.pathPending) {
      u.lastSpeed = 0;
      continue;
    }
    const speed = unitSpeed(world, u);
    u.lastSpeed = speed;
    let remaining = speed * DT;
    const path = u.path;
    while (remaining > 1e-9 && u.pathIndex < path.length) {
      const p = path[u.pathIndex];
      const dx = p.x - u.x;
      const dy = p.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= remaining) {
        u.x = p.x;
        u.y = p.y;
        remaining -= d;
        u.pathIndex++;
      } else {
        u.x += (dx / d) * remaining;
        u.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
    u.moving = true;
    if (u.pathIndex >= path.length) arrive(world, u);
  }
}

function isHolding(u: Unit): boolean {
  return u.engaged || (u.path === null && !u.pathPending);
}

const MAX_RADIUS = Math.max(UNIT_STATS.light.radius, UNIT_STATS.heavy.radius);

/**
 * Pushes overlapping units apart (heavier and position-holding units move
 * less), then slides units out of impassable terrain and keeps them on the map.
 */
export function separateUnits(world: World, hash: SpatialHash): void {
  const units = world.units;
  const n = units.length;
  const gap = MOVEMENT.separationGap;
  for (let pass = 0; pass < MOVEMENT.separationPasses; pass++) {
    hash.build(units);
    for (let i = 0; i < n; i++) {
      const a = units[i];
      const ra = UNIT_STATS[a.type].radius;
      const ma = UNIT_STATS[a.type].mass * (isHolding(a) ? MOVEMENT.holdMassMult : 1);
      hash.query(a.x, a.y, ra + MAX_RADIUS + gap, (j) => {
        if (j <= i) return;
        const b = units[j];
        const minD = ra + UNIT_STATS[b.type].radius + gap;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) return;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          const dir = DIR8[(a.id * 31 + b.id * 17) % 8];
          dx = dir.x;
          dy = dir.y;
          d = 1;
        } else {
          dx /= d;
          dy /= d;
        }
        const overlap = minD - Math.min(d, minD);
        const mb = UNIT_STATS[b.type].mass * (isHolding(b) ? MOVEMENT.holdMassMult : 1);
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        a.x -= dx * overlap * wa;
        a.y -= dy * overlap * wa;
        b.x += dx * overlap * wb;
        b.y += dy * overlap * wb;
      });
    }
  }
  const W = world.map.width;
  const H = world.map.height;
  for (const u of units) {
    const r = UNIT_STATS[u.type].radius;
    u.x = Math.min(W - r, Math.max(r, u.x));
    u.y = Math.min(H - r, Math.max(r, u.y));
    if (!isPointPassable(world.nav, u.x, u.y)) {
      if (isPointPassable(world.nav, u.x, u.prevY)) u.y = u.prevY;
      else if (isPointPassable(world.nav, u.prevX, u.y)) u.x = u.prevX;
      else {
        u.x = u.prevX;
        u.y = u.prevY;
      }
    }
  }
}

/**
 * Detects units that are not making progress. Near the goal (typically a crowd
 * at the destination) they count as arrived; elsewhere they re-plan.
 */
export function updateStall(world: World): void {
  for (const u of world.units) {
    if (!u.path || u.pathPending || u.engaged || u.waypoints.length === 0) {
      u.stallTicks = 0;
      continue;
    }
    const dx = u.x - u.prevX;
    const dy = u.y - u.prevY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (moved < u.lastSpeed * DT * 0.3) u.stallTicks++;
    else u.stallTicks = Math.max(0, u.stallTicks - 2);
    const wp = u.waypoints[0];
    const gx = wp.x - u.x;
    const gy = wp.y - u.y;
    const dGoal = Math.sqrt(gx * gx + gy * gy);
    if (dGoal < MOVEMENT.arriveEps) {
      arrive(world, u);
    } else if (u.stallTicks > MOVEMENT.stallTicks && dGoal < MOVEMENT.stallRadius) {
      arrive(world, u);
    } else if (u.stallTicks > MOVEMENT.repathTicks) {
      if (dGoal < MOVEMENT.stallRadius * 2) arrive(world, u);
      else requestPath(world, u);
    }
  }
}
