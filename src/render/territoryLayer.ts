import { Terrain } from '../sim/terrain';
import type { MapData, Territory } from '../sim/types';
import { TEAM_COLORS } from './palette';

const ISO = 0.5;

/**
 * Territory rendering: a soft tint (a 1-pixel-per-cell bitmap drawn scaled with
 * smoothing) plus crisp border lines per team, extracted with marching squares
 * from a lightly blurred ownership field. Where two teams meet, their borders
 * run side by side — that double line is the front.
 */
export class TerritoryLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private version = -1;
  /** Per team: flat [x0, y0, x1, y1, ...] border segments in world units. */
  private borders: Float32Array[] = [];
  private field: Float32Array;
  private tmp: Float32Array;

  constructor(private map: MapData) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.width;
    this.canvas.height = map.height;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(map.width, map.height);
    this.field = new Float32Array(map.width * map.height);
    this.tmp = new Float32Array(map.width * map.height);
  }

  private rebuild(t: Territory): void {
    const W = t.width;
    const H = t.height;
    const data = this.img.data;
    for (let i = 0; i < W * H; i++) {
      const o = t.owner[i];
      const k = i * 4;
      if (o < 0) {
        data[k + 3] = 0;
        continue;
      }
      const rgb = TEAM_COLORS[o].rgb;
      const terr = this.map.terrain[i];
      const dim = terr === Terrain.Mountains ? 0.3 : terr === Terrain.Water ? 0.7 : 1;
      data[k] = rgb[0];
      data[k + 1] = rgb[1];
      data[k + 2] = rgb[2];
      data[k + 3] = Math.round(255 * (0.07 + 0.17 * t.control[i]) * dim);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.borders = TEAM_COLORS.map((_, team) => this.contour(t, team));
  }

  /** Marching squares over cell centres of the blurred "owned by team" field. */
  private contour(t: Territory, team: number): Float32Array {
    const W = t.width;
    const H = t.height;
    const f = this.field;
    const g = this.tmp;
    for (let i = 0; i < W * H; i++) f[i] = t.owner[i] === team ? 1 : 0;
    // Separable [1 2 1] blur (edges replicate) to round off the grid staircase.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const l = f[x > 0 ? i - 1 : i];
        const r = f[x < W - 1 ? i + 1 : i];
        g[i] = (l + 2 * f[i] + r) * 0.25;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const u = g[y > 0 ? i - W : i];
        const d = g[y < H - 1 ? i + W : i];
        f[i] = (u + 2 * g[i] + d) * 0.25;
      }
    }
    const out: number[] = [];
    const lerp = (va: number, vb: number) => (va === vb ? 0.5 : (ISO - va) / (vb - va));
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const a = f[y * W + x]; // top-left
        const b = f[y * W + x + 1]; // top-right
        const c = f[(y + 1) * W + x + 1]; // bottom-right
        const d = f[(y + 1) * W + x]; // bottom-left
        const idx = (a > ISO ? 8 : 0) | (b > ISO ? 4 : 0) | (c > ISO ? 2 : 0) | (d > ISO ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = x + 0.5;
        const y0 = y + 0.5;
        const top = () => [x0 + lerp(a, b), y0];
        const right = () => [x0 + 1, y0 + lerp(b, c)];
        const bottom = () => [x0 + lerp(d, c), y0 + 1];
        const left = () => [x0, y0 + lerp(a, d)];
        const seg = (p: number[], q: number[]) => out.push(p[0], p[1], q[0], q[1]);
        const center = (a + b + c + d) / 4;
        switch (idx) {
          case 1:
          case 14:
            seg(left(), bottom());
            break;
          case 2:
          case 13:
            seg(bottom(), right());
            break;
          case 3:
          case 12:
            seg(left(), right());
            break;
          case 4:
          case 11:
            seg(top(), right());
            break;
          case 6:
          case 9:
            seg(top(), bottom());
            break;
          case 7:
          case 8:
            seg(left(), top());
            break;
          case 5:
            if (center > ISO) {
              seg(left(), top());
              seg(bottom(), right());
            } else {
              seg(top(), right());
              seg(left(), bottom());
            }
            break;
          case 10:
            if (center > ISO) {
              seg(top(), right());
              seg(left(), bottom());
            } else {
              seg(left(), top());
              seg(bottom(), right());
            }
            break;
        }
      }
    }
    return new Float32Array(out);
  }

  /** Draws in world coordinates (camera transform already applied). */
  draw(ctx: CanvasRenderingContext2D, t: Territory, zoom: number): void {
    if (t.version !== this.version) {
      this.version = t.version;
      this.rebuild(t);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, t.width, t.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.borders.forEach((segs, team) => {
      if (segs.length === 0) return;
      ctx.strokeStyle = TEAM_COLORS[team].main;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(1.8 / zoom, 0.09);
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        ctx.moveTo(segs[i], segs[i + 1]);
        ctx.lineTo(segs[i + 2], segs[i + 3]);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
}
