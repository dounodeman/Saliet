import { UNIT_STATS, type UnitType } from '../config';
import { supplyCap } from './supply';
import type { MapData, Vec2, World } from './types';

/**
 * What one player is allowed to know. Everything on the map is visible (there is
 * no fog of war), but the enemy's production points and queue are not. The AI
 * only ever sees this, never the World itself — adding fog later only means
 * filtering `units` here.
 */
export interface UnitView {
  id: number;
  team: number;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stamina: number;
  engaged: boolean;
  /** Own units only: final destination of the current orders, or null if idle. */
  dest: Vec2 | null;
  /** Own units only (the enemy's supply state isn't shown on screen). */
  supplied: boolean;
  starving: boolean;
}

export interface CityView {
  id: number;
  name: string;
  x: number;
  y: number;
  owner: number;
  captureTeam: number;
  captureProgress: number;
}

export interface PlayerView {
  team: number;
  tick: number;
  map: Readonly<MapData>;
  units: readonly UnitView[];
  cities: readonly CityView[];
  /** Territory owner per cell (read-only copy). */
  territory: Int8Array;
  pp: number;
  queue: ReadonlyArray<{ id: number; type: UnitType; cityId: number }>;
  supplyCap: number;
  unitCount: number;
}

export function makeView(world: World, team: number): PlayerView {
  const units: UnitView[] = world.units.map((u) => {
    const own = u.team === team;
    const last = u.waypoints[u.waypoints.length - 1];
    return {
      id: u.id,
      team: u.team,
      type: u.type,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: UNIT_STATS[u.type].maxHp,
      stamina: u.stamina,
      engaged: u.engaged,
      dest: own && last ? { x: last.x, y: last.y } : null,
      supplied: own ? u.supplied : true,
      starving: own ? u.starving : false,
    };
  });
  const t = world.teams[team];
  return {
    team,
    tick: world.tick,
    map: world.map,
    units,
    cities: world.cities.map((c) => ({ ...c })),
    territory: world.territory.owner.slice(),
    pp: t.pp,
    queue: t.queue.map((q) => ({ ...q })),
    supplyCap: supplyCap(world, team),
    unitCount: units.filter((u) => u.team === team).length,
  };
}
