/**
 * Every tunable balance number in the game lives in this file.
 *
 * Units: distances are in map cells (1 cell = 1 world unit), times in seconds,
 * rates are per second unless the name says otherwise.
 */

/** Simulation ticks per second (fixed timestep). */
export const TICK_RATE = 20;
/** Seconds per simulation tick. */
export const DT = 1 / TICK_RATE;

export const UNIT_TYPES = ['light', 'heavy'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export interface UnitStats {
  maxHp: number;
  /** Damage per second against a target on neutral terrain, at full stamina. */
  dps: number;
  /** Cells per second on plains at full stamina. */
  speed: number;
  /** Collision radius in cells (also the drawn dot size). */
  radius: number;
  /** Production points needed to build one. */
  cost: number;
  /** Relative mass used when units shove each other apart. */
  mass: number;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  light: { maxHp: 100, dps: 10, speed: 1.8, radius: 0.42, cost: 30, mass: 1 },
  heavy: { maxHp: 250, dps: 22, speed: 1.1, radius: 0.56, cost: 70, mass: 2.5 },
};

export const TERRAIN_NAMES = ['plains', 'forest', 'hills', 'water', 'mountains'] as const;
export type TerrainName = (typeof TERRAIN_NAMES)[number];

export interface TerrainMod {
  /** Movement speed multiplier. */
  speed: number;
  /** Multiplier on damage this unit deals while standing here. */
  damageDealt: number;
  /** Multiplier on damage this unit takes while standing here (lower is better). */
  damageTaken: number;
  /** Multiplier on stamina drained while moving here. */
  staminaDrain: number;
}

/**
 * Terrain effects per unit type. Mountains are impassable and have no entry.
 * Heavies are only good on plains; everybody is slow and weak in water.
 */
export const TERRAIN_MODS: Record<Exclude<TerrainName, 'mountains'>, Record<UnitType, TerrainMod>> = {
  plains: {
    light: { speed: 1.0, damageDealt: 1.0, damageTaken: 1.0, staminaDrain: 1.0 },
    heavy: { speed: 1.0, damageDealt: 1.0, damageTaken: 1.0, staminaDrain: 1.0 },
  },
  forest: {
    light: { speed: 0.7, damageDealt: 1.0, damageTaken: 0.75, staminaDrain: 1.4 },
    heavy: { speed: 0.45, damageDealt: 0.45, damageTaken: 1.25, staminaDrain: 2.2 },
  },
  hills: {
    light: { speed: 0.75, damageDealt: 1.15, damageTaken: 0.8, staminaDrain: 1.6 },
    heavy: { speed: 0.5, damageDealt: 0.5, damageTaken: 1.2, staminaDrain: 2.4 },
  },
  water: {
    light: { speed: 0.3, damageDealt: 0.4, damageTaken: 1.6, staminaDrain: 3.0 },
    heavy: { speed: 0.22, damageDealt: 0.25, damageTaken: 1.9, staminaDrain: 4.0 },
  },
};

/**
 * Extra path-planning cost per terrain (on top of travel time). Units are weak in
 * water, so A* treats swimming as costlier than its slowness alone and prefers
 * fords unless the detour is long.
 */
export const PATH_COST_MULT: Record<Exclude<TerrainName, 'mountains'>, number> = {
  plains: 1,
  forest: 1,
  hills: 1,
  water: 2,
};

export const COMBAT = {
  /** Units fight when the gap between their edges is at most this many cells. */
  contactRange: 0.35,
  /** Speed multiplier while a unit is in contact with an enemy. */
  engagedSpeedMult: 0.25,
};

export const STAMINA = {
  max: 100,
  /** Drain per second while moving on plains (scaled by terrain staminaDrain). */
  moveDrain: 0.7,
  /** Drain per second while fighting. */
  fightDrain: 2.5,
  /** Regeneration per second while idle and supplied. */
  idleRegen: 4,
  /** Below this stamina, damage and speed start to drop. */
  lowThreshold: 40,
  /** Damage multiplier at zero stamina. */
  minDamageFactor: 0.45,
  /** Speed multiplier at zero stamina. */
  minSpeedFactor: 0.6,
};

export const HEALTH = {
  /** Fraction of max HP regenerated per second while idle and supplied. */
  idleRegenFrac: 0.012,
};

export const MOVEMENT = {
  /** Ticks of little progress near the goal before a unit considers itself arrived. */
  stallTicks: 16,
  /** "Near the goal" radius for the stall rule. */
  stallRadius: 3,
  /** Ticks of little progress anywhere before a unit re-plans its path. */
  repathTicks: 80,
  /** Separation relaxation passes per tick. */
  separationPasses: 2,
  /** Extra gap kept between unit edges. */
  separationGap: 0.04,
  /** Mass multiplier for units holding position (so movers flow around them). */
  holdMassMult: 3,
  /** Maximum A* searches per tick (the rest wait in a FIFO queue). */
  pathsPerTick: 24,
  /** Target spacing between units in a group move. */
  formationSpacing: 1.25,
  /** Idle units shoved farther than this from their hold point walk back. */
  holdSlack: 0.35,
  /** Speed multiplier while walking back to the hold point. */
  holdReturnSpeed: 0.5,
  /** Maximum queued waypoints per unit. */
  maxWaypoints: 16,
};

export const TERRITORY = {
  /** Territory updates every N ticks. */
  intervalTicks: 5,
  /** Radius (cells) in which a unit asserts presence. */
  unitRadius: 2.5,
  /** Radius (cells) in which an owned city asserts presence. */
  cityRadius: 5,
  /** Control gained (or removed from the previous owner) per second of uncontested presence. */
  gainPerSec: 0.6,
  /** Radius of territory each team owns around its cities at game start. */
  initialRadius: 11,
};

export const CITY = {
  /** Units within this radius count as holding the city. */
  captureRadius: 2.2,
  /** Seconds of uncontested holding needed to capture. */
  captureTime: 8,
  /** Capture progress lost per second when nobody is holding it. */
  captureDecayPerSec: 0.25,
  /** Production points per second per owned city. */
  ppPerSec: 0.8,
  /** Production points each team starts with. */
  startPP: 40,
  /** Maximum production queue length per team. */
  maxQueue: 12,
  /** Distance from the city centre where new units appear. */
  spawnOffset: 1.3,
};

export const SUPPLY = {
  /** Units supported per owned city. */
  perCity: 5,
  /** Supply network recomputed every N ticks. */
  intervalTicks: 10,
  /** Max supply "distance" from friendly territory connected to a friendly city. */
  range: 8,
  /** Supply distance cost of crossing a neutral cell. */
  costNeutral: 1,
  /** Supply distance cost of crossing an enemy cell. */
  costEnemy: 2,
  /** HP lost per second by units above the supply cap. */
  starveDps: 4,
  /** HP lost per second by units cut off from supply. */
  outOfSupplyDps: 1.5,
};

export const VICTORY = {
  /** Share of all cities a team must hold to win. */
  cityShare: 0.8,
};

export const GAME_SPEEDS = [0.5, 1, 2, 4] as const;
