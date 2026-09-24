import { DT, GAME_SPEEDS } from '../config';

const MAX_STEPS_PER_FRAME = 12;

/**
 * Fixed-timestep driver: real time (scaled by game speed) fills an accumulator
 * that is drained in DT-sized simulation ticks; rendering gets the leftover
 * fraction for interpolation.
 */
export class FixedLoop {
  paused = false;
  speedIndex = 1;
  private acc = 0;
  private last = -1;
  private raf = 0;
  private running = false;
  private pump: Worker | null = null;
  private lastFrameAt = 0;
  /** Keep simulating while the tab is hidden (online games). */
  keepAliveWhenHidden = false;

  /** `tick` may return false to say "not now" (e.g. still waiting for the other player). */
  constructor(
    private readonly tick: () => boolean | void,
    private readonly frame: (alpha: number, realDt: number) => void,
  ) {}

  get speed(): number {
    return GAME_SPEEDS[this.speedIndex];
  }

  changeSpeed(dir: 1 | -1): void {
    this.speedIndex = Math.min(GAME_SPEEDS.length - 1, Math.max(0, this.speedIndex + dir));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    const onFrame = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(onFrame);
      this.lastFrameAt = performance.now();
      this.advance(t, true);
    };
    this.raf = requestAnimationFrame(onFrame);
    if (this.keepAliveWhenHidden) this.startPump();
  }

  /** Runs due simulation ticks; renders only when visible. */
  private advance(t: number, render: boolean): void {
    const realDt = this.last < 0 ? 0 : Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    if (!this.paused) this.acc += realDt * this.speed;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      if (this.tick() === false) {
        // Stalled: keep a little backlog so we can catch up, but don't hoard.
        this.acc = Math.min(this.acc, DT * 8);
        break;
      }
      this.acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, DT); // drop backlog rather than spiral
    if (render) this.frame(this.paused ? 1 : this.acc / DT, realDt);
  }

  /**
   * Browsers stop or throttle animation frames in background tabs and hidden
   * windows. In online games that would freeze both players, so a tiny Web
   * Worker timer (which isn't frozen) keeps the simulation ticking whenever
   * frames have stalled.
   */
  private startPump(): void {
    try {
      const src = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25);'], { type: 'text/javascript' }));
      this.pump = new Worker(src);
      URL.revokeObjectURL(src);
      this.pump.onmessage = () => {
        const now = performance.now();
        if (this.running && now - this.lastFrameAt > 150) this.advance(now, false);
      };
    } catch {
      this.pump = null; // workers unavailable: frames only
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.pump?.terminate();
    this.pump = null;
  }
}
