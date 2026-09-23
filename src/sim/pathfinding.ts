import { PATH_COST_MULT, UNIT_TYPES, type UnitType } from '../config';
import { isPassable, terrainMod, terrainName } from './terrain';
import type { MapData, Vec2 } from './types';

const SQRT2 = Math.SQRT2;

/** Min-heap of (node, priority) with lazy deletion. Deterministic for identical input. */
class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  clear(): void {
    this.nodes.length = 0;
    this.keys.length = 0;
  }

  push(node: number, key: number): void {
    const nodes = this.nodes;
    const keys = this.keys;
    let i = nodes.length;
    nodes.push(node);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      // Tie-break on node index so ordering never depends on insertion history.
      if (keys[p] < key || (keys[p] === key && nodes[p] <= node)) break;
      nodes[i] = nodes[p];
      keys[i] = keys[p];
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }

  pop(): number {
    const nodes = this.nodes;
    const keys = this.keys;
    const top = nodes[0];
    const lastNode = nodes.pop()!;
    const lastKey = keys.pop()!;
    const n = nodes.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        let c = l;
        if (r < n && (keys[r] < keys[l] || (keys[r] === keys[l] && nodes[r] < nodes[l]))) c = r;
        if (keys[c] > lastKey || (keys[c] === lastKey && nodes[c] >= lastNode)) break;
        nodes[i] = nodes[c];
        keys[i] = keys[c];
        i = c;
      }
      nodes[i] = lastNode;
      keys[i] = lastKey;
    }
    return top;
  }
}

export interface NavGrid {
  width: number;
  height: number;
  passable: Uint8Array;
  /** Per unit type: planning cost to cross one cell (time × terrain penalty); Infinity if impassable. */
  cost: Record<UnitType, Float64Array>;
  // Scratch buffers reused between searches.
  g: Float64Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  generation: number;
  heap: MinHeap;
}

export function buildNavGrid(map: MapData): NavGrid {
  const n = map.width * map.height;
  const passable = new Uint8Array(n);
  const cost = {} as Record<UnitType, Float64Array>;
  for (const type of UNIT_TYPES) cost[type] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = map.terrain[i];
    passable[i] = isPassable(t) ? 1 : 0;
    for (const type of UNIT_TYPES) {
      const s = terrainMod(t, type).speed;
      const name = terrainName(t as Parameters<typeof terrainName>[0]);
      const penalty = name === 'mountains' ? 1 : PATH_COST_MULT[name];
      cost[type][i] = passable[i] && s > 0 ? penalty / s : Infinity;
    }
  }
  return {
    width: map.width,
    height: map.height,
    passable,
    cost,
    g: new Float64Array(n),
    parent: new Int32Array(n),
    seen: new Uint32Array(n),
    closed: new Uint32Array(n),
    generation: 0,
    heap: new MinHeap(),
  };
}

export function isCellPassable(nav: NavGrid, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= nav.width || cy >= nav.height) return false;
  return nav.passable[cy * nav.width + cx] === 1;
}

export function isPointPassable(nav: NavGrid, x: number, y: number): boolean {
  return isCellPassable(nav, Math.floor(x), Math.floor(y));
}

/**
 * Returns the point itself if it is on a passable cell (clamped into the map),
 * otherwise the centre of the nearest passable cell.
 */
export function snapToPassable(nav: NavGrid, x: number, y: number): Vec2 {
  const cx0 = Math.min(nav.width - 0.001, Math.max(0.001, x));
  const cy0 = Math.min(nav.height - 0.001, Math.max(0.001, y));
  const ix = Math.floor(cx0);
  const iy = Math.floor(cy0);
  if (isCellPassable(nav, ix, iy)) return { x: cx0, y: cy0 };
  const maxR = Math.max(nav.width, nav.height);
  for (let r = 1; r < maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const nx = ix + dx;
        const ny = iy + dy;
        if (!isCellPassable(nav, nx, ny)) continue;
        const ddx = nx + 0.5 - cx0;
        const ddy = ny + 0.5 - cy0;
        const d = ddx * ddx + ddy * ddy;
        if (d < bestD) {
          bestD = d;
          best = ny * nav.width + nx;
        }
      }
    }
    if (best >= 0) return { x: (best % nav.width) + 0.5, y: Math.floor(best / nav.width) + 0.5 };
  }
  return { x: cx0, y: cy0 };
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A* over the terrain grid (8-connected, no corner cutting past impassable cells).
 * Edge cost is distance × average time-cost of the two cells for this unit type,
 * so units prefer terrain they are fast on.
 *
 * Returns waypoints from (just after) the start to exactly (tx, ty), smoothed,
 * or null if the target cannot be reached.
 */
