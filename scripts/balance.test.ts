/**
 * Headless AI-vs-AI batches for balance passes. Not part of `npm test`;
 * run with `npm run balance`. Prints a table of outcomes.
 */
import { it } from 'vitest';
import { AIController } from '../src/ai/ai';
import type { DifficultyName } from '../src/ai/difficulty';
import { MAPS } from '../src/maps';
import { createWorld, step } from '../src/sim/world';

export interface MatchResult {
  map: string;
  seed: number;
  a: DifficultyName;
  b: DifficultyName;
  winner: number;
  minutes: number;
  produced: [number, number];
  lost: [number, number];
  cities: [number, number];
}

export function playMatch(mapId: string, seed: number, a: DifficultyName, b: DifficultyName, maxMinutes = 25): MatchResult {
  const entry = MAPS.find((m) => m.id === mapId)!;
  const world = createWorld(entry.build(seed), seed);
  const ais = [new AIController(0, a, seed), new AIController(1, b, seed)];
  const maxTicks = maxMinutes * 60 * 20;
  while (world.winner === -1 && world.tick < maxTicks) {
    step(world, [...ais[0].update(world), ...ais[1].update(world)]);
  }
  const owned = (t: number) => world.cities.filter((c) => c.owner === t).length;
  return {
    map: mapId,
    seed,
    a,
    b,
    winner: world.winner,
    minutes: Math.round((world.tick / 20 / 60) * 10) / 10,
    produced: [world.teams[0].stats.produced, world.teams[1].stats.produced],
    lost: [world.teams[0].stats.lost, world.teams[1].stats.lost],
    cities: [owned(0), owned(1)],
  };
}

const pairs: Array<[DifficultyName, DifficultyName]> = (process.env.PAIRS ?? 'hard:hard,hard:easy,normal:easy,hard:normal')
  .split(',')
  .map((p) => p.split(':') as [DifficultyName, DifficultyName]);
const seeds = Number(process.env.SEEDS ?? 3);
const maps = (process.env.MAPS ?? 'twin-rivers,highland-pass,random').split(',');

it('balance batch', () => {
  const rows: string[] = [];
  for (const map of maps) {
    for (const [a, b] of pairs) {
      for (let s = 1; s <= seeds; s++) {
        const t0 = Date.now();
        const r = playMatch(map, s, a, b);
        rows.push(
          `${map.padEnd(14)} ${`${a} v ${b}`.padEnd(16)} seed ${s}  winner ${String(r.winner).padStart(2)}  ${String(r.minutes).padStart(5)} min  ` +
            `cities ${r.cities.join('-')}  produced ${r.produced.join('/')}  lost ${r.lost.join('/')}  (${Date.now() - t0} ms)`,
        );
        process.stdout.write(rows[rows.length - 1] + '\n');
      }
    }
  }
});
