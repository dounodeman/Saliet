import { describe, expect, it, vi } from 'vitest';
import { AIController } from '../src/ai/ai';
import { getMap } from '../src/maps';
import { FakeNetwork } from '../src/net/fakeNetwork';
import { HASH_EVERY, Lockstep } from '../src/net/lockstep';
import { NetMatch } from '../src/net/match';
import { delayForPing, GUEST_TEAM, HOST_TEAM } from '../src/net/protocol';
import { hashWorld } from '../src/sim/hash';
import type { World } from '../src/sim/types';
import { createWorld, step } from '../src/sim/world';

interface Player {
  world: World;
  lockstep: Lockstep;
  ai: AIController;
  nextTickAt: number;
  msPerTick: number;
  stalls: number;
}

/**
 * Runs two lockstep clients over a simulated network. Each client is "played"
 * by an AI that only sees its own world and only issues commands through its
 * lockstep, exactly like a human at the keyboard.
 */
function playOnline(opts: { ticks: number; latency: number; jitter: number; skew: number; mapId?: string; seed?: number }) {
  const seed = opts.seed ?? 3;
  const scenario = () => getMap(opts.mapId ?? 'twin-rivers').build(seed);
  const net = new FakeNetwork(opts.latency, opts.jitter);
  const [hostEnd, guestEnd] = net.pair();
  const delay = delayForPing(opts.latency * 2 + opts.jitter);
  const mk = (team: number, other: number, end: typeof hostEnd, msPerTick: number): Player => {
    const p: Player = {
      world: createWorld(scenario(), seed),
      lockstep: new Lockstep(end, team, other, delay, 1),
      ai: new AIController(team, 'hard', seed),
      nextTickAt: 0,
      msPerTick,
      stalls: 0,
    };
    end.onMessage = (m) => p.lockstep.handle(m);
    return p;
  };
  const host = mk(HOST_TEAM, GUEST_TEAM, hostEnd, 50);
  const guest = mk(GUEST_TEAM, HOST_TEAM, guestEnd, 50 * (1 + opts.skew));
  const players = [host, guest];
  let desyncs = 0;
  for (const p of players) p.lockstep.onDesync = () => desyncs++;

  while (players.some((p) => p.world.tick < opts.ticks)) {
    net.advance(5);
    for (const p of players) {
      while (p.world.tick < opts.ticks && net.now >= p.nextTickAt) {
        const cmds = p.lockstep.tryTick(p.world.tick, net.now);
        if (!cmds) {
          p.stalls++;
          break;
        }
        for (const c of p.ai.update(p.world)) p.lockstep.queueLocal(c);
        step(p.world, cmds);
        p.lockstep.afterStep(p.world);
        p.nextTickAt += p.msPerTick;
      }
    }
    if (net.now > opts.ticks * 200) throw new Error('lockstep deadlock');
  }
  net.advance(1000); // let the last hash messages arrive
  return { host, guest, desyncs, delay };
}