export function findPath(nav: NavGrid, type: UnitType, sx: number, sy: number, tx: number, ty: number): Vec2[] | null {
  const W = nav.width;
  const H = nav.height;
  const sxC = Math.min(W - 1, Math.max(0, Math.floor(sx)));
  const syC = Math.min(H - 1, Math.max(0, Math.floor(sy)));
  const txC = Math.floor(tx);
  const tyC = Math.floor(ty);
  if (!isCellPassable(nav, txC, tyC)) return null;
  const start = syC * W + sxC;
  const goal = tyC * W + txC;
  if (start === goal) return [{ x: tx, y: ty }];

  const cost = nav.cost[type];
  const { g, parent, seen, closed, heap } = nav;
  const gen = ++nav.generation;
  heap.clear();

  const heuristic = (i: number): number => {
    const dx = Math.abs((i % W) - txC);
    const dy = Math.abs(Math.floor(i / W) - tyC);
    // Octile distance; the cheapest possible cell cost is 1 (plains), so this is admissible.
    return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
  };

  g[start] = 0;
  seen[start] = gen;
  parent[start] = -1;
  // The start cell may be impassable in rare cases (e.g. clamped position); treat it as cost 1.
  const startCost = Number.isFinite(cost[start]) ? cost[start] : 1;
  heap.push(start, heuristic(start));
  let found = false;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % W;
    const cy = (cur - cx) / W;
    const curCost = cur === start ? startCost : cost[cur];
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0];
      const dy = DIRS[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (nav.passable[n] === 0 || closed[n] === gen) continue;
      if (dx !== 0 && dy !== 0) {
        if (nav.passable[cy * W + nx] === 0 || nav.passable[ny * W + cx] === 0) continue;
      }
      const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
      const ng = g[cur] + step * (curCost + cost[n]) * 0.5;
      if (seen[n] !== gen || ng < g[n]) {
        seen[n] = gen;
        g[n] = ng;
        parent[n] = cur;
        heap.push(n, ng + heuristic(n));
      }
    }
  }
  if (!found) return null;

  const cells: number[] = [];
  for (let c = goal; c !== -1; c = parent[c]) cells.push(c);
  cells.reverse();
  const pts: Vec2[] = [{ x: sx, y: sy }];
  for (let i = 1; i < cells.length - 1; i++) {
    pts.push({ x: (cells[i] % W) + 0.5, y: Math.floor(cells[i] / W) + 0.5 });
  }
  pts.push({ x: tx, y: ty });
  return smoothPath(nav, type, pts).slice(1);
}

function cellCost(nav: NavGrid, type: UnitType, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= nav.width || cy >= nav.height) return Infinity;
  return nav.cost[type][cy * nav.width + cx];
}

/**
 * True if walking the straight segment a→b only touches passable cells whose cost
 * is at most maxCost. The check is "thick" (±0.3 cells) so units never clip corners.
 */
export function segmentClear(nav: NavGrid, type: UnitType, a: Vec2, b: Vec2, maxCost: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return cellCost(nav, type, a.x, a.y) <= maxCost;
  const px = (-dy / len) * 0.3;
  const py = (dx / len) * 0.3;
  const steps = Math.ceil(len / 0.25);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    if (cellCost(nav, type, x, y) > maxCost) return false;
    if (cellCost(nav, type, x + px, y + py) > maxCost) return false;
    if (cellCost(nav, type, x - px, y - py) > maxCost) return false;
  }
  return true;
}

/**
 * Greedy line-of-sight smoothing. A shortcut is only taken when it never crosses
 * terrain more expensive than the worst terrain on the path it replaces, so
 * smoothing can't drag units through water or forest A* deliberately avoided.
 */
export function smoothPath(nav: NavGrid, type: UnitType, pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let maxCost = Math.max(cellCost(nav, type, pts[i].x, pts[i].y), cellCost(nav, type, pts[i + 1].x, pts[i + 1].y));
    if (!Number.isFinite(maxCost)) maxCost = 1e9; // start inside a wall: allow leaving it
    let j = i + 1;
    while (j + 1 < pts.length) {
      const nextCost = Math.max(maxCost, cellCost(nav, type, pts[j + 1].x, pts[j + 1].y));
      if (!segmentClear(nav, type, pts[i], pts[j + 1], nextCost)) break;
      maxCost = nextCost;
      j++;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Total length of a polyline starting at `from`. */
export function pathLength(from: Vec2, path: readonly Vec2[]): number {
  let len = 0;
  let px = from.x;
  let py = from.y;
  for (const p of path) {
    const dx = p.x - px;
    const dy = p.y - py;
    len += Math.sqrt(dx * dx + dy * dy);
    px = p.x;
    py = p.y;
  }
  return len;
}

/** Flood fill of passable cells reachable from a point (used by map validation). */
export function reachableCells(nav: NavGrid, x: number, y: number): Uint8Array {
  const W = nav.width;
  const out = new Uint8Array(W * nav.height);
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (!isCellPassable(nav, sx, sy)) return out;
  const stack = [sy * W + sx];
  out[stack[0]] = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    const cx = c % W;
    const cy = (c - cx) / W;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isCellPassable(nav, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isCellPassable(nav, nx, cy) || !isCellPassable(nav, cx, ny))) continue;
      const n = ny * W + nx;
      if (out[n]) continue;
      out[n] = 1;
      stack.push(n);
    }
  }
  return out;
}
