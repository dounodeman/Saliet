/** Short-lived visual effects (render-only, never touch the simulation). */

export interface Effect {
  kind: 'ring' | 'spark' | 'puff';
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  color: string;
  width: number;
}

export class Effects {
  list: Effect[] = [];

  ring(x: number, y: number, now: number, color: string, r0: number, r1: number, dur = 0.6, width = 2): void {
    this.list.push({ kind: 'ring', x, y, vx: 0, vy: 0, t0: now, dur, r0, r1, color, width });
  }

  spark(x: number, y: number, vx: number, vy: number, now: number, color: string): void {
    this.list.push({ kind: 'spark', x, y, vx, vy, t0: now, dur: 0.25 + Math.random() * 0.2, r0: 0.08, r1: 0.02, color, width: 1 });
  }

  puff(x: number, y: number, now: number, color: string, r = 0.9): void {
    this.list.push({ kind: 'puff', x, y, vx: 0, vy: 0, t0: now, dur: 0.9, r0: r * 0.4, r1: r, color, width: 1 });
  }

  prune(now: number): void {
    if (this.list.length === 0) return;
    this.list = this.list.filter((e) => now - e.t0 < e.dur);
  }

  /** Draw in world coordinates (the caller has applied the camera transform). */
  draw(ctx: CanvasRenderingContext2D, now: number, zoom: number): void {
    for (const e of this.list) {
      const t = Math.min(1, Math.max(0, (now - e.t0) / e.dur));
      const r = e.r0 + (e.r1 - e.r0) * t;
      ctx.globalAlpha = 1 - t;
      if (e.kind === 'ring') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.width / zoom;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'puff') {
        ctx.globalAlpha = (1 - t) * 0.45;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const age = now - e.t0;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x + e.vx * age, e.y + e.vy * age, Math.max(r, 1.2 / zoom), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