describe('online multiplayer (lockstep)', () => {
  it('two clients over a laggy network stay bit-identical', () => {
    const { host, guest, desyncs } = playOnline({ ticks: 2400, latency: 60, jitter: 40, skew: 0.03 });
    expect(host.world.tick).toBe(2400);
    expect(guest.world.tick).toBe(2400);
    expect(hashWorld(host.world)).toBe(hashWorld(guest.world));
    expect(desyncs).toBe(0);
    // Both actually played: commands from both teams went through.
    expect(host.world.commandLog.some((l) => l.cmd.team === 0)).toBe(true);
    expect(host.world.commandLog.some((l) => l.cmd.team === 1)).toBe(true);
    expect(host.world.teams[0].stats.produced + host.world.teams[1].stats.produced).toBeGreaterThan(5);
  });

  it('works on a random map with a slow link', () => {
    const { host, guest, desyncs } = playOnline({ ticks: 1500, latency: 150, jitter: 80, skew: -0.05, mapId: 'random', seed: 77 });
    expect(hashWorld(host.world)).toBe(hashWorld(guest.world));
    expect(desyncs).toBe(0);
  });

  it('a client cannot advance past a tick without the peer’s input', () => {
    const net = new FakeNetwork(1000, 0);
    const [a] = net.pair();
    const ls = new Lockstep(a, 0, 1, 3, 1);
    expect(ls.tryTick(0, 0)).toEqual([]);
    expect(ls.tryTick(1, 0)).toEqual([]);
    expect(ls.tryTick(2, 0)).toEqual([]);
    expect(ls.tryTick(3, 0)).toBeNull();
    expect(ls.waitingSince).toBe(0);
    ls.handle({ k: 'cmds', g: 1, t: 3, c: [] });
    expect(ls.tryTick(3, 10)).toEqual([]);
    expect(ls.waitingSince).toBe(-1);
  });

  it('local commands run exactly `delay` ticks later, in team order', () => {
    const net = new FakeNetwork(0, 0);
    const [a, b] = net.pair();
    const sent: unknown[] = [];
    b.onMessage = (m) => sent.push(m);
    const ls = new Lockstep(a, 1, 0, 2, 7);
    ls.queueLocal({ kind: 'halt', team: 1, unitIds: [5] });
    ls.queueLocal({ kind: 'halt', team: 0, unitIds: [9] }); // wrong team: ignored
    ls.tryTick(0, 0);
    net.advance(1);
    expect(sent[0]).toEqual({ k: 'cmds', g: 7, t: 2, c: [{ kind: 'halt', team: 1, unitIds: [5] }] });
    ls.tryTick(1, 0);
    ls.handle({ k: 'cmds', g: 7, t: 2, c: [{ kind: 'halt', team: 0, unitIds: [1] }, { kind: 'halt', team: 1, unitIds: [666] }] });
    const cmds = ls.tryTick(2, 0)!;
    // Remote team 0 first, then ours; the spoofed team-1 command from the peer is dropped.
    expect(cmds.map((c) => (c as { unitIds: number[] }).unitIds[0])).toEqual([1, 5]);
  });

  it('ignores messages from a previous game (rematch safety)', () => {
    const net = new FakeNetwork(0, 0);
    const [a] = net.pair();
    const ls = new Lockstep(a, 0, 1, 2, 2);
    ls.handle({ k: 'cmds', g: 1, t: 2, c: [] });
    ls.tryTick(0, 0);
    ls.tryTick(1, 0);
    expect(ls.tryTick(2, 0)).toBeNull();
  });

  it('detects a desync through hash exchange', () => {
    const net = new FakeNetwork(0, 0);
    const [a, b] = net.pair();
    const w1 = createWorld(getMap('twin-rivers').build(1), 1);
    const w2 = createWorld(getMap('twin-rivers').build(1), 1);
    const l1 = new Lockstep(a, 0, 1, 2, 1);
    const l2 = new Lockstep(b, 1, 0, 2, 1);
    a.onMessage = (m) => l1.handle(m);
    b.onMessage = (m) => l2.handle(m);
    let desync = -1;
    l1.onDesync = (t) => (desync = t);
    w2.teams[1].pp += 7; // corrupt one client (production points never self-correct)
    for (let t = 0; t < HASH_EVERY; t++) {
      const c1 = l1.tryTick(w1.tick, 0);
      const c2 = l2.tryTick(w2.tick, 0);
      net.advance(1);
      step(w1, c1 ?? []);
      step(w2, c2 ?? []);
      l1.afterStep(w1);
      l2.afterStep(w2);
      net.advance(1);
    }
    expect(desync).toBe(HASH_EVERY);
  });

  it('chooses a larger input delay for slower connections', () => {
    expect(delayForPing(20)).toBe(2);
    expect(delayForPing(150)).toBeGreaterThan(delayForPing(40));
    expect(delayForPing(5000)).toBe(10);
  });
});

describe('match flow (NetMatch)', () => {
  function setup() {
    vi.useFakeTimers();
    const net = new FakeNetwork(30, 0);
    const [a, b] = net.pair();
    const host = new NetMatch(a, 'host', 60);
    const guest = new NetMatch(b, 'guest', 60);
    return { net, host, guest };
  }

  it('the host starts games on both sides; rematches get a new game id', () => {
    const { net, host, guest } = setup();
    const started: number[] = [];
    host.onStart = (s) => host.beginGame(s);
    guest.onStart = (s) => {
      started.push(s.game);
      guest.beginGame(s);
    };
    host.startGame({ mapId: 'twin-rivers', seed: 1, delay: 2, game: 1 });
    net.advance(100);
    host.startGame({ mapId: 'twin-rivers', seed: 1, delay: 2, game: 2 });
    net.advance(100);
    expect(started).toEqual([1, 2]);
    expect(guest.lockstep!.game).toBe(2);
    expect(guest.localTeam).toBe(1);
    host.leave();
    vi.useRealTimers();
  });

  it('keeps lockstep messages that arrive before the game is set up locally', () => {
    const { net, host, guest } = setup();
    let pending: Parameters<NonNullable<typeof guest.onStart>>[0] | null = null;
    guest.onStart = (s) => (pending = s); // e.g. still building the world
    host.onStart = (s) => host.beginGame(s);
    host.startGame({ mapId: 'twin-rivers', seed: 1, delay: 2, game: 1 });
    for (let t = 0; t < 5; t++) host.lockstep!.tryTick(t, 0);
    net.advance(200);
    expect(pending).not.toBeNull();
    const ls = guest.beginGame(pending!);
    ls.tryTick(0, 0);
    ls.tryTick(1, 0);
    expect(ls.tryTick(2, 0)).toEqual([]); // host's input for tick 2 was buffered, not lost
    host.leave();
    vi.useRealTimers();
  });

  it('tells the other side when a player leaves', () => {
    const { net, host, guest } = setup();
    let reason = '';
    guest.onPeerLeft = (r) => (reason = r);
    host.leave();
    net.advance(100);
    expect(reason).toMatch(/left/);
    expect(guest.connected).toBe(false);
    vi.useRealTimers();
  });

  it('gives up on a silent peer while waiting for their input', () => {
    const { host } = setup();
    let reason = '';
    host.onPeerLeft = (r) => (reason = r);
    host.beginGame({ mapId: 'twin-rivers', seed: 1, delay: 2, game: 1 });
    for (let t = 0; t < 3; t++) host.lockstep!.tryTick(t, performance.now());
    vi.advanceTimersByTime(12_000);
    expect(reason).toMatch(/connection/i);
    vi.useRealTimers();
  });
});
