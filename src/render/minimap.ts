import type { Camera } from './camera';
import { NEUTRAL_COLOR, TEAM_COLORS, TERRAIN_RGB } from './palette';
import type { World } from '../sim/types';

/**
 * Small overview map: terrain, territory tint, cities, units and the camera
 * rectangle. Click or drag on it to move the camera.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private territory: HTMLCanvasElement;
  private territoryImg: ImageData;
  private territoryVersion = -1;
  private scale: number;
  private dragging = false;
  private disposers: Array<() => void> = [];

  constructor(
    private world: World,
    private camera: Camera,
    width = 200,
  ) {
    const map = world.map;
    this.scale = width / map.width;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(map.height * this.scale * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${map.height * this.scale}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);

    this.base = document.createElement('canvas');
    this.base.width = map.width;
    this.base.height = map.height;
    const bctx = this.base.getContext('2d')!;
    const img = bctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.terrain.length; i++) {
      const c = TERRAIN_RGB[map.terrain[i]];
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);

    this.territory = document.createElement('canvas');
    this.territory.width = map.width;
    this.territory.height = map.height;
    this.territoryImg = this.territory.getContext('2d')!.createImageData(map.width, map.height);

    const move = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.camera.centerOn({ x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale });
    };
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.dragging = true;
      move(e);
    });
    const onMove = (e: MouseEvent) => this.dragging && move(e);
    const onUp = () => (this.dragging = false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    this.disposers.push(() => window.removeEventListener('mousemove', onMove), () => window.removeEventListener('mouseup', onUp));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  draw(): void {
    const { world, ctx, scale } = this;
    const map = world.map;
    const W = map.width * scale;
    const H = map.height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, W, H);

    const t = world.territory;
    if (t.version !== this.territoryVersion) {
      this.territoryVersion = t.version;
      const d = this.territoryImg.data;
      for (let i = 0; i < t.owner.length; i++) {
        const o = t.owner[i];
        if (o < 0) {
          d[i * 4 + 3] = 0;
          continue;
        }
        const rgb = TEAM_COLORS[o].rgb;
        d[i * 4] = rgb[0];
        d[i * 4 + 1] = rgb[1];
        d[i * 4 + 2] = rgb[2];
        d[i * 4 + 3] = 90;
      }
      this.territory.getContext('2d')!.putImageData(this.territoryImg, 0, 0);
    }
    ctx.drawImage(this.territory, 0, 0, W, H);

    for (const c of world.cities) {
      ctx.fillStyle = c.owner >= 0 ? TEAM_COLORS[c.owner].dark : NEUTRAL_COLOR.dark;
      ctx.fillRect(c.x * scale - 2.5, c.y * scale - 2.5, 5, 5);
      ctx.fillStyle = '#fbf7ea';
      ctx.fillRect(c.x * scale - 1, c.y * scale - 1, 2, 2);
    }
    for (const u of world.units) {
      ctx.fillStyle = TEAM_COLORS[u.team].main;
      const r = u.type === 'heavy' ? 2 : 1.5;
      ctx.fillRect(u.x * scale - r, u.y * scale - r, r * 2, r * 2);
    }
    const cam = this.camera;
    const vw = cam.viewW / cam.zoom;
    const vh = cam.viewH / cam.zoom;
    ctx.strokeStyle = 'rgba(30,26,20,0.85)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect((cam.x - vw / 2) * scale, (cam.y - vh / 2) * scale, vw * scale, vh * scale);
  }
}
