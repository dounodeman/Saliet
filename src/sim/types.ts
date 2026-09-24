import type { UnitType } from '../config';
import type { NavGrid } from './pathfinding';
import type { Command } from './commands';

export interface Vec2 {
  x: number;
  y: number;
}

export const NEUTRAL = -1;
export const NUM_TEAMS = 2;

export interface Unit {
  id: number;
  team: number;
  type: UnitType;
  x: number;
  y: number;
  /** Position at the start of the current tick (for render interpolation and collision rollback). */
  prevX: number;
  prevY: number;
  hp: number;
  stamina: number;
  /** Where an idle unit stands; it drifts back here after being shoved. */
  holdX: number;
  holdY: number;
  /** Remaining order targets; waypoints[0] is the one being walked to. */
  waypoints: Vec2[];
  /** Path to waypoints[0] (not including the start point); null until planned. */
  path: Vec2[] | null;
  pathIndex: number;
  /** True while the unit waits in the path-planning queue. */
  pathPending: boolean;
  /** Consecutive ticks with little progress while ordered to move. */
  stallTicks: number;
  /** Speed the unit tried to move at last tick (cells/s). */
  lastSpeed: number;
  /** Moved this tick. */
  moving: boolean;
  /** In contact with an enemy this tick. */
  engaged: boolean;
  /** Id of the enemy being attacked, or -1. */
  targetId: number;
  /** Connected to a friendly city through friendly territory. */
  supplied: boolean;
  /** Above the team's supply cap and starving. */
  starving: boolean;
}

export interface City {
  id: number;
  name: string;
  x: number;
  y: number;
  owner: number;
  /** Team currently capturing, or NEUTRAL. */
  captureTeam: number;
  /** 0..1 */
  captureProgress: number;
}

export interface ProductionItem {
  id: number;
  type: UnitType;
  cityId: number;
}

export interface TeamStats {
  produced: number;
  lost: number;
  citiesCaptured: number;
}

export interface TeamState {
  id: number;
  pp: number;
  queue: ProductionItem[];
  stats: TeamStats;
}

export interface MapData {
  name: string;
  width: number;
  height: number;
  /** Terrain per cell, row-major (index = y * width + x). */
  terrain: Uint8Array;
}

export interface Territory {
  width: number;
  height: number;
  /** Owning team per cell, NEUTRAL if none. */
  owner: Int8Array;
  /** Strength of the owner's hold, 0..1. */
  control: Float64Array;
  /** Incremented whenever the grid changes (lets renderers cache). */
  version: number;
}

export interface CitySpec {
  name: string;
  x: number;
  y: number;
  owner: number;
}

export interface UnitSpec {
  team: number;
  type: UnitType;
  x: number;
  y: number;
}

/** A complete starting setup: terrain + cities + starting armies. */
export interface Scenario {
  map: MapData;
  cities: CitySpec[];
  units: UnitSpec[];
}

export type SimEvent =
  | { kind: 'spawn'; unitId: number; team: number; type: UnitType; x: number; y: number }
  | { kind: 'death'; unitId: number; team: number; type: UnitType; x: number; y: number }
  | { kind: 'capture'; cityId: number; team: number; prevOwner: number }
  | { kind: 'victory'; team: number; reason: 'cities' | 'elimination' | 'draw' };

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

/** Rule switches (all on in real matches; tests and sandboxes can turn some off). */
export interface Rules {
  /** Check win conditions. */
  victory: boolean;
  /** Supply network, supply cap and starvation. */
  supply: boolean;
}

export const DEFAULT_RULES: Rules = { victory: true, supply: true };

export interface World {
  tick: number;
  rules: Rules;
  seed: number;
  /** sfc32 state; the only source of randomness in the simulation. */
  rng: Uint32Array;
  map: MapData;
  /** Derived navigation data (not part of the logical state). */
  nav: NavGrid;
  /** Living units, always sorted by id. */
  units: Unit[];
  unitById: Map<number, Unit>;
  cities: City[];
  teams: TeamState[];
  territory: Territory;
  /** Per team: supply distance per cell (255 = unreachable). */
  supplyDist: Uint8Array[];
  nextId: number;
  /** -1 while the game runs; team index when won; -2 for a draw. */
  winner: number;
  /** Events produced during the last step. */
  events: SimEvent[];
  /** Every command applied, with the tick it was applied on (a replay). */
  commandLog: LoggedCommand[];
  /** Unit ids waiting for path planning, FIFO. */
  pathQueue: number[];
}
