import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps';
import type { Command } from '../src/sim/commands';
import { hashWorld } from '../src/sim/hash';
import { createWorld, step } from '../src/sim/world';

function scripted(tick: number, unitIds: number[]): Command[] {
  const out: Command[] = [];
  if (tick === 1) out.push({ kind: 'move', team: 0, unitIds, x: 60, y: 38 });
  if (tick === 40) out.push({ kind: 'line', team: 0, unitIds, points: [[50, 20], [55, 38], [50, 56]] });
  if (tick === 60) out.push({ kind: 'move', team: 1, unitIds: [], x: 0, y: 0 });
  return out;
}

function runScript(seed: number, ticks: number): string {
  const w = createWorld(getMap('twin-rivers').build(seed), seed);
  const mine = w.units.filter((u) => u.team === 0).map((u) => u.id);
  const theirs = w.units.filter((u) => u.team === 1).map((u) => u.id);
  for (let t = 0; t < ticks; t++) {
    const cmds = scripted(t, mine);
    if (t === 5) cmds.push({ kind: 'move', team: 1, unitIds: theirs, x: 55, y: 30 });
    step(w, cmds);
  }
  return hashWorld(w);
}

describe('determinism', () => {
  it('same seed + same commands => identical state', () => {
    expect(runScript(7, 600)).toBe(runScript(7, 600));
  });

  it('a different command stream changes the state', () => {
    const w1 = createWorld(getMap('twin-rivers').build(1), 1);
    const w2 = createWorld(getMap('twin-rivers').build(1), 1);
    const id = w1.units[0].id;
    step(w1, [{ kind: 'move', team: 0, unitIds: [id], x: 30, y: 30 }]);
    step(w2, [{ kind: 'move', team: 0, unitIds: [id], x: 31, y: 30 }]);
    for (let i = 0; i < 20; i++) {
      step(w1);
      step(w2);
    }
    expect(hashWorld(w1)).not.toBe(hashWorld(w2));
  });

  it('replaying the command log reproduces the match', () => {
    const w = createWorld(getMap('highland-pass').build(3), 3);
    const ids = w.units.filter((u) => u.team === 0).map((u) => u.id);
    for (let t = 0; t < 300; t++) step(w, t === 2 ? [{ kind: 'move', team: 0, unitIds: ids, x: 60, y: 38 }] : []);
    const replay = createWorld(getMap('highland-pass').build(3), 3);
    const byTick = new Map<number, Command[]>();
    for (const { tick, cmd } of w.commandLog) byTick.set(tick, [...(byTick.get(tick) ?? []), cmd]);
    for (let t = 0; t < 300; t++) step(replay, byTick.get(t) ?? []);
    expect(hashWorld(replay)).toBe(hashWorld(w));
  });

  it('the simulation never touches non-deterministic or DOM APIs', () => {
    const dir = join(__dirname, '../src/sim');
    const forbidden = [
      /Math\.random/,
      /Date\.now|new Date/,
      /performance\./,
      /\bwindow\b/,
      /\bdocument\b/,
      /Math\.(sin|cos|tan|atan2?|exp|log|pow)\b/,
      /\*\*/,
      /from '\.\.\/(render|input|ui|audio|game)/,
    ];
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const re of forbidden) expect(re.test(src), `${file} matches ${re}`).toBe(false);
    }
  });
});
