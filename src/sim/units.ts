import { DT, HEALTH, STAMINA, SUPPLY, UNIT_STATS, type UnitType } from '../config';
import { staminaDamageFactor } from './combat';
import { snapToPassable } from './pathfinding';
import { terrainAt, terrainMod } from './terrain';
import type { Unit, World } from './types';

export function createUnit(world: World, team: number, type: UnitType, x: number, y: number): Unit {
  const p = snapToPassable(world.nav, x, y);
  const u: Unit = {
    id: world.nextId++,
    team,
    type,
    x: p.x,
    y: p.y,
    prevX: p.x,
    prevY: p.y,
    hp: UNIT_STATS[type].maxHp,
    stamina: STAMINA.max,
    waypoints: [],
    path: null,
    pathIndex: 0,
    pathPending: false,
    stallTicks: 0,
    lastSpeed: 0,
    moving: false,
    engaged: false,
    targetId: -1,
    supplied: true,
    starving: false,
  };
  // Ids only ever increase, so pushing keeps world.units sorted by id.
  world.units.push(u);
  world.unitById.set(u.id, u);
  return u;
}

/** Removes units with hp <= 0, emitting death events. */
export function removeDeadUnits(world: World): void {
  let any = false;
  for (const u of world.units) {
    if (u.hp <= 0) {
      any = true;
      break;
    }
  }
  if (!any) return;
  world.units = world.units.filter((u) => {
    if (u.hp > 0) return true;
    world.unitById.delete(u.id);
    world.teams[u.team].stats.lost++;
    world.events.push({ kind: 'death', unitId: u.id, team: u.team, type: u.type, x: u.x, y: u.y });
    return false;
  });
}

/** Stamina drain/regeneration, health regeneration, starvation and supply attrition. */
export function updateConditions(world: World): void {
  for (const u of world.units) {
    const stats = UNIT_STATS[u.type];
    if (u.moving) {
      const t = terrainAt(world.map, u.x, u.y);
      u.stamina -= STAMINA.moveDrain * terrainMod(t, u.type).staminaDrain * DT;
    }
    if (u.engaged) u.stamina -= STAMINA.fightDrain * DT;
    const resting = !u.moving && !u.engaged;
    if (resting && u.supplied && !u.starving) {
      u.stamina += STAMINA.idleRegen * DT;
      u.hp += HEALTH.idleRegenFrac * stats.maxHp * DT;
    }
    if (u.starving) u.hp -= SUPPLY.starveDps * DT;
    if (!u.supplied) u.hp -= SUPPLY.outOfSupplyDps * DT;
    if (u.stamina < 0) u.stamina = 0;
    if (u.stamina > STAMINA.max) u.stamina = STAMINA.max;
    if (u.hp > stats.maxHp) u.hp = stats.maxHp;
  }
}

/** Rough combat value of a unit (used by the AI and HUD). */
export function unitStrength(u: Pick<Unit, 'type' | 'hp' | 'stamina'>): number {
  const stats = UNIT_STATS[u.type];
  return (stats.dps / UNIT_STATS.light.dps) * (u.hp / UNIT_STATS.light.maxHp) * staminaDamageFactor(u.stamina);
}
