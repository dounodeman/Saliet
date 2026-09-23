import { fbm } from './noise';
import { clearAround } from './mapdef';
import { buildNavGrid, reachableCells } from './pathfinding';
import { Rng } from './rng';
import { Terrain } from './terrain';
import type { CitySpec, MapData, Scenario, UnitSpec, Vec2 } from './types';
import { distToSegment } from './vec';

export interface GenOptions {
  width?: number;
  height?: number;
}

const CITY_NAMES = [
  'Alder', 'Birchmoor', 'Carrow', 'Dunhollow', 'Eastwick', 'Farrow', 'Gorsey', 'Hale', 'Inkwell', 'Jarrow',
  'Kettle', 'Larkspur', 'Millbrook', 'Nettleby', 'Oakhurst', 'Pike', 'Quillon', 'Redfern', 'Stonecross',
  'Thistle', 'Umber', 'Varrow', 'Whitlow', 'Yarrow',
];

function sq(v: number): number {
  return v * v;
}

function mirror(p: Vec2, W: number, H: number): Vec2 {
  return { x: W - p.x, y: H - p.y };
}

function symmetrize(terrain: Uint8Array): void {
  const n = terrain.length;
  for (let i = 0; i < n >> 1; i++) terrain[n - 1 - i] = terrain[i];
}

/** Paints a polyline of `t` with the given width. */
function paintPath(map: MapData, pts: Vec2[], width: number, t: Terrain, only?: (cur: number) => boolean): void {
  const half = width / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1));
    const x1 = Math.min(map.width - 1, Math.ceil(Math.max(a.x, b.x) + half + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1));
    const y1 = Math.min(map.height - 1, Math.ceil(Math.max(a.y, b.y) + half + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (distToSegment(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y) > half) continue;
        const i2 = y * map.width + x;
        if (!only || only(map.terrain[i2])) map.terrain[i2] = t;
      }
    }
  }
}

/**
 * Procedural map: fractal elevation/moisture noise, a meandering river through
 * the centre, then made point-symmetric (180°) so both sides are equal. Cities
 * are placed in mirrored pairs; the result is checked for connectivity and
 * mountain passes are carved where needed.
 */
