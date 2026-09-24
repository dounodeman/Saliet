import type { Command } from '../sim/commands';

/**
 * Wire protocol for two-player games. Bump PROTOCOL_VERSION whenever messages
 * or simulation rules change in a way that would make old and new clients
 * disagree; clients with different versions refuse to play together.
 */
export const PROTOCOL_VERSION = 1;

/** Match settings chosen by the host and sent to the guest. */
export interface MatchSettings {
  mapId: string;
  seed: number;
  /** Lockstep input delay in ticks (chosen by the host from the measured ping). */
  delay: number;
  /** Increments with every rematch so stray messages from an old game are ignored. */
  game: number;
}

export type NetMessage =
  | { k: 'hello'; v: number; build: string }
  | { k: 'welcome' }
  | { k: 'reject'; reason: string }
  | { k: 'ping'; t: number }
  | { k: 'pong'; t: number }
  | { k: 'start'; settings: MatchSettings }
  /** The sender's commands to run on tick `t` of game `g` (sent for every tick, even when empty). */
  | { k: 'cmds'; g: number; t: number; c: Command[] }
  /** State hash after tick `t`, for desync detection. */
  | { k: 'hash'; g: number; t: number; h: string }
  | { k: 'leave' };

/** A reliable, ordered message channel to the other player. */
export interface Transport {
  send(msg: NetMessage): void;
  onMessage: ((msg: NetMessage) => void) | null;
  onClose: (() => void) | null;
  readonly open: boolean;
  close(): void;
}

/** Host team is Cobalt (0); the guest plays Vermilion (1). */
export const HOST_TEAM = 0;
export const GUEST_TEAM = 1;

/** Picks an input delay (ticks at 20 Hz) that hides a round-trip time in ms. */
export function delayForPing(rttMs: number): number {
  const oneWay = rttMs / 2 + 25; // plus some jitter headroom
  return Math.max(2, Math.min(10, Math.ceil(oneWay / 50) + 1));
}
