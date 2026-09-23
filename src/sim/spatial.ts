import type { Unit } from './types';

/**
 * Uniform-grid spatial hash rebuilt from scratch each time it is needed
 * (counting sort — no allocation after warm-up, deterministic iteration order).
 */
export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  private cellStart: Int32Array;
  private cellCount: Int32Array;
  private items: Int32Array = new Int32Array(64);
  private unitCell: Int32Array = new Int32Array(64);
  units: readonly Unit[] = [];

  constructor(
    width: number,
    height: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellCount = new Int32Array(this.cols * this.rows);
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return cy * this.cols + cx;
  }

  build(units: readonly Unit[]): void {
    this.units = units;
    const n = units.length;
    if (this.items.length < n) {
      this.items = new Int32Array(n * 2);
      this.unitCell = new Int32Array(n * 2);
    }
    this.cellCount.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellOf(units[i].x, units[i].y);
      this.unitCell[i] = c;
      this.cellCount[c]++;
    }
    let acc = 0;
    for (let c = 0; c < this.cellCount.length; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c];
    }
    this.cellStart[this.cellCount.length] = acc;
    this.cellCount.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.unitCell[i];
      this.items[this.cellStart[c] + this.cellCount[c]++] = i;
    }
  }

  /** Calls fn(index) for every unit whose cell overlaps the query circle's bounding box. */
  query(x: number, y: number, r: number, fn: (index: number) => void): void {
    const cs = this.cellSize;
    const x0 = Math.max(0, Math.floor((x - r) / cs));
    const y0 = Math.max(0, Math.floor((y - r) / cs));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / cs));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / cs));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cols + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) fn(this.items[k]);
      }
    }
  }
}
