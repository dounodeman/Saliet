import type { NetMessage, Transport } from './protocol';

interface Pending {
  at: number;
  to: FakeTransport;
  msg: NetMessage;
}

/** One end of an in-memory connection (used by tests and local experiments). */
export class FakeTransport implements Transport {
  onMessage: ((msg: NetMessage) => void) | null = null;
  onClose: (() => void) | null = null;
  open = true;
  peer!: FakeTransport;
  lastArrival = 0;

  constructor(private net: FakeNetwork) {}

  send(msg: NetMessage): void {
    if (!this.open) return;
    // Round-trip through JSON like a real channel would.
    this.net.enqueue(this.peer, JSON.parse(JSON.stringify(msg)) as NetMessage);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.peer.open = false;
    this.peer.onClose?.();
  }
}

/**
 * Simulated network with latency and jitter on a virtual clock. Delivery is
 * reliable and ordered per direction, like a WebRTC reliable data channel.
 */
export class FakeNetwork {
  now = 0;
  private queue: Pending[] = [];
  private seed = 12345;

  constructor(
    private latencyMs = 40,
    private jitterMs = 20,
  ) {}

  private random(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return this.seed / 4294967296;
  }

  pair(): [FakeTransport, FakeTransport] {
    const a = new FakeTransport(this);
    const b = new FakeTransport(this);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  enqueue(to: FakeTransport, msg: NetMessage): void {
    const at = Math.max(to.lastArrival, this.now + this.latencyMs + this.random() * this.jitterMs);
    to.lastArrival = at;
    this.queue.push({ at, to, msg });
  }

  /** Advances the clock and delivers everything that has arrived. */
  advance(ms: number): void {
    this.now += ms;
    this.queue.sort((x, y) => x.at - y.at);
    while (this.queue.length > 0 && this.queue[0].at <= this.now) {
      const p = this.queue.shift()!;
      if (p.to.open) p.to.onMessage?.(p.msg);
    }
  }
}