export function generateScenario(seed: number, opts: GenOptions = {}): Scenario {
  const W = opts.width ?? 120;
  const H = opts.height ?? 76;
  const rng = new Rng(seed);
  const terrain = new Uint8Array(W * H);
  const map: MapData = { name: `Random ${seed}`, width: W, height: H, terrain };
  const eSeed = rng.u32() & 0xffffff;
  const mSeed = rng.u32() & 0xffffff;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let e = fbm(x / 20, y / 20, eSeed, 4);
      e = (e - 0.5) * 1.7 + 0.5;
      const m = fbm(x / 13, y / 13, mSeed, 3);
      let t: Terrain = Terrain.Plains;
      if (e < 0.18) t = Terrain.Water;
      else if (e > 0.84) t = Terrain.Mountains;
      else if (e > 0.69) t = Terrain.Hills;
      else if (m > 0.6) t = Terrain.Forest;
      terrain[y * W + x] = t;
    }
  }

  // A river from the top edge that meanders to the map centre; symmetry
  // continues it from the centre to the bottom edge.
  const river: Vec2[] = [{ x: rng.range(W * 0.3, W * 0.62), y: -1 }];
  const segments = 5;
  for (let s = 1; s < segments; s++) {
    const t = s / segments;
    const last = river[river.length - 1];
    river.push({
      x: last.x + (W / 2 - last.x) * (1 / (segments - s + 1)) + rng.range(-7, 7),
      y: (H / 2) * t + rng.range(-2, 2),
    });
  }
  river.push({ x: W / 2, y: H / 2 });
  paintPath(map, river, 2.2, Terrain.Water, (cur) => cur !== Terrain.Mountains);
  // Fords.
  const fordCount = 1 + rng.int(2);
  for (let f = 0; f < fordCount; f++) {
    const p = river[1 + rng.int(river.length - 2)];
    paintPath(map, [{ x: p.x - 2.5, y: p.y }, { x: p.x + 2.5, y: p.y }], 2.4, Terrain.Plains, (c) => c === Terrain.Water);
  }
  symmetrize(terrain);

  // Cities in mirrored pairs.
  const cities: CitySpec[] = [];
  const names = CITY_NAMES.slice();
  const takeName = () => names.splice(rng.int(names.length), 1)[0] ?? `City ${cities.length}`;
  const cap0 = { x: rng.range(6, 10), y: H / 2 + rng.range(-10, 10) };
  const cap1 = mirror(cap0, W, H);
  cities.push({ name: takeName(), x: cap0.x, y: cap0.y, owner: 0 });
  cities.push({ name: takeName(), x: cap1.x, y: cap1.y, owner: 1 });
  const pairs = 5 + rng.int(2);
  let tries = 0;
  const minDist = 13;
  while (cities.length < 2 + pairs * 2 && tries++ < 4000) {
    const p = { x: rng.range(6, W - 6), y: rng.range(5, H - 5) };
    const q = mirror(p, W, H);
    if (sq(p.x - q.x) + sq(p.y - q.y) < minDist * minDist) continue;
    const t = terrain[Math.floor(p.y) * W + Math.floor(p.x)];
    if (t === Terrain.Water || t === Terrain.Mountains) continue;
    const ok = cities.every((c) => sq(c.x - p.x) + sq(c.y - p.y) >= minDist * minDist && sq(c.x - q.x) + sq(c.y - q.y) >= minDist * minDist);
    if (!ok) continue;
    cities.push({ name: takeName(), x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2, owner: -1 });
    cities.push({ name: takeName(), x: W - Math.round(p.x * 2) / 2, y: H - Math.round(p.y * 2) / 2, owner: -1 });
  }
  if (cities.every((c) => sq(c.x - W / 2) + sq(c.y - H / 2) >= minDist * minDist)) {
    cities.push({ name: takeName(), x: W / 2, y: H / 2, owner: -1 });
  }
  // Each side also starts with the neutral city nearest its capital.
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = 2; i < cities.length; i++) {
    const c = cities[i];
    if (c.x > W / 2) continue;
    const d = sq(c.x - cap0.x) + sq(c.y - cap0.y);
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  if (nearest >= 0) {
    const c = cities[nearest];
    c.owner = 0;
    const twin = cities.find((o) => o !== c && Math.abs(o.x - (W - c.x)) < 1e-6 && Math.abs(o.y - (H - c.y)) < 1e-6);
    if (twin) twin.owner = 1;
  }
  for (const c of cities) clearAround(map, c.x, c.y, 2);

  // Connectivity: carve passes (mountains → hills) until every city is reachable.
  for (let guard = 0; guard < cities.length; guard++) {
    const reach = reachableCells(buildNavGrid(map), cap0.x, cap0.y);
    const cut = cities.find((c) => !reach[Math.floor(c.y) * W + Math.floor(c.x)]);
    if (!cut) break;
    const line = [{ x: cut.x, y: cut.y }, cap0];
    paintPath(map, line, 2.2, Terrain.Hills, (cur) => cur === Terrain.Mountains);
    paintPath(map, line.map((p) => mirror(p, W, H)), 2.2, Terrain.Hills, (cur) => cur === Terrain.Mountains);
  }

  // Starting armies.
  const units: UnitSpec[] = [];
  const toward = cap0.y < H / 2 ? 1 : -1;
  const offsets: Array<[number, number, 'light' | 'heavy']> = [
    [4, -4.5, 'light'],
    [4, -1.5, 'light'],
    [4, 1.5, 'light'],
    [4, 4.5, 'light'],
    [7, 0, 'heavy'],
  ];
  for (const [dx, dy, type] of offsets) {
    units.push({ team: 0, type, x: cap0.x + dx, y: cap0.y + dy * toward });
    units.push({ team: 1, type, x: W - (cap0.x + dx), y: H - (cap0.y + dy * toward) });
  }
  if (nearest >= 0) {
    const c = cities[nearest];
    units.push({ team: 0, type: 'light', x: c.x + 1.5, y: c.y });
    units.push({ team: 1, type: 'light', x: W - c.x - 1.5, y: H - c.y });
  }
  return { map, cities, units };
}
