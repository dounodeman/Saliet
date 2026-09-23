/**
 * sfc32 — a small, fast, well-distributed PRNG with 128 bits of state.
 * State lives in a Uint32Array so it can be stored in the world, hashed and cloned.
 */

export function createRngState(seed: number): Uint32Array {
  const s = new Uint32Array(4);
  // splitmix32 to expand the seed into four well-mixed words.
  let x = seed >>> 0;
  for (let i = 0; i < 4; i++) {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    s[i] = (z ^ (z >>> 16)) >>> 0;
  }
  // Warm up.
  for (let i = 0; i < 12; i++) nextU32(s);
  return s;
}

export function nextU32(s: Uint32Array): number {
  const a = s[0], b = s[1], c = s[2], d = s[3];
  const t = (((a + b) >>> 0) + d) >>> 0;
  s[3] = (d + 1) >>> 0;
  s[0] = b ^ (b >>> 9);
  s[1] = (c + (c << 3)) >>> 0;
  const r = ((c << 21) | (c >>> 11)) >>> 0;
  s[2] = (r + t) >>> 0;
  return t;
}

/** Uniform float in [0, 1). */
export function nextFloat(s: Uint32Array): number {
  return nextU32(s) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(s: Uint32Array, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** Uniform float in [lo, hi). */
export function nextRange(s: Uint32Array, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(s);
}

/** Convenience wrapper for code outside the world state (map generation, AI). */
export class Rng {
  readonly state: Uint32Array;
  constructor(seed: number) {
    this.state = createRngState(seed);
  }
  u32(): number {
    return nextU32(this.state);
  }
  float(): number {
    return nextFloat(this.state);
  }
  int(n: number): number {
    return nextInt(this.state, n);
  }
  range(lo: number, hi: number): number {
    return nextRange(this.state, lo, hi);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** Deterministic string hash (FNV-1a) — handy for turning names into seeds. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
