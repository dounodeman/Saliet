import { CITY, MOVEMENT, UNIT_TYPES, type UnitType } from '../config';
import { assignSlots, groupMoveTargets, lineSlots, polylineLength } from './formation';
import { snapToPassable } from './pathfinding';
import type { Unit, Vec2, World } from './types';

/**
 * Everything a player (human or AI) can do. Commands are plain JSON so they can
 * be logged for replays or sent over the network.
 */
export type Command =
  | { kind: 'move'; team: number; unitIds: number[]; x: number; y: number; queue?: boolean }
  | { kind: 'line'; team: number; unitIds: number[]; points: Array<[number, number]>; queue?: boolean }
  | { kind: 'halt'; team: number; unitIds: number[] }
  | { kind: 'produce'; team: number; unitType: UnitType; cityId: number }
  | { kind: 'cancel'; team: number; itemId: number };

const MAX_LINE_POINTS = 256;

/** Living units of `team` among `ids`, deduplicated and sorted by id. */
function ownUnits(world: World, team: number, ids: readonly number[]): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const u = world.unitById.get(id);
    if (u && u.team === team) out.push(u);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** Where a unit will be when its current orders finish (used for shift-queued orders). */
function plannedEnd(u: Unit): Vec2 {
  const last = u.waypoints[u.waypoints.length - 1];
  return last ? { x: last.x, y: last.y } : { x: u.x, y: u.y };
}

export function requestPath(world: World, u: Unit): void {
  u.path = null;
  u.pathIndex = 0;
  u.stallTicks = 0;
  if (!u.pathPending) {
    u.pathPending = true;
    world.pathQueue.push(u.id);
  }
}

function giveTarget(world: World, u: Unit, target: Vec2, queue: boolean): void {
  const p = snapToPassable(world.nav, target.x, target.y);
  if (!queue) {
    u.waypoints = [p];
    requestPath(world, u);
  } else if (u.waypoints.length < MOVEMENT.maxWaypoints) {
    u.waypoints.push(p);
    if (u.waypoints.length === 1) requestPath(world, u);
  }
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates and applies one command. Returns false if it was rejected. */
export function applyCommand(world: World, cmd: Command): boolean {
  if (!cmd || typeof cmd !== 'object') return false;
  if (!Number.isInteger(cmd.team) || cmd.team < 0 || cmd.team >= world.teams.length) return false;
  switch (cmd.kind) {
    case 'move': {
      if (!isFiniteNum(cmd.x) || !isFiniteNum(cmd.y) || !Array.isArray(cmd.unitIds)) return false;
      const units = ownUnits(world, cmd.team, cmd.unitIds);
      if (units.length === 0) return false;
      const queue = cmd.queue === true;
      const starts = units.map((u) => (queue ? plannedEnd(u) : { x: u.x, y: u.y }));
      const targets = groupMoveTargets(starts, { x: cmd.x, y: cmd.y });
      units.forEach((u, i) => giveTarget(world, u, targets[i], queue));
      return true;
    }
    case 'line': {
      if (!Array.isArray(cmd.points) || !Array.isArray(cmd.unitIds)) return false;
      const pts: Vec2[] = [];
      for (const p of cmd.points.slice(0, MAX_LINE_POINTS)) {
        if (!Array.isArray(p) || !isFiniteNum(p[0]) || !isFiniteNum(p[1])) return false;
        pts.push({ x: p[0], y: p[1] });
      }
      if (pts.length === 0) return false;
      const units = ownUnits(world, cmd.team, cmd.unitIds);
      if (units.length === 0) return false;
      const queue = cmd.queue === true;
      const starts = units.map((u) => (queue ? plannedEnd(u) : { x: u.x, y: u.y }));
      if (pts.length < 2 || polylineLength(pts) < 0.5) {
        const targets = groupMoveTargets(starts, pts[0]);
        units.forEach((u, i) => giveTarget(world, u, targets[i], queue));
        return true;
      }
      const slots = lineSlots(pts, units.length);
      const assignment = assignSlots(starts, slots, pts[0], pts[pts.length - 1]);
      units.forEach((u, i) => giveTarget(world, u, slots[assignment[i]], queue));
      return true;
    }
    case 'halt': {
      if (!Array.isArray(cmd.unitIds)) return false;
      const units = ownUnits(world, cmd.team, cmd.unitIds);
      for (const u of units) {
        u.waypoints = [];
        u.path = null;
        u.pathIndex = 0;
        u.stallTicks = 0;
      }
      return units.length > 0;
    }
    case 'produce': {
      if (!(UNIT_TYPES as readonly string[]).includes(cmd.unitType)) return false;
      const city = world.cities.find((c) => c.id === cmd.cityId);
      if (!city || city.owner !== cmd.team) return false;
      const team = world.teams[cmd.team];
      if (team.queue.length >= CITY.maxQueue) return false;
      team.queue.push({ id: world.nextId++, type: cmd.unitType, cityId: city.id });
      return true;
    }
    case 'cancel': {
      const team = world.teams[cmd.team];
      const i = team.queue.findIndex((q) => q.id === cmd.itemId);
      if (i < 0) return false;
      team.queue.splice(i, 1);
      return true;
    }
    default:
      return false;
  }
}
