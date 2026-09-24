import './ui/style.css';
import { GameSession } from './game/session';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const params = new URLSearchParams(location.search);
const session = new GameSession(
  canvas,
  hudRoot,
  {
    mapId: params.get('map') ?? 'twin-rivers',
    seed: Number(params.get('seed') ?? 1),
    playerTeam: params.has('spectate') ? -1 : 0,
    difficulty: (params.get('ai') as 'easy' | 'normal' | 'hard' | null) ?? 'normal',
  },
  {
    onMenu: (s) => {
      s.togglePause();
    },
    onGameOver: (s, winner) => {
      const overlay = document.getElementById('overlay')!;
      const won = winner === s.playerTeam;
      overlay.innerHTML = `<div class="card end"><h1>${won ? 'Victory' : winner === -2 ? 'Draw' : 'Defeat'}</h1>
        <button class="btn primary" id="again">Play again</button></div>`;
      overlay.classList.add('show');
      document.getElementById('again')!.onclick = () => location.reload();
    },
  },
);
session.start();
// Handy for debugging in the console.
(window as unknown as { salient: GameSession }).salient = session;
