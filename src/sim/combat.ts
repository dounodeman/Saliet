import { COMBAT, DT, STAMINA, UNIT_STATS, type UnitType } from '../config';
import type { SpatialHash } from './spatial';
import { terrainAt, terrainMod } from './terrain';
import type { Unit, World } from './types';

/** Damage multiplier from stamina: 1 above the low threshold, falling linearly to the minimum at 0. */
export function staminaDamageFactor(stamina: number): number {
  const f = Math.min(1, Math.max(0, stamina) / STAMINA.lowThreshold);
  return STAMINA.minDamageFactor + (1 - STAMINA.minDamageFactor) * f;
}

/** Speed multiplier from stamina (same shape as the damage factor). */
export function staminaSpeedFactor(stamina: number): number {
  const f = Math.min(1, Math.max(0, stamina) / STAMINA.lowThreshold);
  return STAMINA.minSpeedFactor + (1 - STAMINA.minSpeedFactor) * f;
}

/**
 * Damage per second an attacker deals to a defender, including both units'
 * terrain and the attacker's stamina.
 */
export function damagePerSecond(
  attackerType: UnitType,
  attackerTerrain: number,
  attackerStamina: number,
  defenderType: UnitType,
  defenderTerrain: number,
): number {
  return (
    UNIT_STATS[attackerType].dps *
    terrainMod(attackerTerrain, attackerType).damageDealt *
    staminaDamageFactor(attackerStamina) *
    terrainMod(defenderTerrain, defenderType).damageTaken
  );
}

/** Centre distance at which two units are in contact. */
export function contactDistance(a: UnitType, b: UnitType): number {
  return UNIT_STATS[a].radius + UNIT_STATS[b].radius + COMBAT.contactRange;
}

export function inContact(a: Unit, b: Unit): boolean {
  const r = contactDistance(a.type, b.type);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy <= r * r;
}

const MAX_CONTACT = UNIT_STATS.heavy.radius * 2 + COMBAT.contactRange;
const indexById = new Map<number, number>();

/**
 * Every unit attacks one enemy in contact (its previous target if still in
 * contact, else the nearest). All damage is gathered first and applied after,
 * so the result doesn't depend on iteration order.
 */
export function resolveCombat(world: World, hash: SpatialHash): void {
  const units = world.units;
  const n = units.length;
  hash.build(units);
  indexById.clear();
  for (let i = 0; i < n; i++) indexById.set(units[i].id, i);
  const damage = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const a = units[i];
    let best = -1;
    if (a.targetId >= 0) {
      const j = indexById.get(a.targetId);
      if (j !== undefined && units[j].team !== a.team && inContact(a, units[j])) best = j;
    }
    if (best < 0) {
      let bestD = Infinity;
      hash.query(a.x, a.y, MAX_CONTACT, (j) => {
        const b = units[j];
        if (b.team === a.team) return;
        const r = contactDistance(a.type, b.type);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && (d2 < bestD || (d2 === bestD && j < best))) {
          bestD = d2;
          best = j;
        }
      });
    }
    if (best >= 0) {
      const b = units[best];
      a.engaged = true;
      a.targetId = b.id;
      damage[best] +=
        damagePerSecond(a.type, terrainAt(world.map, a.x, a.y), a.stamina, b.type, terrainAt(world.map, b.x, b.y)) * DT;
    } else {
      a.engaged = false;
      a.targetId = -1;
    }
  }
  for (let i = 0; i < n; i++) units[i].hp -= damage[i];
}
