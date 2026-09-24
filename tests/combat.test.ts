import { describe, expect, it } from 'vitest';
import { COMBAT, DT, STAMINA, UNIT_STATS } from '../src/config';
import { contactDistance, damagePerSecond, staminaDamageFactor, staminaSpeedFactor } from '../src/sim/combat';
import { Terrain, terrainMod } from '../src/sim/terrain';
import { step } from '../src/sim/world';
import { mapFromRows, smallWorld, unit } from './helpers';

const LIGHT_GAP = UNIT_STATS.light.radius * 2 + 0.2; // centre distance that is in contact

describe('combat math', () => {
  it('stamina factor is 1 above the threshold and falls linearly to the minimum', () => {
    expect(staminaDamageFactor(100)).toBe(1);
    expect(staminaDamageFactor(STAMINA.lowThreshold)).toBe(1);
    expect(staminaDamageFactor(0)).toBeCloseTo(STAMINA.minDamageFactor);
    expect(staminaDamageFactor(STAMINA.lowThreshold / 2)).toBeCloseTo((1 + STAMINA.minDamageFactor) / 2);
    expect(staminaSpeedFactor(0)).toBeCloseTo(STAMINA.minSpeedFactor);
    expect(staminaSpeedFactor(-5)).toBeCloseTo(STAMINA.minSpeedFactor);
  });

  it('damage is dps × attacker terrain × stamina × defender terrain', () => {
    const d = damagePerSecond('light', Terrain.Hills, 20, 'heavy', Terrain.Forest);
    const expected =
      UNIT_STATS.light.dps *
      terrainMod(Terrain.Hills, 'light').damageDealt *
      staminaDamageFactor(20) *
      terrainMod(Terrain.Forest, 'heavy').damageTaken;
    expect(d).toBeCloseTo(expected, 10);
  });

  it('contact distance uses both radii plus the contact range', () => {
    expect(contactDistance('light', 'heavy')).toBeCloseTo(UNIT_STATS.light.radius + UNIT_STATS.heavy.radius + COMBAT.contactRange);
  });
});

