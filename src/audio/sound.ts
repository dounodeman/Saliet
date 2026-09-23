/**
 * Sound hooks. Every game event that deserves audio calls `sound.play(name)`.
 * The default implementation synthesizes tiny blips with WebAudio (no asset
 * files); swapping in sampled sounds later only means changing this file.
 */

export type SoundName =
  | 'select'
  | 'move'
  | 'line'
  | 'queue'
  | 'spawn'
  | 'death'
  | 'capture'
  | 'cityLost'
  | 'error'
  | 'victory'
  | 'defeat'
  | 'ui';

interface Blip {
  freq: number;
  to?: number;
  dur: number;
  type: OscillatorType;
  gain: number;
  delay?: number;
}

const SOUNDS: Record<SoundName, Blip[]> = {
  select: [{ freq: 660, dur: 0.05, type: 'triangle', gain: 0.05 }],
  move: [{ freq: 520, to: 700, dur: 0.07, type: 'triangle', gain: 0.05 }],
  line: [
    { freq: 440, to: 660, dur: 0.08, type: 'triangle', gain: 0.05 },
    { freq: 660, to: 880, dur: 0.08, type: 'triangle', gain: 0.04, delay: 0.06 },
  ],
  queue: [{ freq: 780, dur: 0.05, type: 'sine', gain: 0.05 }],
  spawn: [{ freq: 360, to: 540, dur: 0.12, type: 'sine', gain: 0.05 }],
  death: [{ freq: 180, to: 70, dur: 0.18, type: 'sawtooth', gain: 0.025 }],
  capture: [
    { freq: 523, dur: 0.12, type: 'triangle', gain: 0.06 },
    { freq: 784, dur: 0.18, type: 'triangle', gain: 0.06, delay: 0.1 },
  ],
  cityLost: [
    { freq: 392, dur: 0.14, type: 'triangle', gain: 0.06 },
    { freq: 262, dur: 0.22, type: 'triangle', gain: 0.06, delay: 0.12 },
  ],
  error: [{ freq: 160, dur: 0.1, type: 'square', gain: 0.03 }],
  victory: [
    { freq: 523, dur: 0.2, type: 'triangle', gain: 0.07 },
    { freq: 659, dur: 0.2, type: 'triangle', gain: 0.07, delay: 0.18 },
    { freq: 784, dur: 0.4, type: 'triangle', gain: 0.07, delay: 0.36 },
  ],
  defeat: [
    { freq: 392, dur: 0.25, type: 'triangle', gain: 0.07 },
    { freq: 330, dur: 0.25, type: 'triangle', gain: 0.07, delay: 0.22 },
    { freq: 262, dur: 0.5, type: 'triangle', gain: 0.07, delay: 0.44 },
  ],
  ui: [{ freq: 900, dur: 0.03, type: 'sine', gain: 0.04 }],
};

class SoundSystem {
  muted = false;
  private ctx: AudioContext | null = null;
  private lastPlayed = new Map<SoundName, number>();

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    return this.ctx;
  }

  play(name: SoundName): void {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    // Rate-limit noisy sounds (e.g. many deaths in one tick).
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.06) return;
    this.lastPlayed.set(name, now);
    for (const b of SOUNDS[name]) {
      const t0 = now + (b.delay ?? 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = b.type;
      osc.frequency.setValueAtTime(b.freq, t0);
      if (b.to) osc.frequency.exponentialRampToValueAtTime(b.to, t0 + b.dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(b.gain, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + b.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + b.dur + 0.02);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}

export const sound = new SoundSystem();
