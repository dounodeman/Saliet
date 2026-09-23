import { describe, expect, it } from 'vitest';
import { Rng, createRngState, nextFloat } from '../src/sim/rng';
import { fbm, valueNoise } from '../src/sim/noise';

describe('seeded RNG', () => {
  it('is reproducible for the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) expect(a.u32()).toBe(b.u32());
  });

  it('differs between seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 20 }, () => a.u32() === b.u32()).filter(Boolean).length;
    expect(same).toBeLessThan(2);
  });

  it('produces floats in [0,1) with a sane mean', () => {
    const s = createRngState(99);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const f = nextFloat(s);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += f;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });

  it('value noise is deterministic and bounded', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      const v = valueNoise(x, y, 5);
      expect(v).toBe(valueNoise(x, y, 5));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(fbm(x, y, 5)).toBeLessThan(1);
    }
  });
});