describe('combat in the simulation', () => {
  it('two lights in contact damage each other continuously', () => {
    const w = smallWorld([unit(0, 'light', 10, 10), unit(1, 'light', 10 + LIGHT_GAP, 10)]);
    const [a, b] = w.units;
    for (let i = 0; i < 20; i++) step(w);
    expect(a.engaged && b.engaged).toBe(true);
    expect(a.targetId).toBe(b.id);
    expect(b.targetId).toBe(a.id);
    expect(a.hp).toBeCloseTo(UNIT_STATS.light.maxHp - UNIT_STATS.light.dps, 0);
    expect(b.hp).toBeCloseTo(a.hp, 10);
  });

  it('units out of contact do not fight', () => {
    const w = smallWorld([unit(0, 'light', 10, 10), unit(1, 'light', 12, 10)]);
    for (let i = 0; i < 40; i++) step(w);
    for (const u of w.units) {
      expect(u.engaged).toBe(false);
      expect(u.hp).toBe(UNIT_STATS.light.maxHp);
    }
  });

  it('resolution is simultaneous: two dying units kill each other in the same tick', () => {
    const w = smallWorld([unit(0, 'light', 10, 10), unit(1, 'light', 10 + LIGHT_GAP, 10)]);
    for (const u of w.units) u.hp = 0.1;
    step(w);
    expect(w.units.length).toBe(0);
    const deaths = w.events.filter((e) => e.kind === 'death');
    expect(deaths.map((e) => e.team).sort()).toEqual([0, 1]);
    expect(w.teams[0].stats.lost).toBe(1);
    expect(w.teams[1].stats.lost).toBe(1);
  });

  it('outnumbered units take damage from every attacker', () => {
    const w = smallWorld([
      unit(1, 'light', 10, 10),
      unit(0, 'light', 10 - LIGHT_GAP, 10),
      unit(0, 'light', 10 + LIGHT_GAP, 10),
    ]);
    const lone = w.units[0];
    const allies = w.units.slice(1);
    for (let i = 0; i < 20; i++) step(w);
    const lostLone = UNIT_STATS.light.maxHp - lone.hp;
    const lostAlly = allies.map((u) => UNIT_STATS.light.maxHp - u.hp);
    expect(lostLone).toBeCloseTo(2 * UNIT_STATS.light.dps, 0);
    // The lone unit hits only one of them.
    expect(Math.min(...lostAlly)).toBeLessThan(0.01);
    expect(Math.max(...lostAlly)).toBeCloseTo(UNIT_STATS.light.dps, 0);
  });

  it('a lone light eventually dies to two lights and emits a death event', () => {
    const w = smallWorld([
      unit(1, 'light', 10, 10),
      unit(0, 'light', 10 - LIGHT_GAP, 10),
      unit(0, 'light', 10 + LIGHT_GAP, 10),
    ]);
    const loneId = w.units[0].id;
    let died = false;
    for (let i = 0; i < 400 && !died; i++) {
      step(w);
      died = w.events.some((e) => e.kind === 'death' && e.unitId === loneId);
    }
    expect(died).toBe(true);
    expect(w.unitById.has(loneId)).toBe(false);
    expect(w.units.every((u) => u.team === 0)).toBe(true);
  });

  it('defender terrain matters: forest reduces damage taken by lights', () => {
    const rows = Array.from({ length: 30 }, () => '.'.repeat(10) + 'f'.repeat(30));
    const w = smallWorld([unit(0, 'light', 9.5, 10), unit(1, 'light', 10.5, 10)], { map: mapFromRows(rows) });
    const [onPlains, inForest] = w.units;
    for (let i = 0; i < 20; i++) step(w);
    const lostPlains = UNIT_STATS.light.maxHp - onPlains.hp;
    const lostForest = UNIT_STATS.light.maxHp - inForest.hp;
    expect(lostForest / lostPlains).toBeCloseTo(terrainMod(Terrain.Forest, 'light').damageTaken, 2);
  });

  it('fighting drains stamina; low stamina reduces damage', () => {
    const w = smallWorld([unit(0, 'heavy', 10, 10), unit(1, 'heavy', 10 + UNIT_STATS.heavy.radius * 2 + 0.2, 10)]);
    const [a, b] = w.units;
    a.stamina = 0;
    step(w);
    expect(b.stamina).toBeCloseTo(STAMINA.max - STAMINA.fightDrain * DT, 5);
    const dealtByA = UNIT_STATS.heavy.maxHp - b.hp;
    const dealtByB = UNIT_STATS.heavy.maxHp - a.hp;
    expect(dealtByA / dealtByB).toBeCloseTo(STAMINA.minDamageFactor, 5);
  });

  it('moving drains stamina and resting restores stamina and health', () => {
    const w = smallWorld([unit(0, 'light', 5, 5)]);
    const u = w.units[0];
    step(w, [{ kind: 'move', team: 0, unitIds: [u.id], x: 35, y: 5 }]);
    for (let i = 0; i < 100; i++) step(w);
    expect(u.stamina).toBeLessThan(STAMINA.max - 3);
    const tired = u.stamina;
    u.hp = 50;
    for (let i = 0; i < 400; i++) step(w);
    expect(u.stamina).toBeGreaterThan(tired);
    expect(u.hp).toBeGreaterThan(50);
  });

  it('engaged units slow down but can still push forward', () => {
    const w = smallWorld([unit(0, 'light', 10, 10), unit(1, 'light', 10 + LIGHT_GAP, 10)]);
    const [a] = w.units;
    step(w, [{ kind: 'move', team: 0, unitIds: [a.id], x: 30, y: 10 }]);
    step(w);
    expect(a.engaged).toBe(true);
    expect(a.lastSpeed).toBeCloseTo(UNIT_STATS.light.speed * COMBAT.engagedSpeedMult, 5);
  });

  it('heavies win on plains but lose in forest (cost-equal fight)', () => {
    const fight = (terrain: string) => {
      const rows = Array.from({ length: 30 }, () => terrain.repeat(40));
      // one heavy vs two lights (≈ equal cost), lights on either side
      const w = smallWorld(
        [unit(0, 'heavy', 20, 15), unit(1, 'light', 20 - 1.1, 15), unit(1, 'light', 20 + 1.1, 15)],
        { map: mapFromRows(rows) },
      );
      for (let i = 0; i < 4000 && new Set(w.units.map((u) => u.team)).size === 2; i++) step(w);
      return w.units[0]?.team;
    };
    expect(fight('.')).toBe(0);
    expect(fight('f')).toBe(1);
  });
});
