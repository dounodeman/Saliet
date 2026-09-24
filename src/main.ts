import './ui/style.css';
import type { DifficultyName } from './ai/difficulty';
import { GameSession, type SessionOptions } from './game/session';
import { TEAM_COLORS } from './render/palette';
import { DRAW } from './sim/victory';
import { hideOverlay, loadChoice, showGameOver, showMainMenu, showPauseMenu } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;

let session: GameSession | null = null;

function fmtTime(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function start(options: SessionOptions): void {
  session?.dispose();
  session = new GameSession(canvas, hudRoot, options, {
    onMenu: (s) => togglePause(s),
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

function mainMenu(): void {
  // A live AI-vs-AI match plays behind the menu.
  start({ mapId: 'random', seed: 1 + Math.floor(Math.random() * 99999), playerTeam: -1, difficulty: 'hard', background: true });
  showMainMenu(overlay, loadChoice(), (c, spectate) =>
    play({ mapId: c.mapId, seed: c.seed, playerTeam: spectate ? -1 : 0, difficulty: c.difficulty }),
  );
}

function togglePause(s: GameSession): void {
  if (s.options.background) return;
  if (s.world.winner !== -1) return;
  if (s.menuOpen) {
    s.menuOpen = false;
    s.loop.paused = false;
    hideOverlay(overlay);
    return;
  }
  s.menuOpen = true;
  s.loop.paused = true;
  showPauseMenu(overlay, {
    onResume: () => togglePause(s),
    onRestart: () => play(s.options),
    onQuit: () => mainMenu(),
  });
}

function gameOver(s: GameSession, winner: number, reason: 'cities' | 'elimination' | 'draw'): void {
  if (s.options.background) {
    // Keep the menu backdrop alive with a fresh match.
    setTimeout(() => {
      if (session === s) start({ ...s.options, seed: s.options.seed + 1 });
    }, 2500);
    return;
  }
  s.menuOpen = true;
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
    onAgain: () => play(s.options),
    onMenu: () => mainMenu(),
  });
}

// ?map=twin-rivers&ai=hard[&seed=3][&spectate] skips the menu (handy for testing).
const params = new URLSearchParams(location.search);
if (params.has('map')) {
  play({
    mapId: params.get('map')!,
    seed: Number(params.get('seed') ?? 1),
    playerTeam: params.has('spectate') ? -1 : 0,
    difficulty: (params.get('ai') as DifficultyName | null) ?? 'normal',
  });
} else {
  mainMenu();
}
