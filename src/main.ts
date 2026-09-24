import './ui/style.css';
import type { DifficultyName } from './ai/difficulty';
import { GameSession, type SessionOptions } from './game/session';
import { getMap } from './maps';
import { guestHandshake, hostHandshake, NetMatch } from './net/match';
import { hostLobby, joinLobby, normalizeCode, type HostLobby } from './net/peer';
import { delayForPing, type MatchSettings } from './net/protocol';
import { TEAM_COLORS } from './render/palette';
import { DRAW } from './sim/victory';
import {
  hideOverlay,
  loadChoice,
  showGameOver,
  showHostPanel,
  showJoinPanel,
  showMainMenu,
  showPauseMenu,
  type MenuChoice,
} from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;

let session: GameSession | null = null;
/** The connection to a friend, kept across rematches. */
let match: NetMatch | null = null;
let lobby: HostLobby | null = null;
let lastReason: 'cities' | 'elimination' | 'draw' = 'cities';

function fmtTime(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function start(options: SessionOptions): void {
  session?.dispose();
  session = new GameSession(canvas, hudRoot, options, {
    onMenu: (s) => toggleMenu(s),
    onGameOver: (s, winner, reason) => gameOver(s, winner, reason),
  });
  session.start();
  // Handy for debugging from the console.
  (window as unknown as { salient: GameSession }).salient = session;
}

function play(options: SessionOptions): void {
  hideOverlay(overlay);
  start(options);
}

/** A live AI-vs-AI match plays behind menus and lobby screens. */
function startBackdrop(): void {
  if (session?.options.background) return;
  start({ mapId: 'random', seed: 1 + Math.floor(Math.random() * 99999), playerTeam: -1, difficulty: 'hard', background: true });
}

function closeOnline(): void {
  lobby?.close();
  lobby = null;
  match?.leave();
  match = null;
}

function mainMenu(): void {
  closeOnline();
  startBackdrop();
  showMainMenu(overlay, loadChoice(), {
    play: (c, spectate) => play({ mapId: c.mapId, seed: c.seed, playerTeam: spectate ? -1 : 0, difficulty: c.difficulty }),
    hostFriend: (c) => void hostFriend(c),
    joinFriend: (code) => void joinFriend(code),
  });
}

// ---- Online ------------------------------------------------------------------

function playOnline(settings: MatchSettings): void {
  if (!match) return;
  play({ mapId: settings.mapId, seed: settings.seed, playerTeam: match.localTeam, difficulty: 'normal', online: { match, settings } });
  session?.hud.toast(`You are ${TEAM_COLORS[match.localTeam].name}. Good luck!`, 'info');
}

function attachMatch(m: NetMatch): void {
  match = m;
  m.onStart = (settings) => playOnline(settings);
  m.onPeerLeft = (reason) => {
    if (match === m) match = null;
    if (session?.online) {
      session.goOffline(reason);
    } else if (session && !session.options.background && session.world.winner !== -1) {
      // On the game-over screen: rematch is no longer possible.
      gameOver(session, session.world.winner, lastReason, reason);
    }
  };
}

async function hostFriend(choice: MenuChoice): Promise<void> {
  closeOnline();
  startBackdrop();
  const panel = showHostPanel(overlay, { mapName: getMap(choice.mapId).name, onCancel: () => mainMenu() });
  try {
    lobby = await hostLobby(
      (transport) => {
        panel.setStatus('Your friend is connecting…');
        hostHandshake(transport).then(
          (rtt) => {
            const m = new NetMatch(transport, 'host', rtt);
            attachMatch(m);
            panel.setStatus('Connected! Starting…', 'good');
            m.startGame({ mapId: choice.mapId, seed: choice.seed, delay: delayForPing(rtt), game: 1 });
          },
          (err: Error) => {
            panel.setStatus(err.message, 'bad');
            transport.close();
          },
        );
      },
      (message) => panel.setStatus(message, 'bad'),
    );
    const link = `${location.origin}${location.pathname}?join=${lobby.code}`;
    panel.setLink(link, lobby.code);
  } catch (err) {
    panel.setStatus((err as Error).message, 'bad');
  }
}

async function joinFriend(rawCode: string): Promise<void> {
  closeOnline();
  startBackdrop();
  const code = normalizeCode(rawCode);
  let cancelled = false;
  const panel = showJoinPanel(overlay, {
    code,
    onCancel: () => {
      cancelled = true;
      mainMenu();
    },
  });
  try {
    const transport = await joinLobby(code);
    if (cancelled) {
      transport.close();
      return;
    }
    panel.setStatus('Connected — waiting for the game to start…', 'good');
    const settings = await guestHandshake(transport);
    if (cancelled) {
      transport.close();
      return;
    }
    attachMatch(new NetMatch(transport, 'guest'));
    playOnline(settings);
  } catch (err) {
    if (!cancelled) panel.setStatus((err as Error).message, 'bad');
  }
}

// ---- Menus ---------------------------------------------------------------------

function toggleMenu(s: GameSession): void {
  if (s.options.background) return;
  if (s.world.winner !== -1) return;
  if (s.menuOpen) {
    s.menuOpen = false;
    s.loop.paused = false;
    hideOverlay(overlay);
    return;
  }
  s.menuOpen = true;
  if (!s.online) s.loop.paused = true;
  showPauseMenu(overlay, {
    online: s.online,
    onResume: () => toggleMenu(s),
    onRestart: () => play(s.options),
    onQuit: () => mainMenu(),
  });
}

function gameOver(s: GameSession, winner: number, reason: 'cities' | 'elimination' | 'draw', note?: string): void {
  if (s.options.background) {
    // Keep the menu backdrop alive with a fresh match.
    setTimeout(() => {
      if (session === s) start({ ...s.options, seed: s.options.seed + 1 });
    }, 2500);
    return;
  }
  s.menuOpen = true;
  lastReason = reason;
  const w = s.world;
  let title: string;
  let subtitle: string;
  if (winner === DRAW || reason === 'draw') {
    title = 'Draw';
    subtitle = 'Both armies were destroyed.';
  } else if (s.spectating) {
    title = `${TEAM_COLORS[winner].name} wins`;
    subtitle = reason === 'cities' ? 'By holding the land.' : 'By destroying the enemy army.';
  } else if (winner === s.playerTeam) {
    title = 'Victory';
    subtitle = reason === 'cities' ? 'The land is yours.' : 'The enemy army is no more.';
  } else {
    title = 'Defeat';
    subtitle = reason === 'cities' ? 'The enemy holds the land.' : 'Your army has been destroyed.';
  }
  const cities = (t: number) => String(w.cities.filter((c) => c.owner === t).length);
  const units = (t: number) => String(w.units.filter((u) => u.team === t).length);
  const online = s.options.online;
  const connected = online !== undefined && match !== null && match.connected;
  let actions: Array<{ label: string; primary?: boolean; onClick(): void }>;
  if (connected && match!.role === 'host') {
    const prev = online!.settings;
    actions = [
      {
        label: 'Rematch',
        primary: true,
        onClick: () =>
          match?.startGame({
            ...prev,
            seed: prev.mapId === 'random' ? prev.seed + 1 : prev.seed,
            delay: delayForPing(match.rtt),
            game: prev.game + 1,
          }),
      },
      { label: 'Leave', onClick: () => mainMenu() },
    ];
    note ??= 'Start a rematch whenever you are both ready.';
  } else if (connected) {
    actions = [{ label: 'Leave', onClick: () => mainMenu() }];
    note ??= 'Waiting for your friend to start a rematch…';
  } else {
    actions = [
      ...(online ? [] : [{ label: 'Play again', primary: true, onClick: () => play(s.options) }]),
      { label: 'Main menu', primary: online !== undefined, onClick: () => mainMenu() },
    ];
  }
  showGameOver(overlay, {
    title,
    subtitle: `${subtitle} (${fmtTime(w.tick)})`,
    rows: [
      ['Cities held', cities(0), cities(1)],
      ['Units standing', units(0), units(1)],
      ['Units built', String(w.teams[0].stats.produced), String(w.teams[1].stats.produced)],
      ['Units lost', String(w.teams[0].stats.lost), String(w.teams[1].stats.lost)],
      ['Cities captured', String(w.teams[0].stats.citiesCaptured), String(w.teams[1].stats.citiesCaptured)],
    ],
    actions,
    note,
  });
}

// Tell the friend right away when this tab closes (otherwise they'd wait for a timeout).
window.addEventListener('pagehide', () => match?.leave());

// ?join=CODE opens a friend's game; ?map=…&ai=…[&seed=…][&spectate] skips the menu.
const params = new URLSearchParams(location.search);
const joinCode = params.get('join');
if (joinCode) {
  history.replaceState(null, '', location.pathname);
  void joinFriend(joinCode);
} else if (params.has('map')) {
  play({
    mapId: params.get('map')!,
    seed: Number(params.get('seed') ?? 1),
    playerTeam: params.has('spectate') ? -1 : 0,
    difficulty: (params.get('ai') as DifficultyName | null) ?? 'normal',
  });
} else {
  mainMenu();
}
