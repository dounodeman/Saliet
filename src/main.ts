import './ui/style.css';
import { GameSession } from './game/session';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const params = new URLSearchParams(location.search);
const session = new GameSession(
  canvas,
  hudRoot,
  { mapId: params.get('map') ?? 'twin-rivers', seed: Number(params.get('seed') ?? 1), playerTeam: 0 },
  {
    onMenu: (s) => {
      s.togglePause();
    },
    onGameOver: (s, winner) => {
      s.hud.toast(winner === s.playerTeam ? 'Victory!' : 'Defeat', winner === s.playerTeam ? 'good' : 'bad');
    },
  },
);
session.start();
// Handy for debugging in the console.
(window as unknown as { salient: GameSession }).salient = session;
