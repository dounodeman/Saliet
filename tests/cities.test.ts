import { describe, expect, it } from 'vitest';
import { CITY, DT, SUPPLY, TERRITORY, UNIT_STATS } from '../src/config';
import { citiesNeededToWin, DRAW } from '../src/sim/victory';
import { supplyCap } from '../src/sim/supply';
import { NEUTRAL } from '../src/sim/types';
import { getMap } from '../src/maps';
import type { Command } from '../src/sim/commands';
import { createWorld, step } from '../src/sim/world';
import { city, smallWorld, unit } from './helpers';

const secs = (s: number) => Math.round(s / DT);

describe('city capture', () => {
  it('holding a neutral city uncontested captures it after CAPTURE_TIME', () => {
    const w = smallWorld([unit(0, 'light', 20, 15)], { cities: [city('A', 3, 3, 0), city('B', 37, 27, 1), city('N', 20, 15)] });
    const n = w.cities[2];
    for (let i = 0; i < secs(CITY.captureTime) - 2; i++) step(w);
    expect(n.owner).toBe(NEUTRAL);
    expect(n.captureTeam).toBe(0);
    expect(n.captureProgress).toBeGreaterThan(0.9);
    let captured = false;
    for (let i = 0; i < 4; i++) {
      step(w);
      captured ||= w.events.some((e) => e.kind === 'capture' && e.cityId === n.id && e.team === 0);
    }
    expect(n.owner).toBe(0);
    expect(captured).toBe(true);
    expect(w.teams[0].stats.citiesCaptured).toBe(1);
  });

  it('progress freezes while contested and decays when abandoned', () => {
    const w = smallWorld([unit(0, 'light', 20, 15)], { cities: [city('A', 3, 3, 0), city('B', 37, 27, 1), city('N', 20, 15)] });
    const n = w.cities[2];
    for (let i = 0; i < secs(2); i++) step(w);
    expect(n.captureProgress).toBeCloseTo(2 / CITY.captureTime, 1);
    // An enemy arrives next to the city (but out of contact range): contested.
    const w2enemy = w.units.length;
    expect(w2enemy).toBe(1);
    step(w, [{ kind: 'halt', team: 0, unitIds: [w.units[0].id] }]);
    const progressBefore = n.captureProgress;
    // Teleporting in a hostile unit is the simplest way to create a contested city in a test.
    w.units.push({ ...w.units[0], id: 999, team: 1, x: 21.5, y: 16.2, prevX: 21.5, prevY: 16.2, holdX: 21.5, holdY: 16.2, waypoints: [] });
    w.unitById.set(999, w.units[1]);
    for (let i = 0; i < secs(1); i++) step(w);
    expect(n.captureProgress).toBeCloseTo(progressBefore, 5);
    // Everyone leaves: progress decays.
    w.units.length = 0;
    w.unitById.clear();
    for (let i = 0; i < secs(1); i++) step(w);
    expect(n.captureProgress).toBeCloseTo(progressBefore - CITY.captureDecayPerSec, 2);
  });

  it('an enemy city can be taken and changes the supply cap', () => {
    const w = smallWorld([unit(0, 'light', 37, 27)], { rules: { supply: true } });
    const b = w.cities[1];
    expect(supplyCap(w, 1)).toBe(SUPPLY.perCity);
    for (let i = 0; i < secs(CITY.captureTime) + 2; i++) step(w);
    expect(b.owner).toBe(0);
    expect(supplyCap(w, 1)).toBe(0);
    expect(supplyCap(w, 0)).toBe(2 * SUPPLY.perCity);
  });
});

