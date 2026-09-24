import { DIFFICULTIES, type DifficultyName } from '../ai/difficulty';
import { sound } from '../audio/sound';
import { MAPS } from '../maps';
import { NEUTRAL_COLOR, TEAM_COLORS, TERRAIN_RGB } from '../render/palette';
import type { Scenario } from '../sim/types';

export interface MenuChoice {
  mapId: string;
  seed: number;
  difficulty: DifficultyName;
}

const STORAGE_KEY = 'salient.menu';

export function loadChoice(): MenuChoice {
  const fallback: MenuChoice = { mapId: 'twin-rivers', seed: 1 + Math.floor(Math.random() * 9999), difficulty: 'normal' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const c = JSON.parse(raw) as Partial<MenuChoice>;
    return {
      mapId: MAPS.some((m) => m.id === c.mapId) ? c.mapId! : fallback.mapId,
      seed: Number.isFinite(c.seed) ? Number(c.seed) : fallback.seed,
      difficulty: c.difficulty && c.difficulty in DIFFICULTIES ? c.difficulty : fallback.difficulty,
    };
  } catch {
    return fallback;
  }
}

function saveChoice(c: MenuChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable: not important */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label);
  b.onclick = () => {
    sound.play('ui');
    onClick();
  };
  return b;
}

