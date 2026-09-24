import { CITY, DT, UNIT_STATS, type UnitType } from '../config';
import { NEUTRAL, type City, type World } from './types';
import { createUnit } from './units';
import { DIR8 } from './vec';

/**
 * A city is captured by holding it (units within the capture radius) with no
 * enemy units there for CAPTURE_TIME seconds. Progress freezes while contested
 * and decays while nobody holds it.
 */
export function updateCities(world: World): void {
  const r2 = CITY.captureRadius * CITY.captureRadius;
  for (const c of world.cities) {
    let present = 0;
    for (const u of world.units) {
      const dx = u.x - c.x;
      const dy = u.y - c.y;
      if (dx * dx + dy * dy <= r2) present |= 1 << u.team;
    }
    const single = present !== 0 && (present & (present - 1)) === 0;
    if (single) {
      const team = 31 - Math.clz32(present);
      if (c.owner === team) {
        decay(c);
      } else {
        if (c.captureTeam !== team) {
          c.captureTeam = team;
          c.captureProgress = 0;
        }
        c.captureProgress += DT / CITY.captureTime;
        if (c.captureProgress >= 1) {
          const prev = c.owner;
          c.owner = team;
          c.captureTeam = NEUTRAL;
          c.captureProgress = 0;
          world.teams[team].stats.citiesCaptured++;
          world.events.push({ kind: 'capture', cityId: c.id, team, prevOwner: prev });
        }
      }
    } else if (present === 0) {
      decay(c);
    }
    // contested: progress frozen
  }
}

function decay(c: City): void {
  if (c.captureProgress <= 0) return;
  c.captureProgress = Math.max(0, c.captureProgress - CITY.captureDecayPerSec * DT);
  if (c.captureProgress === 0) c.captureTeam = NEUTRAL;
}

export function citiesOwnedBy(world: World, team: number): City[] {
  return world.cities.filter((c) => c.owner === team);
}

/** Nearest city owned by `team` to a point, or undefined. */
export function nearestOwnedCity(world: World, team: number, x: number, y: number): City | undefined {
  let best: City | undefined;
  let bestD = Infinity;
  for (const c of world.cities) {
    if (c.owner !== team) continue;
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Cities feed production points into their owner's pool; the head of each
 * team's queue is built as soon as it is affordable, at its chosen city (or the
 * nearest owned city if that one was lost).
 */
export function updateProduction(world: World): void {
  for (const team of world.teams) {
    let owned = 0;
    for (const c of world.cities) if (c.owner === team.id) owned++;
    team.pp += CITY.ppPerSec * owned * DT;
    const item = team.queue[0];
    if (!item) continue;
    const cost = UNIT_STATS[item.type].cost;
    if (team.pp < cost) continue;
    const wanted = world.cities.find((c) => c.id === item.cityId);
    let city = wanted && wanted.owner === team.id ? wanted : undefined;
    if (!city && wanted) city = nearestOwnedCity(world, team.id, wanted.x, wanted.y);
    if (!city) continue;
    team.pp -= cost;
    team.queue.shift();
    spawnAtCity(world, team.id, item.type, city);
  }
}

export function spawnAtCity(world: World, team: number, type: UnitType, city: City): void {
  const stats = world.teams[team].stats;
  // Rotate through spawn spots; team 1 uses the point-mirrored directions so
  // neither side systematically spawns closer to the front.
  const dir = DIR8[(stats.produced * 3 + team * 4) % 8];
  const u = createUnit(world, team, type, city.x + dir.x * CITY.spawnOffset, city.y + dir.y * CITY.spawnOffset);
  stats.produced++;
  world.events.push({ kind: 'spawn', unitId: u.id, team, type, x: u.x, y: u.y });
}
