import { TERRAIN_NAMES, UNIT_TYPES, type TerrainName, type UnitType } from '../config';
import { valueNoise } from './noise';
import { hashString } from './rng';
import { Terrain, terrainFromName } from './terrain';
import type { CitySpec, MapData, Scenario, UnitSpec } from './types';
import { distToSegment, pointInPolygon } from './vec';

/**
 * Hand-authored map format: terrain *regions* painted in order onto a base
 * terrain. Much easier to write by hand than a character grid, and it makes
 * natural-looking regions.
 */
export interface MapDefRegion {
  terrain: TerrainName;
  /** [cx, cy, r] */
  circle?: [number, number, number];
  /** [[x, y], ...] closed polygon */
  polygon?: Array<[number, number]>;
  /** [[x, y], ...] polyline with a width (rivers, roads, fords) */
  path?: Array<[number, number]>;
  width?: number;
  /** [x, y, w, h] */
  rect?: [number, number, number, number];
  /** Per-region override of the map's edge noise. */
  edgeNoise?: number;
}

export interface MapDef {
  name: string;
  description?: string;
  width: number;
  height: number;
  base: TerrainName;
  /** Amplitude (cells) of the organic wobble applied to region edges. */
  edgeNoise?: number;
  /** Seed for the edge noise (defaults to a hash of the name). */
  seed?: number;
  /** "point": the second half of the grid is a 180° copy of the first (fair maps). */
  symmetry?: 'point' | 'none';
  regions: MapDefRegion[];
  cities: Array<{ name: string; x: number; y: number; owner?: number }>;
  units: Array<{ team: number; type: UnitType; x: number; y: number }>;
}

function fail(msg: string): never {
  throw new Error(`Invalid map: ${msg}`);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPointList(v: unknown): v is Array<[number, number]> {
  return Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
}

/** Checks a parsed JSON object against the MapDef schema, with readable errors. */
export function validateMapDef(raw: unknown): MapDef {
  if (!raw || typeof raw !== 'object') fail('not an object');
  const d = raw as Record<string, unknown>;
  if (typeof d.name !== 'string') fail('missing "name"');
  if (!isNum(d.width) || !isNum(d.height) || d.width < 16 || d.height < 16 || d.width > 400 || d.height > 400) {
    fail('"width"/"height" must be numbers between 16 and 400');
  }
  if (!(TERRAIN_NAMES as readonly unknown[]).includes(d.base)) fail(`unknown base terrain "${String(d.base)}"`);
  if (!Array.isArray(d.regions)) fail('"regions" must be an array');
  d.regions.forEach((r: unknown, i: number) => {
    const reg = r as Record<string, unknown>;
    if (!(TERRAIN_NAMES as readonly unknown[]).includes(reg.terrain)) fail(`region ${i}: unknown terrain`);
    const shapes = ['circle', 'polygon', 'path', 'rect'].filter((k) => reg[k] !== undefined);
    if (shapes.length !== 1) fail(`region ${i}: needs exactly one of circle/polygon/path/rect`);
    if (reg.circle !== undefined && !(Array.isArray(reg.circle) && reg.circle.length === 3 && reg.circle.every(isNum))) {
      fail(`region ${i}: circle must be [cx, cy, r]`);
    }
    if (reg.rect !== undefined && !(Array.isArray(reg.rect) && reg.rect.length === 4 && reg.rect.every(isNum))) {
      fail(`region ${i}: rect must be [x, y, w, h]`);
    }
    if (reg.polygon !== undefined && !(isPointList(reg.polygon) && reg.polygon.length >= 3)) {
      fail(`region ${i}: polygon needs at least 3 [x, y] points`);
    }
    if (reg.path !== undefined && !(isPointList(reg.path) && reg.path.length >= 2 && isNum(reg.width))) {
      fail(`region ${i}: path needs 2+ points and a width`);
    }
  });
  if (!Array.isArray(d.cities) || d.cities.length === 0) fail('"cities" must be a non-empty array');
  d.cities.forEach((c: unknown, i: number) => {
    const city = c as Record<string, unknown>;
    if (typeof city.name !== 'string' || !isNum(city.x) || !isNum(city.y)) fail(`city ${i}: needs name, x, y`);
  });
  if (!Array.isArray(d.units)) fail('"units" must be an array');
  d.units.forEach((u: unknown, i: number) => {
    const unit = u as Record<string, unknown>;
    if (!isNum(unit.team) || !isNum(unit.x) || !isNum(unit.y)) fail(`unit ${i}: needs team, x, y`);
    if (!(UNIT_TYPES as readonly unknown[]).includes(unit.type)) fail(`unit ${i}: unknown type`);
  });
  return raw as MapDef;
}

function regionContains(r: MapDefRegion, x: number, y: number): boolean {
  if (r.circle) {
    const [cx, cy, rad] = r.circle;
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad;
  }
  if (r.rect) {
    const [rx, ry, rw, rh] = r.rect;
    return x >= rx && y >= ry && x < rx + rw && y < ry + rh;
  }
  if (r.polygon) return pointInPolygon(x, y, r.polygon);
  if (r.path) {
    const half = (r.width ?? 1) / 2;
    for (let i = 1; i < r.path.length; i++) {
      const [ax, ay] = r.path[i - 1];
      const [bx, by] = r.path[i];
      if (distToSegment(x, y, ax, ay, bx, by) <= half) return true;
    }
  }
  return false;
}

/** Forces a disc of cells to be passable (keeps cities and spawns reachable). */
export function clearAround(map: MapData, x: number, y: number, r: number, to: Terrain = Terrain.Plains): void {
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(map.width - 1, Math.floor(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(map.height - 1, Math.floor(y + r));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const dx = cx + 0.5 - x;
      const dy = cy + 0.5 - y;
      if (dx * dx + dy * dy > r * r) continue;
      const i = cy * map.width + cx;
      if (map.terrain[i] === Terrain.Mountains || map.terrain[i] === Terrain.Water) map.terrain[i] = to;
    }
  }
}

/** Rasterizes a MapDef into a terrain grid + scenario. */
export function rasterizeMapDef(def: MapDef): Scenario {
  const W = Math.floor(def.width);
  const H = Math.floor(def.height);
  const terrain = new Uint8Array(W * H).fill(terrainFromName(def.base));
  const seed = def.seed ?? hashString(def.name);
  const regions = def.regions.map((r) => ({ region: r, terrain: terrainFromName(r.terrain) }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Organic edges: sample each region at a smoothly wobbled position.
      const nx = (valueNoise(px * 0.35, py * 0.35, seed) - 0.5) * 2;
      const ny = (valueNoise(px * 0.35, py * 0.35, seed + 7919) - 0.5) * 2;
      let t = terrain[y * W + x];
      for (const { region, terrain: rt } of regions) {
        const amp = region.edgeNoise ?? def.edgeNoise ?? 0;
        if (regionContains(region, px + nx * amp, py + ny * amp)) t = rt;
      }
      terrain[y * W + x] = t;
    }
  }
  if (def.symmetry === 'point') {
    const n = W * H;
    for (let i = 0; i < n >> 1; i++) terrain[n - 1 - i] = terrain[i];
  }
  const map: MapData = { name: def.name, width: W, height: H, terrain };
  const cities: CitySpec[] = def.cities.map((c) => ({ name: c.name, x: c.x, y: c.y, owner: c.owner ?? -1 }));
  for (const c of cities) clearAround(map, c.x, c.y, 1.6);
  const units: UnitSpec[] = def.units.map((u) => ({ team: u.team, type: u.type, x: u.x, y: u.y }));
  return { map, cities, units };
}
