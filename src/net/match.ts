import { Lockstep } from './lockstep';
import { GUEST_TEAM, HOST_TEAM, PROTOCOL_VERSION, type MatchSettings, type NetMessage, type Transport } from './protocol';

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

function waitFor<K extends NetMessage['k']>(
  t: Transport,
  kinds: K[],
  timeoutMs: number,
  onOther?: (m: NetMessage) => void,
): Promise<Extract<NetMessage, { k: K }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Your friend stopped responding.')), timeoutMs);
    t.onClose = () => {
      clearTimeout(timer);
      reject(new Error('The connection closed.'));
    };
    t.onMessage = (m) => {
      if ((kinds as string[]).includes(m.k)) {
        clearTimeout(timer);
        t.onMessage = null;
        resolve(m as Extract<NetMessage, { k: K }>);
      } else {
        onOther?.(m);
      }
    };
  });
}

/** Host side: check the guest's version and measure the round-trip time (ms). */
export async function hostHandshake(t: Transport): Promise<number> {
  const hello = await waitFor(t, ['hello'], 10_000);
  if (hello.v !== PROTOCOL_VERSION || hello.build !== BUILD_ID) {
    t.send({ k: 'reject', reason: 'You and your friend have different versions of the game. Both of you: refresh the page and try again.' });
    throw new Error('Your friend has a different version of the game. Both of you should refresh the page.');
  }
  t.send({ k: 'welcome' });
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const sent = performance.now();
    t.send({ k: 'ping', t: sent });
    const pong = await waitFor(t, ['pong'], 5_000);
    samples.push(performance.now() - pong.t);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** Guest side: introduce ourselves, answer pings, and wait for the match settings. */
export async function guestHandshake(t: Transport): Promise<MatchSettings> {
  t.send({ k: 'hello', v: PROTOCOL_VERSION, build: BUILD_ID });
  const answer = await waitFor(t, ['welcome', 'reject'], 10_000);
  if (answer.k === 'reject') throw new Error(answer.reason);
  const start = await waitFor(t, ['start', 'reject'], 15_000, (m) => {
    if (m.k === 'ping') t.send({ k: 'pong', t: m.t });
  });
  if (start.k === 'reject') throw new Error(start.reason);
  return start.settings;
}

/**
 * A connected two-player session that can span several games (rematches).
 * Routes lockstep traffic to the current game and keeps a live ping estimate.
 */
export class NetMatch {
  lockstep: Lockstep | null = null;
  rtt: number;
  onStart: ((settings: MatchSettings) => void) | null = null;
  onPeerLeft: ((reason: string) => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval>;
  private left = false;
  /** Lockstep traffic for a game that hasn't been set up locally yet. */
  private early: NetMessage[] = [];
  private lastHeard = performance.now();
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    readonly transport: Transport,
    readonly role: 'host' | 'guest',
    initialRtt = 100,
  ) {
    this.rtt = initialRtt;
    transport.onMessage = (m) => this.handle(m);
    transport.onClose = () => this.peerGone('Your friend disconnected.');
    this.pingTimer = setInterval(() => transport.send({ k: 'ping', t: performance.now() }), 2000);
    // Browsers don't always report a vanished peer; if we're stuck waiting and
    // haven't heard anything for a while, assume they're gone.
    this.watchdog = setInterval(() => {
      const silentMs = performance.now() - this.lastHeard;
      const waiting = this.lockstep !== null && this.lockstep.waitingSince >= 0;
      if (silentMs > (waiting ? 10_000 : 45_000)) this.peerGone('Lost the connection to your friend.');
    }, 1000);
  }

  get localTeam(): number {
    return this.role === 'host' ? HOST_TEAM : GUEST_TEAM;
  }

  get remoteTeam(): number {
    return this.role === 'host' ? GUEST_TEAM : HOST_TEAM;
  }

  get connected(): boolean {
    return !this.left && this.transport.open;
  }

  /** Sets up lockstep for a new game (both sides call this with the same settings). */
  beginGame(settings: MatchSettings): Lockstep {
    const ls = new Lockstep(this.transport, this.localTeam, this.remoteTeam, settings.delay, settings.game);
    this.lockstep = ls;
    const early = this.early;
    this.early = [];
    for (const m of early) if ((m.k === 'cmds' || m.k === 'hash') && m.g === settings.game) ls.handle(m);
    return ls;
  }

  /** Host only: start a game on both machines. */
  startGame(settings: MatchSettings): void {
    this.transport.send({ k: 'start', settings });
    this.onStart?.(settings);
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    clearInterval(this.pingTimer);
    clearInterval(this.watchdog);
    this.transport.send({ k: 'leave' });
    setTimeout(() => this.transport.close(), 300);
  }

  private handle(m: NetMessage): void {
    this.lastHeard = performance.now();
    if (m.k === 'cmds' || m.k === 'hash') {
      if (this.lockstep && m.g === this.lockstep.game) this.lockstep.handle(m);
      else if (!this.lockstep || m.g > this.lockstep.game) this.early.push(m);
      return;
    }
    switch (m.k) {
      case 'ping':
        this.transport.send({ k: 'pong', t: m.t });
        break;
      case 'pong':
        this.rtt = this.rtt * 0.7 + (performance.now() - m.t) * 0.3;
        break;
      case 'start':
        if (this.role === 'guest') this.onStart?.(m.settings);
        break;
      case 'leave':
        this.peerGone('Your friend left the game.');
        break;
      default:
        break;
    }
  }

  private peerGone(reason: string): void {
    if (this.left) return;
    this.left = true;
    clearInterval(this.pingTimer);
    clearInterval(this.watchdog);
    this.transport.close();
    this.onPeerLeft?.(reason);
  }
}
