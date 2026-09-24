import Peer, { type DataConnection } from 'peerjs';
import type { NetMessage, Transport } from './protocol';

/**
 * WebRTC transport via PeerJS. The public PeerJS server only introduces the two
 * browsers (signalling); game traffic then flows directly between them, or via
 * PeerJS's public TURN relay when a direct path is impossible.
 */

const ID_PREFIX = 'salient-game-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CONNECT_TIMEOUT_MS = 20_000;

export function randomCode(length = 6): string {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

class PeerTransport implements Transport {
  onClose: (() => void) | null = null;
  private closed = false;
  private handler: ((msg: NetMessage) => void) | null = null;
  /** Messages that arrived while nobody was listening (e.g. between handshake steps). */
  private backlog: NetMessage[] = [];

  get onMessage(): ((msg: NetMessage) => void) | null {
    return this.handler;
  }

  set onMessage(fn: ((msg: NetMessage) => void) | null) {
    this.handler = fn;
    while (fn && this.handler === fn && this.backlog.length > 0) fn(this.backlog.shift()!);
  }

  constructor(
    private conn: DataConnection,
    private peer: Peer,
  ) {
    conn.on('data', (d) => {
      if (this.handler) this.handler(d as NetMessage);
      else this.backlog.push(d as NetMessage);
    });
    conn.on('close', () => this.fireClose());
    conn.on('error', () => this.fireClose());
    // If the direct link drops, PeerJS doesn't always emit 'close'; watch ICE too.
    let lostTimer: ReturnType<typeof setTimeout> | undefined;
    conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      const st = conn.peerConnection?.iceConnectionState;
      clearTimeout(lostTimer);
      if (st === 'failed' || st === 'closed') this.fireClose();
      else if (st === 'disconnected') lostTimer = setTimeout(() => this.fireClose(), 6000);
    });
  }

  get open(): boolean {
    return this.conn.open && !this.closed;
  }

  send(msg: NetMessage): void {
    if (this.open) this.conn.send(msg);
  }

  close(): void {
    this.closed = true;
    try {
      this.conn.close();
    } finally {
      this.peer.destroy();
    }
  }

  private fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
    this.peer.destroy();
  }
}

function describeError(type: string, code: string): string {
  switch (type) {
    case 'peer-unavailable':
      return `No game found with code ${code}. Ask your friend for a fresh link — the host has to keep the game page open.`;
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking server. Check your internet connection and try again.';
    case 'browser-incompatible':
      return 'This browser does not support peer-to-peer connections (WebRTC).';
    default:
      return `Connection problem (${type}). Try again.`;
  }
}

export interface HostLobby {
  code: string;
  close(): void;
}

/**
 * Registers a new game code and waits for one friend to connect.
 * `onGuest` fires once with the connection; later visitors are turned away.
 */
export async function hostLobby(onGuest: (t: Transport) => void, onError: (message: string) => void): Promise<HostLobby> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = randomCode();
    const peer = new Peer(ID_PREFIX + code, { debug: 1 });
    const ok = await new Promise<boolean>((resolve, reject) => {
      peer.once('open', () => resolve(true));
      peer.once('error', (e) => {
        if (e.type === 'unavailable-id') resolve(false);
        else reject(new Error(describeError(e.type, code)));
      });
    }).catch((e: Error) => {
      peer.destroy();
      throw e;
    });
    if (!ok) {
      peer.destroy();
      continue;
    }
    let taken = false;
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (taken) {
          conn.send({ k: 'reject', reason: 'This game already has two players.' } satisfies NetMessage);
          setTimeout(() => conn.close(), 500);
          return;
        }
        taken = true;
        onGuest(new PeerTransport(conn, peer));
      });
    });
    peer.on('error', (e) => {
      if (!taken) onError(describeError(e.type, code));
    });
    return {
      code,
      close: () => {
        if (!taken) peer.destroy();
      },
    };
  }
  throw new Error('Could not create a game code. Try again.');
}

/** Connects to a friend's game by code. */
export function joinLobby(rawCode: string): Promise<Transport> {
  const code = normalizeCode(rawCode);
  return new Promise<Transport>((resolve, reject) => {
    const peer = new Peer({ debug: 1 });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Could not connect to your friend. One of you may be on a network that blocks direct connections (school, work or VPN) — try another network.'),
      CONNECT_TIMEOUT_MS,
    );
    peer.on('error', (e) => {
      clearTimeout(timer);
      fail(describeError(e.type, code));
    });
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(new PeerTransport(conn, peer));
      });
      conn.on('error', () => {
        clearTimeout(timer);
        fail('The connection to your friend failed. Try again.');
      });
    });
  });
}