describe('production', () => {
  it('cities generate production points for their owner', () => {
    const w = smallWorld([], { cities: [city('A', 3, 3, 0), city('A2', 10, 3, 0), city('B', 37, 27, 1)] });
    const pp0 = w.teams[0].pp;
    const pp1 = w.teams[1].pp;
    for (let i = 0; i < secs(10); i++) step(w);
    expect(w.teams[0].pp - pp0).toBeCloseTo(2 * CITY.ppPerSec * 10, 5);
    expect(w.teams[1].pp - pp1).toBeCloseTo(CITY.ppPerSec * 10, 5);
  });

  it('queued units spawn at the chosen city once affordable, paying their cost', () => {
    const w = smallWorld([], { cities: [city('A', 3, 3, 0), city('A2', 30, 5, 0), city('B', 37, 27, 1)] });
    w.teams[0].pp = UNIT_STATS.heavy.cost - 1;
    step(w, [{ kind: 'produce', team: 0, unitType: 'heavy', cityId: 1 }]);
    expect(w.teams[0].queue.length).toBe(1);
    let spawned = false;
    for (let i = 0; i < secs(2) && !spawned; i++) {
      step(w);
      spawned = w.events.some((e) => e.kind === 'spawn');
    }
    expect(spawned).toBe(true);
    const u = w.units[0];
    expect(u.type).toBe('heavy');
    expect(Math.hypot(u.x - 30, u.y - 5)).toBeLessThan(CITY.spawnOffset + 0.5);
    expect(w.teams[0].pp).toBeLessThan(2);
    expect(w.teams[0].queue.length).toBe(0);
    expect(w.teams[0].stats.produced).toBe(1);
  });

  it('rejects production at cities you do not own and respects the queue limit', () => {
    const w = smallWorld([]);
    step(w, [{ kind: 'produce', team: 0, unitType: 'light', cityId: 1 }]);
    expect(w.teams[0].queue.length).toBe(0);
    const many = Array.from({ length: CITY.maxQueue + 5 }, () => ({ kind: 'produce' as const, team: 0, unitType: 'heavy' as const, cityId: 0 }));
    w.teams[0].pp = 0;
    step(w, many);
    expect(w.teams[0].queue.length).toBe(CITY.maxQueue);
  });

  it('cancel removes a queued item', () => {
    const w = smallWorld([]);
    w.teams[0].pp = 0;
    step(w, [
      { kind: 'produce', team: 0, unitType: 'heavy', cityId: 0 },
      { kind: 'produce', team: 0, unitType: 'light', cityId: 0 },
    ]);
    const [first, second] = w.teams[0].queue;
    step(w, [{ kind: 'cancel', team: 0, itemId: first.id }]);
    expect(w.teams[0].queue.map((q) => q.id)).toEqual([second.id]);
  });

  it('spawns at the nearest owned city if the chosen one fell', () => {
    const w = smallWorld([], { cities: [city('A', 3, 3, 0), city('A2', 30, 5, 0), city('B', 37, 27, 1)] });
    w.teams[0].pp = 0;
    step(w, [{ kind: 'produce', team: 0, unitType: 'light', cityId: 1 }]);
    w.cities[1].owner = 1;
    w.teams[0].pp = 100;
    step(w);
    const u = w.units[0];
    expect(Math.hypot(u.x - 3, u.y - 3)).toBeLessThan(CITY.spawnOffset + 0.5);
  });
});

describe('supply', () => {
  it('units beyond the supply cap starve (farthest from cities first)', () => {
    const near = Array.from({ length: 5 }, (_, i) => unit(0, 'light', 5 + i, 5));
    const far = unit(0, 'light', 15, 8);
    const w = smallWorld([...near, far], { rules: { supply: true } });
    step(w);
    const starving = w.units.filter((u) => u.starving);
    expect(starving.length).toBe(1);
    expect(starving[0].x).toBeCloseTo(15, 0);
    const hp = starving[0].hp;
    for (let i = 0; i < secs(1); i++) step(w);
    expect(starving[0].hp).toBeCloseTo(hp - SUPPLY.starveDps, 0);
  });

  it('a team with no cities starves entirely', () => {
    const w = smallWorld([unit(0, 'light', 10, 10)], { rules: { supply: true }, cities: [city('B', 37, 27, 1)] });
    step(w);
    expect(w.units[0].starving).toBe(true);
  });

  it('units deep in enemy land are out of supply and lose health', () => {
    const w = smallWorld([unit(0, 'light', 36, 24)], { rules: { supply: true } });
    step(w);
    const u = w.units[0];
    expect(u.supplied).toBe(false);
    const hp = u.hp;
    for (let i = 0; i < secs(2); i++) step(w);
    expect(u.hp).toBeLessThan(hp - SUPPLY.outOfSupplyDps * 1.5);
  });

  it('encircled units are cut off even inside their own territory', () => {
    // A pocket of team-0 land around (30,15) with no link to team 0's city.
    const w = smallWorld([unit(0, 'light', 30, 15)], { w: 60, h: 30, rules: { supply: true }, cities: [city('A', 3, 15, 0), city('B', 57, 15, 1)] });
    const t = w.territory;
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const i = y * t.width + x;
        const d = Math.hypot(x + 0.5 - 30, y + 0.5 - 15);
        if (d < 4) {
          t.owner[i] = 0;
          t.control[i] = 1;
        } else if (x > 10) {
          t.owner[i] = 1;
          t.control[i] = 1;
        }
      }
    }
    step(w);
    expect(w.units[0].supplied).toBe(false);
    // Reconnect the pocket with a corridor of team-0 land.
    for (let x = 0; x <= 30; x++) {
      for (let y = 14; y <= 16; y++) {
        t.owner[y * t.width + x] = 0;
        t.control[y * t.width + x] = 1;
      }
    }
    for (let i = 0; i < SUPPLY.intervalTicks; i++) step(w);
    expect(w.units[0].supplied).toBe(true);
  });

  it('supplied idle units heal, unsupplied ones do not', () => {
    const w = smallWorld([unit(0, 'light', 6, 6), unit(0, 'light', 36, 24)], { rules: { supply: true } });
    for (const u of w.units) u.hp = 50;
    for (let i = 0; i < secs(5); i++) step(w);
    const [home, away] = w.units;
    expect(home.hp).toBeGreaterThan(50);
    expect(away.hp).toBeLessThan(50);
  });
});