/** A tiny top-down picture of a scenario for the map picker. */
function thumbnail(sc: Scenario): HTMLCanvasElement {
  const { map } = sc;
  const c = el('canvas', 'thumb');
  c.width = map.width;
  c.height = map.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(map.width, map.height);
  for (let i = 0; i < map.terrain.length; i++) {
    const rgb = TERRAIN_RGB[map.terrain[i]];
    img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  for (const city of sc.cities) {
    ctx.fillStyle = city.owner >= 0 ? TEAM_COLORS[city.owner].main : NEUTRAL_COLOR.dark;
    ctx.beginPath();
    ctx.arc(city.x, city.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

export const CONTROLS: Array<[string, string]> = [
  ['Left click / drag', 'Select a unit / box-select (Shift adds)'],
  ['Double click', 'Select all visible units of that type'],
  ['Right click', 'Move (Shift queues waypoints)'],
  ['Right drag', 'Draw a front line — selected units spread along it'],
  ['Click own city', 'Choose where new units spawn'],
  ['Q / E', 'Build light / heavy'],
  ['H', 'Halt selected units'],
  ['Ctrl+1–9, 1–9', 'Assign / recall control groups (tap twice to jump)'],
  ['Ctrl+A · F', 'Select all · centre on selection'],
  ['Space · + / −', 'Pause · game speed'],
  ['Wheel · WASD · edges', 'Zoom · pan (middle-drag or minimap too)'],
  ['M · Esc', 'Mute · menu'],
];

const RULES = [
  'Hold cities to earn production. Each city feeds 5 units — more than that and the extras starve.',
  'Your land spreads where your units stand unopposed. Units cut off from land connected to your cities are out of supply and wither.',
  'Light infantry is cheap and fast and fights well in forest and hills. Heavies hit hard on open plains but flounder anywhere else. Everyone is weak in water.',
  'Moving and fighting tire units out; tired units hit softer and move slower. Idle, supplied units recover.',
  'Win by holding 80% of the cities, or by wiping out the enemy.',
];

function controlsTable(): HTMLElement {
  const t = el('table', 'controls');
  for (const [k, v] of CONTROLS) {
    const tr = el('tr');
    tr.append(el('td', 'key', k), el('td', '', v));
    t.append(tr);
  }
  return t;
}

export function hideOverlay(root: HTMLElement): void {
  root.classList.remove('show', 'menu-bg');
  root.innerHTML = '';
}

export function showMainMenu(root: HTMLElement, initial: MenuChoice, onPlay: (c: MenuChoice, spectate: boolean) => void): void {
  const choice = { ...initial };
  root.innerHTML = '';
  root.classList.add('show', 'menu-bg');
  const card = el('div', 'card menu');
  const head = el('div', 'menu-head');
  const logo = el('div', 'logo');
  logo.innerHTML = '<span style="background:#2f5fd0"></span><span style="background:#d6452a"></span>';
  const titles = el('div');
  titles.append(el('h1', 'title', 'Salient'), el('p', 'tagline', 'Draw the line. Hold the line. Push the line.'));
  head.append(logo, titles);
  card.append(head);

  // Map picker.
  card.append(el('h3', 'section', 'Map'));
  const maps = el('div', 'maps');
  const seedRow = el('div', 'seed-row');
  const seedInput = el('input');
  seedInput.type = 'number';
  seedInput.min = '1';
  seedInput.value = String(choice.seed);
  seedInput.title = 'Seed for the random map';
  const cards = new Map<string, HTMLElement>();
  const refreshRandomThumb = () => {
    const holder = cards.get('random')?.querySelector('.thumb-holder');
    if (!holder) return;
    holder.innerHTML = '';
    holder.append(thumbnail(MAPS.find((m) => m.id === 'random')!.build(choice.seed)));
  };
  for (const m of MAPS) {
    const b = el('button', 'map-card');
    const holder = el('div', 'thumb-holder');
    holder.append(thumbnail(m.build(choice.seed)));
    b.append(holder, el('b', '', m.name), el('span', 'muted small', m.description));
    b.onclick = () => {
      sound.play('ui');
      choice.mapId = m.id;
      for (const [id, c] of cards) c.classList.toggle('selected', id === m.id);
      seedRow.classList.toggle('show', m.id === 'random');
    };
    b.classList.toggle('selected', m.id === choice.mapId);
    cards.set(m.id, b);
    maps.append(b);
  }
  card.append(maps);
  seedInput.oninput = () => {
    const v = Math.max(1, Math.floor(Number(seedInput.value) || 1));
    choice.seed = v;
    refreshRandomThumb();
  };
  const dice = button('⚄ New seed', '', () => {
    choice.seed = 1 + Math.floor(Math.random() * 99999);
    seedInput.value = String(choice.seed);
    refreshRandomThumb();
  });
  seedRow.append(el('span', 'muted', 'Seed'), seedInput, dice);
  seedRow.classList.toggle('show', choice.mapId === 'random');
  card.append(seedRow);

  // Difficulty.
  card.append(el('h3', 'section', 'Opponent'));
  const seg = el('div', 'segmented');
  const segButtons: HTMLButtonElement[] = [];
  for (const d of Object.values(DIFFICULTIES)) {
    const b = el('button', 'seg', d.label);
    b.onclick = () => {
      sound.play('ui');
      choice.difficulty = d.name;
      segButtons.forEach((x) => x.classList.toggle('selected', x === b));
    };
    b.classList.toggle('selected', d.name === choice.difficulty);
    segButtons.push(b);
    seg.append(b);
  }
  card.append(seg);

  // Actions.
  const actions = el('div', 'actions');
  actions.append(
    button('Play', 'primary big', () => {
      saveChoice(choice);
      onPlay(choice, false);
    }),
    button('Watch AI vs AI', '', () => {
      saveChoice(choice);
      onPlay(choice, true);
    }),
  );
  card.append(actions);

  // How to play.
  const how = el('details', 'how');
  how.append(el('summary', '', 'How to play'));
  const rules = el('ul', 'rules');
  for (const r of RULES) rules.append(el('li', '', r));
  how.append(rules, controlsTable());
  card.append(how);
  card.append(el('p', 'muted small footer', 'You are Cobalt (blue). Tip: select a group, then right-drag a line where you want it to stand.'));
  root.append(card);
}

export interface PauseMenuOptions {
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
}

export function showPauseMenu(root: HTMLElement, opts: PauseMenuOptions): void {
  root.innerHTML = '';
  root.classList.add('show');
  const card = el('div', 'card pause');
  card.append(el('h1', 'title small-title', 'Paused'));
  const actions = el('div', 'actions column');
  const mute = button(sound.muted ? 'Sound: off' : 'Sound: on', '', () => {
    sound.toggleMute();
    mute.textContent = sound.muted ? 'Sound: off' : 'Sound: on';
  });
  actions.append(button('Resume', 'primary', opts.onResume), button('Restart', '', opts.onRestart), mute, button('Quit to menu', '', opts.onQuit));
  card.append(actions);
  const how = el('details', 'how');
  how.append(el('summary', '', 'Controls'), controlsTable());
  card.append(how);
  root.append(card);
}

export interface GameOverOptions {
  title: string;
  subtitle: string;
  rows: Array<[string, string, string]>;
  onAgain(): void;
  onMenu(): void;
}

export function showGameOver(root: HTMLElement, opts: GameOverOptions): void {
  root.innerHTML = '';
  root.classList.add('show');
  const card = el('div', 'card end');
  card.append(el('h1', 'title', opts.title), el('p', 'tagline', opts.subtitle));
  const t = el('table', 'stats');
  const head = el('tr');
  head.append(el('th', '', ''), el('th', 'cobalt', TEAM_COLORS[0].name), el('th', 'vermilion', TEAM_COLORS[1].name));
  t.append(head);
  for (const [label, a, b] of opts.rows) {
    const tr = el('tr');
    tr.append(el('td', 'muted', label), el('td', '', a), el('td', '', b));
    t.append(tr);
  }
  card.append(t);
  const actions = el('div', 'actions');
  actions.append(button('Play again', 'primary', opts.onAgain), button('Main menu', '', opts.onMenu));
  card.append(actions);
  root.append(card);
}
