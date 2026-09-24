import type { Command } from '../sim/commands';
import { hashWorld } from '../sim/hash';
import type { World } from '../sim/types';
import type { NetMessage, Transport } from './protocol';

/** How often (in ticks) the two sides compare state hashes. */
export const HASH_EVERY = 100;

/**
 * Deterministic lockstep for two players.
 *
 * Both clients run the same simulation. A command issued locally on tick t is
 * scheduled for tick t + delay and sent to the peer right away; a tick may only
 * be simulated once both players' commands for it are known (every tick is
 * sent, even if empty). Commands run in team order, so both clients apply
 * exactly the same inputs in the same order and stay bit-identical. Periodic
 * state hashes catch any desync.
 */
export class Lockstep {
  private local = new Map<number, Command[]>();
  private remote = new Map<number, Command[]>();
  private pending: Command[] = [];
  private lastScheduled: number;
  private localHashes = new Map<number, string>();
  private remoteHashes = new Map<number, string>();
  /** Real time (ms) since which we have been waiting for the peer, or -1. */
  waitingSince = -1;
  desyncedAt = -1;
  onDesync: ((tick: number) => void) | null = null;

  constructor(
    private transport: Transport,
    readonly localTeam: number,
    readonly remoteTeam: number,
    readonly delay: number,
    readonly game: number,
  ) {
    // Ticks before the first possible input are empty for both sides.
    this.lastScheduled = delay - 1;
  }

  /** Queues a command from the local player (it runs `delay` ticks from now). */
  queueLocal(cmd: Command): void {
    if (cmd.team !== this.localTeam) return;
    this.pending.push(cmd);
  }

  /** Feed every incoming message here. Returns true if it was a lockstep message. */
  handle(msg: NetMessage): boolean {
    if (msg.k === 'cmds') {
      if (msg.g !== this.game) return true;
      // Never trust the peer with commands for our own team.
      this.remote.set(
        msg.t,
        (Array.isArray(msg.c) ? msg.c : []).filter((c) => c && c.team === this.remoteTeam),
      );
      return true;
    }
    if (msg.k === 'hash') {
      if (msg.g !== this.game) return true;
      this.remoteHashes.set(msg.t, msg.h);
      this.compare(msg.t);
      return true;
    }
    return false;
  }

  /**
   * Called before simulating tick `t`. Schedules and sends local input for tick
   * t + delay (once), then returns the ordered commands for tick t, or null if
   * the peer's input for t has not arrived yet.
   */
  tryTick(t: number, nowMs: number): Command[] | null {
    while (this.lastScheduled < t + this.delay) {
      const at = ++this.lastScheduled;
      const cmds = at === t + this.delay ? this.pending : [];
      if (at === t + this.delay) this.pending = [];
      this.local.set(at, cmds);
      this.transport.send({ k: 'cmds', g: this.game, t: at, c: cmds });
    }
    if (t >= this.delay && !this.remote.has(t)) {
      if (this.waitingSince < 0) this.waitingSince = nowMs;
      return null;
    }
    this.waitingSince = -1;
    const mine = this.local.get(t) ?? [];
    const theirs = this.remote.get(t) ?? [];
    this.local.delete(t);
    this.remote.delete(t);
    return this.localTeam < this.remoteTeam ? [...mine, ...theirs] : [...theirs, ...mine];
  }

  /** Called after each simulated tick; exchanges state hashes periodically. */
  afterStep(world: World): void {
    if (world.tick % HASH_EVERY !== 0) return;
    const h = hashWorld(world);
    this.localHashes.set(world.tick, h);
    this.transport.send({ k: 'hash', g: this.game, t: world.tick, h });
    this.compare(world.tick);
  }

  private compare(t: number): void {
    const a = this.localHashes.get(t);
    const b = this.remoteHashes.get(t);
    if (a === undefined || b === undefined) return;
    this.localHashes.delete(t);
    this.remoteHashes.delete(t);
    if (a !== b && this.desyncedAt < 0) {
      this.desyncedAt = t;
      this.onDesync?.(t);
    }
  }
}
