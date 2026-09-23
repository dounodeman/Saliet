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

  constructor(
    private readonly tick: () => void,
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
      const realDt = this.last < 0 ? 0 : Math.min(0.25, (t - this.last) / 1000);
      this.last = t;
      if (!this.paused) this.acc += realDt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.tick();
        this.acc -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, DT); // drop backlog rather than spiral
      this.frame(this.paused ? 1 : this.acc / DT, realDt);
    };
    this.raf = requestAnimationFrame(onFrame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
