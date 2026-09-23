import { UNIT_TYPES } from '../config';
import type { World } from './types';

/**
 * FNV-1a over every piece of logical simulation state, reading floats bit-for-bit.
 * Two worlds with the same hash are (for all practical purposes) identical —
 * used by determinism tests and, later, desync detection.
 */
export function hashWorld(world: World): string {
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  let h = 0x811c9dc5;
  const word = (w: number) => {
    h ^= w & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (w >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (w >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (w >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const num = (v: number) => {
    f64[0] = v;
    word(u32[0]);
    word(u32[1]);
  };

  num(world.tick);
  num(world.nextId);
  num(world.winner);
  for (let i = 0; i < 4; i++) word(world.rng[i]);
  num(world.units.length);
  for (const u of world.units) {
    num(u.id);
    num(u.team);
    num(UNIT_TYPES.indexOf(u.type));
    num(u.x);
    num(u.y);
    num(u.hp);
    num(u.stamina);
    num(u.targetId);
    num(u.pathIndex);
    num(u.stallTicks);
    num((u.supplied ? 1 : 0) | (u.starving ? 2 : 0) | (u.engaged ? 4 : 0) | (u.pathPending ? 8 : 0));
    num(u.waypoints.length);
    for (const w of u.waypoints) {
      num(w.x);
      num(w.y);
    }
    num(u.path ? u.path.length : -1);
  }
  for (const c of world.cities) {
    num(c.owner);
    num(c.captureTeam);
    num(c.captureProgress);
  }
  for (const t of world.teams) {
    num(t.pp);
    num(t.queue.length);
    for (const q of t.queue) {
      num(q.id);
      num(UNIT_TYPES.indexOf(q.type));
      num(q.cityId);
    }
    num(t.stats.produced);
    num(t.stats.lost);
    num(t.stats.citiesCaptured);
  }
  const terr = world.territory;
  for (let i = 0; i < terr.owner.length; i++) {
    word(terr.owner[i] & 0xff);
    num(terr.control[i]);
  }
  for (const id of world.pathQueue) num(id);
  return (h >>> 0).toString(16).padStart(8, '0');
}
