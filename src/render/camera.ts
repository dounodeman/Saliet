import type { Vec2 } from '../sim/types';

/** 2D camera: `zoom` is screen pixels (CSS px) per world cell. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 10;
  viewW = 1;
  viewH = 1;
  minZoom = 3;
  maxZoom = 64;

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y };
  }

  /** Zoom by `factor`, keeping the world point under the cursor fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  panPixels(dx: number, dy: number): void {
    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
  }

  /** Fit the whole map on screen and allow zooming out a little further. */
  fit(mapW: number, mapH: number, margin = 0.94): void {
    this.zoom = Math.min(this.viewW / mapW, this.viewH / mapH) * margin;
    this.minZoom = Math.min(this.zoom * 0.8, 6);
    this.x = mapW / 2;
    this.y = mapH / 2;
  }

  /** Keep the view centre on the map. */
  clampTo(mapW: number, mapH: number): void {
    this.x = Math.min(mapW, Math.max(0, this.x));
    this.y = Math.min(mapH, Math.max(0, this.y));
  }

  centerOn(p: Vec2): void {
    this.x = p.x;
    this.y = p.y;
  }
}
