import { UNIT_STATS, type UnitType } from '../config';
import { simplifyPolyline } from '../sim/formation';
import type { Command } from '../sim/commands';
import type { Vec2, World } from '../sim/types';
import type { Camera } from '../render/camera';
import { interpolated } from '../render/renderer';

/** What the input layer needs from the running game session. */
export interface InputHost {
  readonly camera: Camera;
  readonly playerTeam: number;
  readonly selection: Set<number>;
  getWorld(): World;
  alpha(): number;
  issue(cmd: Command): void;
  setSpawnCity(cityId: number): void;
  queueUnit(type: UnitType): void;
  togglePause(): void;
  changeSpeed(dir: 1 | -1): void;
  openMenu(): void;
  toggleMute(): void;
  feedback(kind: 'select' | 'move' | 'line' | 'error'): void;
  /** False while a menu overlay is open. */
  acceptsInput(): boolean;
}

const DRAG_THRESHOLD = 5; // px
const EDGE = 14; // px from the canvas edge that triggers edge-scrolling
const PAN_SPEED = 900; // px per second
const LINE_SAMPLE_PX = 6;

/**
 * Translates mouse/keyboard into selection changes, camera moves and sim Commands.
 *
 *  left click/drag   select / box-select (Shift adds, click own city = spawn city)
 *  right click       move (Shift queues)
 *  right drag        draw a front line (Shift queues)
 */
export class InputController {
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  linePoints: Vec2[] | null = null;
  hoverUnitId = -1;
  mouse = { x: 0, y: 0, inside: false };

