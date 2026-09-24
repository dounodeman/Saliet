import { CITY, UNIT_STATS } from '../config';
import { resolveCombat } from './combat';
import { applyCommand, type Command } from './commands';
import { moveUnits, processPathQueue, separateUnits, updateStall } from './movement';
import { buildNavGrid } from './pathfinding';
import { createRngState } from './rng';
import { SpatialHash } from './spatial';
import { createTerritory } from './territory';
import { NUM_TEAMS, type Scenario, type TeamState, type World } from './types';
import { createUnit, removeDeadUnits, updateConditions } from './units';

/** Derived, non-logical helpers kept next to the world (never hashed or serialized). */
const spatialByWorld = new WeakMap<World, SpatialHash>();

function spatialFor(world: World): SpatialHash {
  let h = spatialByWorld.get(world);
  if (!h) {
    const cell = Math.max(2, UNIT_STATS.heavy.radius * 4);
    h = new SpatialHash(world.map.width, world.map.height, cell);
    spatialByWorld.set(world, h);
  }
  return h;
}

export function createWorld(scenario: Scenario, seed: number): World {
  const map = scenario.map;
  const teams: TeamState[] = [];
  for (let t = 0; t < NUM_TEAMS; t++) {
    teams.push({ id: t, pp: CITY.startPP, queue: [], stats: { produced: 0, lost: 0, citiesCaptured: 0 } });
  }
  const world: World = {
    tick: 0,
    seed,
    rng: createRngState(seed),
    map,
    nav: buildNavGrid(map),
    units: [],
    unitById: new Map(),
    cities: scenario.cities.map((c, i) => ({
      id: i,
      name: c.name,
      x: c.x,
      y: c.y,
      owner: c.owner,
      captureTeam: -1,
      captureProgress: 0,
    })),
    teams,
    territory: createTerritory(map.width, map.height),
    supplyDist: teams.map(() => new Uint8Array(map.width * map.height)),
    nextId: 1,
    winner: -1,
    events: [],
    commandLog: [],
    pathQueue: [],
  };
  for (const u of scenario.units) createUnit(world, u.team, u.type, u.x, u.y);
  return world;
}

/**
 * Advances the simulation by one fixed tick. `commands` are applied first, in
 * the order given, and recorded in the command log.
 */
export function step(world: World, commands: readonly Command[] = []): void {
  world.events = [];
  if (world.winner !== -1) return;
  const hash = spatialFor(world);

  for (const cmd of commands) {
    world.commandLog.push({ tick: world.tick, cmd });
    applyCommand(world, cmd);
  }
  for (const u of world.units) {
    u.prevX = u.x;
    u.prevY = u.y;
  }

  processPathQueue(world);
  resolveCombat(world, hash);
  removeDeadUnits(world);
  moveUnits(world);
  separateUnits(world, hash);
  updateStall(world);
  updateConditions(world);
  removeDeadUnits(world);

  world.tick++;
}

/** Runs `n` ticks with no commands (tests and headless tools). */
export function run(world: World, n: number): void {
  for (let i = 0; i < n && world.winner === -1; i++) step(world);
}
