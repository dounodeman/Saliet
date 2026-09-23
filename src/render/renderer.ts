import { UNIT_STATS } from '../config';
import { lineSlots } from '../sim/formation';
import type { MapData, Unit, Vec2, World } from '../sim/types';
import type { Camera } from './camera';
import { Effects } from './effects';
import { BACKGROUND, INK, NEUTRAL_COLOR, TEAM_COLORS, teamColor } from './palette';
import { bakeTerrain } from './terrainLayer';

export interface RenderState {
  world: World;
  /** Interpolation factor between the previous and current tick, 0..1. */
  alpha: number;
  playerTeam: number;
  selection: ReadonlySet<number>;
  /** Screen-space drag rectangle while box-selecting. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** World-space polyline while drawing a front line. */
  linePreview: Vec2[] | null;
  spawnCityId: number;
  hoverUnitId: number;
  /** Real time in seconds (animations). */
  now: number;
}

export function interpolated(u: Unit, alpha: number): Vec2 {
  return { x: u.prevX + (u.x - u.prevX) * alpha, y: u.prevY + (u.y - u.prevY) * alpha };
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly effects = new Effects();
  private terrain: HTMLCanvasElement;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    map: MapData,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = bakeTerrain(map);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  render(s: RenderState, cam: Camera): void {
    const ctx = this.ctx;
    const { world } = s;
    const z = cam.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // World space.
    ctx.save();
    ctx.translate(this.cssW / 2, this.cssH / 2);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);

    const W = world.map.width;
    const H = world.map.height;
    ctx.fillStyle = 'rgba(60,50,30,0.25)';
    ctx.fillRect(0.35, 0.5, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain, 0, 0, W, H);
    ctx.strokeStyle = 'rgba(60,52,40,0.8)';
    ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(0, 0, W, H);

    this.drawCities(s, z);
    this.drawOrders(s, z);
    this.drawUnits(s, z);
    this.effects.prune(s.now);
    this.effects.draw(ctx, s.now, z);
    this.drawLinePreview(s, z);
    ctx.restore();

    // Screen space.
    this.drawCityLabels(s, cam);
    if (s.box) {
      const { x0, y0, x1, y1 } = s.box;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
    }
  }

  private drawCities(s: RenderState, z: number): void {
    const ctx = this.ctx;
    for (const c of s.world.cities) {
      const col = teamColor(c.owner);
      // Capture progress track.
      if (c.captureProgress > 0 && c.captureTeam >= 0) {
        ctx.strokeStyle = 'rgba(40,35,30,0.25)';
        ctx.lineWidth = 3.5 / z;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 1.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = TEAM_COLORS[c.captureTeam].main;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 1.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.captureProgress);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(250,246,234,0.7)';
      ctx.strokeStyle = col.main;
      ctx.lineWidth = 2.2 / z;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col.main;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = 1 / z;
      ctx.stroke();
      ctx.fillStyle = '#fbf7ea';
      ctx.fillRect(c.x - 0.15, c.y - 0.15, 0.3, 0.3);

      if (c.id === s.spawnCityId && c.owner === s.playerTeam) {
        // A small flag marks the player's spawn city.
        const pc = TEAM_COLORS[s.playerTeam];
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.2 / z;
        ctx.beginPath();
        ctx.moveTo(c.x + 0.9, c.y - 0.6);
        ctx.lineTo(c.x + 0.9, c.y - 2.3);
        ctx.stroke();
        ctx.fillStyle = pc.main;
        ctx.beginPath();
        ctx.moveTo(c.x + 0.9, c.y - 2.3);
        ctx.lineTo(c.x + 2.0, c.y - 1.95);
        ctx.lineTo(c.x + 0.9, c.y - 1.6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawCityLabels(s: RenderState, cam: Camera): void {
    if (cam.zoom < 5) return;
    const ctx = this.ctx;
    ctx.font = '600 11px "Avenir Next", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const c of s.world.cities) {
      const p = cam.worldToScreen(c.x, c.y + 1.35);
      if (p.x < -60 || p.y < -20 || p.x > this.cssW + 60 || p.y > this.cssH + 20) continue;
      ctx.strokeStyle = 'rgba(248,244,230,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(c.name, p.x, p.y + 2);
      ctx.fillStyle = c.owner >= 0 ? TEAM_COLORS[c.owner].dark : NEUTRAL_COLOR.dark;
      ctx.fillText(c.name, p.x, p.y + 2);
    }
  }

  private drawOrders(s: RenderState, z: number): void {
    if (s.selection.size === 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([4 / z, 3 / z]);
    ctx.beginPath();
    const ends: Vec2[] = [];
    for (const id of s.selection) {
      const u = s.world.unitById.get(id);
      if (!u || u.waypoints.length === 0) continue;
      const p = interpolated(u, s.alpha);
      ctx.moveTo(p.x, p.y);
      if (u.path) for (let i = u.pathIndex; i < u.path.length; i++) ctx.lineTo(u.path[i].x, u.path[i].y);
      else ctx.lineTo(u.waypoints[0].x, u.waypoints[0].y);
      for (let i = 1; i < u.waypoints.length; i++) ctx.lineTo(u.waypoints[i].x, u.waypoints[i].y);
      ends.push(...u.waypoints);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (const e of ends) {
      ctx.moveTo(e.x + 0.18, e.y);
      ctx.arc(e.x, e.y, 0.18, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  private drawUnits(s: RenderState, z: number): void {
    const ctx = this.ctx;
    const units = s.world.units;
    const pos = units.map((u) => interpolated(u, s.alpha));
    const minR = 2.6 / z;
    const radius = (u: Unit) => Math.max(UNIT_STATS[u.type].radius, minR);

    // Soft shadows.
    ctx.fillStyle = 'rgba(40,32,20,0.22)';
    ctx.beginPath();
    units.forEach((u, i) => {
      const r = radius(u);
      ctx.moveTo(pos[i].x + 0.08 + r, pos[i].y + 0.12);
      ctx.arc(pos[i].x + 0.08, pos[i].y + 0.12, r, 0, Math.PI * 2);
    });
    ctx.fill();

    units.forEach((u, i) => {
      const { x, y } = pos[i];
      const col = teamColor(u.team);
      const r = radius(u);
      const lowStamina = u.stamina < 30;
      ctx.globalAlpha = lowStamina ? 0.7 : 1;
      if (u.type === 'heavy') {
        ctx.fillStyle = col.dark;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = col.main;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = col.main;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col.dark;
        ctx.lineWidth = 1.1 / z;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const maxHp = UNIT_STATS[u.type].maxHp;
      if (u.hp < maxHp - 0.5 && z >= 6) {
        const f = Math.max(0, u.hp / maxHp);
        ctx.strokeStyle = f > 0.6 ? '#5fae4e' : f > 0.3 ? '#e0a526' : '#d23c2a';
        ctx.lineWidth = 1.6 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.8 / z, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
        ctx.stroke();
      }
      if (!u.supplied || u.starving) {
        const blink = Math.floor(s.now * 2.5 + u.id * 0.37) % 2 === 0;
        if (blink) {
          ctx.strokeStyle = u.starving ? '#2b1a10' : '#6b5a3a';
          ctx.lineWidth = 1.2 / z;
          ctx.setLineDash([2 / z, 2 / z]);
          ctx.beginPath();
          ctx.arc(x, y, r + 3.4 / z, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (s.selection.has(u.id)) {
        ctx.strokeStyle = 'rgba(20,20,20,0.55)';
        ctx.lineWidth = 3 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.4 / z, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();
      } else if (u.id === s.hoverUnitId) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.2 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.2 / z, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  private drawLinePreview(s: RenderState, z: number): void {
    const pts = s.linePreview;
    if (!pts || pts.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2 / z;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    const n = s.selection.size;
    if (n > 0) {
      ctx.strokeStyle = TEAM_COLORS[s.playerTeam].dark;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.2 / z;
      for (const p of lineSlots(pts, n)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}