  private leftDown = false;
  private rightDown = false;
  private rightStart = { x: 0, y: 0 };
  private rightScreenLen = 0;
  private lastScreen = { x: 0, y: 0 };
  private keys = new Set<string>();
  private groups = new Map<number, number[]>();
  private lastGroupKey = { digit: -1, time: 0 };
  private lastClick = { time: 0, unitId: -1 };
  private disposers: Array<() => void> = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private host: InputHost,
  ) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, 'mousedown', (e) => this.onMouseDown(e));
    on(window, 'mousemove', (e) => this.onMouseMove(e));
    on(window, 'mouseup', (e) => this.onMouseUp(e));
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mouseenter', () => (this.mouse.inside = true));
    on(canvas, 'mouseleave', () => (this.mouse.inside = false));
    on(window, 'blur', () => this.keys.clear());
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  /** Per-frame camera panning from keys and screen edges. */
  update(realDt: number): void {
    if (!this.host.acceptsInput()) return;
    const cam = this.host.camera;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.mouse.inside && !this.leftDown && !this.rightDown && document.hasFocus()) {
      if (this.mouse.x < EDGE) dx -= 1;
      if (this.mouse.x > cam.viewW - EDGE) dx += 1;
      if (this.mouse.y < EDGE) dy -= 1;
      if (this.mouse.y > cam.viewH - EDGE) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      cam.panPixels(dx * PAN_SPEED * realDt, dy * PAN_SPEED * realDt);
      const w = this.host.getWorld().map;
      cam.clampTo(w.width, w.height);
    }
    this.hoverUnitId = this.leftDown || this.rightDown ? -1 : this.unitAt(this.mouse.x, this.mouse.y);
  }

  private localPos(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Own unit under a screen point, or -1. */
  unitAt(sx: number, sy: number): number {
    const cam = this.host.camera;
    const world = this.host.getWorld();
    const alpha = this.host.alpha();
    let best = -1;
    let bestD = Infinity;
    for (const u of world.units) {
      if (u.team !== this.host.playerTeam) continue;
      const ip = interpolated(u, alpha);
      const p = cam.worldToScreen(ip.x, ip.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const hit = Math.max(UNIT_STATS[u.type].radius * cam.zoom, 6) + 3;
      if (d <= hit && d < bestD) {
        bestD = d;
        best = u.id;
      }
    }
    return best;
  }

  private cityAt(sx: number, sy: number): number {
    const w = this.host.camera.screenToWorld(sx, sy);
    for (const c of this.host.getWorld().cities) {
      if (Math.hypot(c.x - w.x, c.y - w.y) <= 1.5) return c.id;
    }
    return -1;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.host.acceptsInput()) return;
    const p = this.localPos(e);
    this.mouse = { x: p.x, y: p.y, inside: true };
    if (e.button === 0) {
      this.leftDown = true;
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    } else if (e.button === 2) {
      if (this.host.selection.size === 0) return;
      this.rightDown = true;
      this.rightStart = p;
      this.rightScreenLen = 0;
      this.lastScreen = p;
      this.linePoints = [this.host.camera.screenToWorld(p.x, p.y)];
    } else if (e.button === 1) {
      e.preventDefault();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const p = this.localPos(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    if (this.leftDown && this.box) {
      this.box.x1 = p.x;
      this.box.y1 = p.y;
    }
    if (this.rightDown && this.linePoints) {
      const d = Math.hypot(p.x - this.lastScreen.x, p.y - this.lastScreen.y);
      if (d >= LINE_SAMPLE_PX) {
        this.rightScreenLen += d;
        this.lastScreen = p;
        this.linePoints.push(this.host.camera.screenToWorld(p.x, p.y));
      }
    }
    if (e.buttons & 4) {
      // Middle-drag pans.
      this.host.camera.panPixels(-e.movementX, -e.movementY);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    const p = this.localPos(e);
    if (e.button === 0 && this.leftDown) {
      this.leftDown = false;
      const box = this.box;
      this.box = null;
      if (!box || !this.host.acceptsInput()) return;
      const dragged = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > DRAG_THRESHOLD;
      if (dragged) this.boxSelect(box, e.shiftKey);
      else this.clickSelect(p, e.shiftKey);
    } else if (e.button === 2 && this.rightDown) {
      this.rightDown = false;
      const pts = this.linePoints;
      this.linePoints = null;
      if (!pts || !this.host.acceptsInput()) return;
      const ids = [...this.host.selection];
      if (ids.length === 0) return;
      const total = this.rightScreenLen + Math.hypot(p.x - this.lastScreen.x, p.y - this.lastScreen.y);
      if (total < DRAG_THRESHOLD * 2 || pts.length < 2) {
        const w = this.host.camera.screenToWorld(this.rightStart.x, this.rightStart.y);
        this.host.issue({ kind: 'move', team: this.host.playerTeam, unitIds: ids, x: w.x, y: w.y, queue: e.shiftKey });
        this.host.feedback('move');
      } else {
        pts.push(this.host.camera.screenToWorld(p.x, p.y));
        const simple = simplifyPolyline(pts, 0.25).slice(0, 64);
        this.host.issue({
          kind: 'line',
          team: this.host.playerTeam,
          unitIds: ids,
          points: simple.map((q) => [q.x, q.y] as [number, number]),
          queue: e.shiftKey,
        });
        this.host.feedback('line');
      }
    }
  }

  private clickSelect(p: Vec2, shift: boolean): void {
    const sel = this.host.selection;
    const id = this.unitAt(p.x, p.y);
    const now = performance.now();
    if (id >= 0) {
      const world = this.host.getWorld();
      const u = world.unitById.get(id)!;
      if (this.lastClick.unitId === id && now - this.lastClick.time < 350) {
        // Double click: every own unit of this type on screen.
        if (!shift) sel.clear();
        const cam = this.host.camera;
        for (const o of world.units) {
          if (o.team !== this.host.playerTeam || o.type !== u.type) continue;
          const s = cam.worldToScreen(o.x, o.y);
          if (s.x >= 0 && s.y >= 0 && s.x <= cam.viewW && s.y <= cam.viewH) sel.add(o.id);
        }
      } else if (shift) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
      } else {
        sel.clear();
        sel.add(id);
      }
      this.lastClick = { time: now, unitId: id };
      this.host.feedback('select');
      return;
    }
    const cityId = this.cityAt(p.x, p.y);
    if (cityId >= 0) {
      const city = this.host.getWorld().cities.find((c) => c.id === cityId)!;
      if (city.owner === this.host.playerTeam) {
        this.host.setSpawnCity(cityId);
        return;
      }
    }
    if (!shift) sel.clear();
  }

  private boxSelect(box: { x0: number; y0: number; x1: number; y1: number }, shift: boolean): void {
    const sel = this.host.selection;
    if (!shift) sel.clear();
    const cam = this.host.camera;
    const alpha = this.host.alpha();
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const y1 = Math.max(box.y0, box.y1);
    for (const u of this.host.getWorld().units) {
      if (u.team !== this.host.playerTeam) continue;
      const w = interpolated(u, alpha);
      const s = cam.worldToScreen(w.x, w.y);
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) sel.add(u.id);
    }
    if (sel.size > 0) this.host.feedback('select');
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.host.acceptsInput()) return;
    const p = this.localPos(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.host.camera.zoomAt(p.x, p.y, Math.pow(1.0015, -delta));
    const w = this.host.getWorld().map;
    this.host.camera.clampTo(w.width, w.height);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      e.preventDefault();
      this.host.openMenu();
      return;
    }
    if (!this.host.acceptsInput()) return;
    const mod = e.ctrlKey || e.metaKey;
    this.keys.add(key);
    if (key === ' ') {
      e.preventDefault();
      this.host.togglePause();
    } else if (key === '+' || key === '=') {
      this.host.changeSpeed(1);
    } else if (key === '-' || key === '_') {
      this.host.changeSpeed(-1);
    } else if (key === 'q') {
      this.host.queueUnit('light');
    } else if (key === 'e') {
      this.host.queueUnit('heavy');
    } else if (key === 'h') {
      const ids = [...this.host.selection];
      if (ids.length) this.host.issue({ kind: 'halt', team: this.host.playerTeam, unitIds: ids });
    } else if (key === 'm') {
      this.host.toggleMute();
    } else if (key === 'f') {
      this.centerOnSelection();
    } else if (key === 'a' && mod) {
      e.preventDefault();
      this.host.selection.clear();
      for (const u of this.host.getWorld().units) if (u.team === this.host.playerTeam) this.host.selection.add(u.id);
      this.host.feedback('select');
    } else if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      this.controlGroup(Number(key), mod);
    }
  }

  private controlGroup(digit: number, assign: boolean): void {
    const sel = this.host.selection;
    if (assign) {
      this.groups.set(digit, [...sel]);
      this.host.feedback('select');
      return;
    }
    const ids = (this.groups.get(digit) ?? []).filter((id) => this.host.getWorld().unitById.has(id));
    this.groups.set(digit, ids);
    if (ids.length === 0) return;
    sel.clear();
    for (const id of ids) sel.add(id);
    const now = performance.now();
    if (this.lastGroupKey.digit === digit && now - this.lastGroupKey.time < 400) this.centerOnSelection();
    this.lastGroupKey = { digit, time: now };
    this.host.feedback('select');
  }

  centerOnSelection(): void {
    const world = this.host.getWorld();
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of this.host.selection) {
      const u = world.unitById.get(id);
      if (!u) continue;
      x += u.x;
      y += u.y;
      n++;
    }
    if (n > 0) this.host.camera.centerOn({ x: x / n, y: y / n });
  }
}