describe('territory', () => {
  it('starts around owned cities', () => {
    const w = smallWorld([]);
    const t = w.territory;
    expect(t.owner[3 * t.width + 3]).toBe(0);
    expect(t.owner[27 * t.width + 37]).toBe(1);
    expect(t.owner[15 * t.width + 20]).toBe(NEUTRAL);
  });

  it('uncontested presence converts enemy land over time', () => {
    // Inside the enemy's starting territory, but outside its city's own claim radius.
    const w = smallWorld([unit(0, 'light', 30, 22)]);
    const t = w.territory;
    const i = 22 * t.width + 30;
    expect(t.owner[i]).toBe(1);
    for (let k = 0; k < secs(1 / TERRITORY.gainPerSec + 0.5); k++) step(w);
    expect(t.owner[i]).toBe(0);
  });

  it('contested cells keep their owner', () => {
    const w = smallWorld([unit(0, 'light', 20, 15), unit(1, 'light', 21.5, 15)]);
    const t = w.territory;
    const i = 15 * t.width + 20;
    t.owner[i] = 1;
    t.control[i] = 1;
    for (let k = 0; k < secs(1); k++) step(w);
    expect(t.owner[i]).toBe(1);
  });
});

describe('victory', () => {
  it('needs 80% of cities, rounded up', () => {
    expect(citiesNeededToWin(13)).toBe(11);
    expect(citiesNeededToWin(15)).toBe(12);
    expect(citiesNeededToWin(10)).toBe(8);
    expect(citiesNeededToWin(2)).toBe(2);
  });

  it('holding enough cities wins', () => {
    const cities = [city('A', 3, 3, 0), city('B', 37, 27, 1), city('C', 10, 3, 0), city('D', 3, 10, 0), city('E', 10, 10, 0)];
    const w = smallWorld([unit(0, 'light', 5, 5), unit(1, 'light', 35, 25)], { cities, rules: { victory: true } });
    step(w);
    expect(w.winner).toBe(0);
    expect(w.events.some((e) => e.kind === 'victory' && e.reason === 'cities')).toBe(true);
  });

  it('eliminating all enemy units wins; the simulation then stops', () => {
    const w = smallWorld([unit(0, 'light', 5, 5), unit(1, 'light', 35, 25)], { rules: { victory: true } });
    step(w);
    expect(w.winner).toBe(-1);
    w.units[1].hp = 0;
    step(w);
    expect(w.winner).toBe(0);
    const tick = w.tick;
    step(w);
    expect(w.tick).toBe(tick);
  });

  it('mutual destruction is a draw', () => {
    const w = smallWorld([unit(0, 'light', 20, 15), unit(1, 'light', 21, 15)], { rules: { victory: true } });
    for (const u of w.units) u.hp = 0.01;
    step(w);
    expect(w.winner).toBe(DRAW);
  });
});

describe('full match smoke test', () => {
  it('Twin Rivers runs two minutes with every system on and stays finite', () => {
    const w = createWorld(getMap('twin-rivers').build(1), 1);
    const mine = w.units.filter((u) => u.team === 0).map((u) => u.id);
    const theirs = w.units.filter((u) => u.team === 1).map((u) => u.id);
    for (let t = 0; t < secs(120); t++) {
      const cmds: Command[] = [];
      if (t === 1) {
        cmds.push({ kind: 'move', team: 0, unitIds: mine, x: 60, y: 38 });
        cmds.push({ kind: 'move', team: 1, unitIds: theirs, x: 62, y: 38 });
      }
      if (t % secs(10) === 0) {
        cmds.push({ kind: 'produce', team: 0, unitType: 'light', cityId: 0 });
        cmds.push({ kind: 'produce', team: 1, unitType: 'light', cityId: 2 });
      }
      step(w, cmds);
    }
    for (const u of w.units) {
      expect(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp)).toBe(true);
      expect(u.hp).toBeGreaterThan(0);
    }
    expect(w.teams[0].stats.produced + w.teams[1].stats.produced).toBeGreaterThan(4);
  });
});
