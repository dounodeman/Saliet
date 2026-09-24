import { describe, expect, it } from 'vitest';
import { AIController } from '../src/ai/ai';
import { DIFFICULTIES } from '../src/ai/difficulty';
import { getMap } from '../src/maps';
import { applyCommand, type Command } from '../src/sim/commands';
import { hashWorld } from '../src/sim/hash';
import { supplyCap } from '../src/sim/supply';
import type { World } from '../src/sim/types';
import { createWorld, step } from '../src/sim/world';
import { city, mapFromRows, scenario, unit } from './helpers';

const MIN = 20 * 60;

function match(mapId: string, seed: number, a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard', ticks: number) {
  const w = createWorld(getMap(mapId).build(seed), seed);
  const ais = [new AIController(0, a, seed), new AIController(1, b, seed)];
  const log: Command[] = [];
  while (w.winner === -1 && w.tick < ticks) {
    const cmds = [...ais[0].update(w), ...ais[1].update(w)];
    log.push(...cmds);
    step(w, cmds);
  }
  return { w, log };
}

describe('AI opponent', () => {
  it('only acts through commands for its own team and never mutates the world', () => {
    const w = createWorld(getMap('twin-rivers').build(1), 1);
    const ai = new AIController(1, 'hard', 1);
    for (let t = 0; t < 2 * MIN; t++) {
      const before = hashWorld(w);
      const cmds = ai.update(w);
      expect(hashWorld(w)).toBe(before);
      for (const c of cmds) expect(c.team).toBe(1);
      step(w, cmds);
    }
  });

  it('issues commands the simulation accepts', () => {
    const w = createWorld(getMap('highland-pass').build(1), 1);
    const ai = new AIController(0, 'normal', 1);
    let issued = 0;
    let accepted = 0;
    for (let t = 0; t < MIN; t++) {
      for (const c of ai.update(w)) {
        issued++;
        if (applyCommand(w, c)) accepted++;
      }
      step(w);
    }
    expect(issued).toBeGreaterThan(5);
    expect(accepted / issued).toBeGreaterThan(0.95);
  });

  it('expands to neutral cities early', () => {
    const w = createWorld(getMap('twin-rivers').build(1), 1);
    const ai = new AIController(1, 'normal', 1);
    const start = w.cities.filter((c) => c.owner === 1).length;
    for (let t = 0; t < 2 * MIN; t++) step(w, ai.update(w));
    expect(w.cities.filter((c) => c.owner === 1).length).toBeGreaterThanOrEqual(start + 3);
  });

  it('holds the front with line orders and uses production', () => {
    const { w, log } = match('twin-rivers', 2, 'hard', 'hard', 4 * MIN);
    expect(log.some((c) => c.kind === 'line')).toBe(true);
    expect(w.teams[0].stats.produced).toBeGreaterThan(5);
    expect(w.teams[1].stats.produced).toBeGreaterThan(5);
  });

  it('does not build past its supply cap', () => {
    const w = createWorld(getMap('highland-pass').build(1), 1);
    const ais = [new AIController(0, 'hard', 1), new AIController(1, 'normal', 1)];
    let overbuilt = 0;
    while (w.winner === -1 && w.tick < 6 * MIN) {
      step(w, [...ais[0].update(w), ...ais[1].update(w)]);
      for (const e of w.events) {
        if (e.kind !== 'spawn') continue;
        const n = w.units.filter((u) => u.team === e.team).length;
        if (n > supplyCap(w, e.team)) overbuilt++;
      }
    }
    // Only possible if a city falls between queueing and spawning.
    expect(overbuilt).toBeLessThanOrEqual(1);
  });

  it('AI-vs-AI matches are deterministic', () => {
    const a = match('random', 5, 'normal', 'hard', 3 * MIN);
    const b = match('random', 5, 'normal', 'hard', 3 * MIN);
    expect(hashWorld(a.w)).toBe(hashWorld(b.w));
    expect(a.w.commandLog.length).toBe(b.w.commandLog.length);
  });

  it('hard beats easy from either side', () => {
    expect(match('highland-pass', 1, 'hard', 'easy', 20 * MIN).w.winner).toBe(0);
    expect(match('highland-pass', 1, 'easy', 'hard', 20 * MIN).w.winner).toBe(1);
  });

  it('difficulty levels differ in reaction time', () => {
    expect(DIFFICULTIES.easy.reactionTicks).toBeGreaterThan(DIFFICULTIES.normal.reactionTicks);
    expect(DIFFICULTIES.normal.reactionTicks).toBeGreaterThan(DIFFICULTIES.hard.reactionTicks);
  });

  function buildsHeavies(terrain: string): number {
    const rows = Array.from({ length: 30 }, () => terrain.repeat(70));
    const map = mapFromRows(rows);
    const cities = [city('A', 5, 15, 0), city('A2', 12, 6, 0), city('B', 64, 15, 1), city('B2', 57, 24, 1)];
    const units = [0, 1, 2, 3, 4].map((i) => unit(0, 'light', 9, 11 + i * 2)).concat([0, 1, 2, 3, 4].map((i) => unit(1, 'light', 60, 11 + i * 2)));
    const w: World = createWorld(scenario(map, cities, units), 3);
    const ais = [new AIController(0, 'hard', 3), new AIController(1, 'hard', 3)];
    let heavies = 0;
    while (w.winner === -1 && w.tick < 3 * MIN) {
      step(w, [...ais[0].update(w), ...ais[1].update(w)]);
      for (const e of w.events) if (e.kind === 'spawn' && e.type === 'heavy') heavies++;
    }
    return heavies;
  }

  it('builds heavies for open ground and not for forest', () => {
    expect(buildsHeavies('.')).toBeGreaterThan(0);
    expect(buildsHeavies('f')).toBe(0);
  });
});
