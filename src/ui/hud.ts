import { STAMINA, UNIT_STATS, type UnitType } from '../config';
import { supplyCap, unitCount } from '../sim/supply';
import { terrainAt, terrainName } from '../sim/terrain';
import type { World } from '../sim/types';
import { citiesNeededToWin } from '../sim/victory';
import { TEAM_COLORS } from '../render/palette';

export interface HudCallbacks {
  queue(type: UnitType): void;
  cancel(itemId: number): void;
  togglePause(): void;
  changeSpeed(dir: 1 | -1): void;
  openMenu(): void;
  toggleMute(): void;
}

export interface HudOptions {
  spectating: boolean;
  minimap?: HTMLCanvasElement;
}

export interface HudState {
  world: World;
  playerTeam: number;
  paused: boolean;
  speed: number;
  spawnCityId: number;
  selection: ReadonlySet<number>;
  muted: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtTime(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function bar(label: string): { root: HTMLElement; fill: HTMLElement; value: HTMLElement } {
  const root = el('div', 'bar');
  root.append(el('span', 'bar-label', label));
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  track.append(fill);
  const value = el('span', 'bar-value');
  root.append(track, value);
  return { root, fill, value };
}

/** DOM heads-up display. Structure is built once; `update` only touches text/styles. */
export class Hud {
  private pp: HTMLElement;
  private supply: HTMLElement;
  private cities: HTMLElement;
  private enemy: HTMLElement;
  private clock: HTMLElement;
  private speed: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private spawnLabel: HTMLElement;
  private queueList: HTMLElement;
  private lightBtn: HTMLButtonElement;
  private heavyBtn: HTMLButtonElement;
  private selTitle: HTMLElement;
  private selDetail: HTMLElement;
  private selHp: ReturnType<typeof bar>;
  private selStam: ReturnType<typeof bar>;
  private selPanel: HTMLElement;
  private banner: HTMLElement;
  private toasts: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private queueKey = '';

  constructor(
    readonly root: HTMLElement,
    playerTeam: number,
    private cb: HudCallbacks,
    opts: HudOptions = { spectating: false },
  ) {
    root.innerHTML = '';
    root.className = 'hud';
    const team = TEAM_COLORS[playerTeam];
    const enemyTeam = TEAM_COLORS[1 - playerTeam];

    // Top bar.
    const top = el('div', 'hud-top');
    const res = el('div', 'panel res');
    const badge = el('div', 'team-badge');
    const dot = el('span', 'team-dot');
    dot.style.background = team.main;
    badge.append(dot, el('b', '', team.name));
    const stat = (label: string) => {
      const s = el('div', 'stat');
      s.append(el('label', '', label));
      const v = el('span', 'stat-value', '–');
      s.append(v);
      res.append(s);
      return v;
    };
    res.append(badge);
    this.pp = stat('Production');
    this.supply = stat('Supply');
    this.cities = stat('Cities');

    const enemyPanel = el('div', 'panel enemy');
    const edot = el('span', 'team-dot');
    edot.style.background = enemyTeam.main;
    this.enemy = el('span', '', '');
    enemyPanel.append(edot, el('b', '', enemyTeam.name), this.enemy);

    const clockPanel = el('div', 'panel clock');
    this.clock = el('span', 'time', '00:00');
    const slower = el('button', 'icon-btn', '−');
    slower.title = 'Slower (−)';
    slower.onclick = () => cb.changeSpeed(-1);
    this.speed = el('span', 'speed', '1×');
    const faster = el('button', 'icon-btn', '+');
    faster.title = 'Faster (+)';
    faster.onclick = () => cb.changeSpeed(1);
    this.pauseBtn = el('button', 'icon-btn', 'Ⅱ');
    this.pauseBtn.title = 'Pause (Space)';
    this.pauseBtn.onclick = () => cb.togglePause();
    this.muteBtn = el('button', 'icon-btn', '♪');
    this.muteBtn.title = 'Sound (M)';
    this.muteBtn.onclick = () => cb.toggleMute();
    const menuBtn = el('button', 'icon-btn', '☰');
    menuBtn.title = 'Menu (Esc)';
    menuBtn.onclick = () => cb.openMenu();
    clockPanel.append(this.clock, slower, this.speed, faster, this.pauseBtn, this.muteBtn, menuBtn);
    top.append(res, enemyPanel, clockPanel);

    // Bottom: production + selection.
    const bottom = el('div', 'hud-bottom');
    const prod = el('div', 'panel prod');
    const prodHead = el('div', 'panel-head');
    prodHead.append(el('b', '', 'Production'));
    this.spawnLabel = el('span', 'muted', '');
    prodHead.append(this.spawnLabel);
    const btns = el('div', 'prod-buttons');
    const mkBtn = (type: UnitType, key: string) => {
      const b = el('button', `prod-btn ${type}`);
      const icon = el('span', `unit-icon ${type}`);
      icon.style.setProperty('--team', team.main);
      icon.style.setProperty('--team-dark', team.dark);
      b.append(icon, el('span', 'prod-name', type === 'light' ? 'Light' : 'Heavy'), el('span', 'prod-cost', `${UNIT_STATS[type].cost}`), el('kbd', '', key));
      b.onclick = () => cb.queue(type);
      b.title = type === 'light' ? 'Light infantry: cheap, fast, good in rough terrain (Q)' : 'Heavy: strong on plains, poor in forest/hills/water (E)';
      btns.append(b);
      return b;
    };
    this.lightBtn = mkBtn('light', 'Q');
    this.heavyBtn = mkBtn('heavy', 'E');
    this.queueList = el('div', 'queue');
    prod.append(prodHead, btns, this.queueList);

    this.selPanel = el('div', 'panel sel');
    this.selTitle = el('div', 'panel-head');
    this.selHp = bar('HP');
    this.selStam = bar('Stamina');
    this.selDetail = el('div', 'sel-detail muted');
    this.selPanel.append(this.selTitle, this.selHp.root, this.selStam.root, this.selDetail);
    const right = el('div', 'hud-right');
    if (opts.minimap) {
      const mm = el('div', 'panel minimap-panel');
      mm.append(opts.minimap);
      right.append(mm);
    }
    right.append(this.selPanel);
    bottom.append(prod, right);
    if (opts.spectating) {
      prod.classList.add('hidden');
      badge.append(el('span', 'spectating', 'Spectating'));
    }

    this.banner = el('div', 'paused-banner', 'Paused — press Space to resume');
    this.toasts = el('div', 'toasts');
    root.append(top, bottom, this.banner, this.toasts);
  }

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info'): void {
    const t = el('div', `toast ${kind}`, msg);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('fade'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
  }

  update(s: HudState): void {
    const { world, playerTeam: me } = s;
    const team = world.teams[me];
    const enemy = 1 - me;
    const myUnits = unitCount(world, me);
    const cap = supplyCap(world, me);
    const myCities = world.cities.filter((c) => c.owner === me).length;
    const need = citiesNeededToWin(world.cities.length);

    this.pp.textContent = String(Math.floor(team.pp));
    this.supply.textContent = `${myUnits} / ${cap}`;
    this.supply.classList.toggle('warn', myUnits > cap);
    this.supply.title = myUnits > cap ? 'Over the supply cap: excess units are starving!' : '5 units per owned city';
    this.cities.textContent = `${myCities} / ${world.cities.length}`;
    this.cities.title = `Hold ${need} cities to win`;
    const eCities = world.cities.filter((c) => c.owner === enemy).length;
    this.enemy.textContent = ` ${unitCount(world, enemy)} units · ${eCities} cities`;
    this.clock.textContent = fmtTime(world.tick);
    this.speed.textContent = `${s.speed}×`;
    this.pauseBtn.textContent = s.paused ? '▶' : 'Ⅱ';
    this.muteBtn.classList.toggle('off', s.muted);
    this.banner.classList.toggle('show', s.paused);

    // Production.
    const spawn = world.cities.find((c) => c.id === s.spawnCityId && c.owner === me);
    this.spawnLabel.textContent = spawn ? `at ${spawn.name}` : 'no city';
    this.lightBtn.classList.toggle('poor', team.pp < UNIT_STATS.light.cost);
    this.heavyBtn.classList.toggle('poor', team.pp < UNIT_STATS.heavy.cost);
    const key = team.queue.map((q) => `${q.id}`).join(',');
    if (key !== this.queueKey) {
      this.queueKey = key;
      this.queueList.innerHTML = '';
      if (team.queue.length === 0) this.queueList.append(el('span', 'muted small', 'Queue empty — click a city you own to spawn there'));
      team.queue.forEach((q, i) => {
        const chip = el('button', `chip ${q.type}`);
        const city = world.cities.find((c) => c.id === q.cityId);
        chip.title = `${q.type} at ${city?.name ?? '?'} — click to cancel`;
        chip.append(el('span', `unit-icon ${q.type}`));
        (chip.firstChild as HTMLElement).style.setProperty('--team', TEAM_COLORS[me].main);
        (chip.firstChild as HTMLElement).style.setProperty('--team-dark', TEAM_COLORS[me].dark);
        if (i === 0) chip.append(el('span', 'chip-progress'));
        chip.onclick = () => this.cb.cancel(q.id);
        this.queueList.append(chip);
      });
    }
    const head = team.queue[0];
    const prog = this.queueList.querySelector<HTMLElement>('.chip-progress');
    if (head && prog) prog.style.width = `${Math.min(100, (team.pp / UNIT_STATS[head.type].cost) * 100)}%`;

    // Selection.
    const sel = [...s.selection].map((id) => world.unitById.get(id)).filter((u) => u !== undefined);
    this.selPanel.classList.toggle('empty', sel.length === 0);
    if (sel.length === 0) {
      this.selTitle.textContent = 'No selection';
      this.selDetail.textContent = 'Drag to select · right-click to move · right-drag to draw a front line';
      this.selHp.fill.style.width = '0%';
      this.selStam.fill.style.width = '0%';
      this.selHp.value.textContent = '';
      this.selStam.value.textContent = '';
      return;
    }
    const lights = sel.filter((u) => u.type === 'light').length;
    const heavies = sel.length - lights;
    let hp = 0;
    let maxHp = 0;
    let stam = 0;
    let engaged = 0;
    let cut = 0;
    let starving = 0;
    for (const u of sel) {
      hp += u.hp;
      maxHp += UNIT_STATS[u.type].maxHp;
      stam += u.stamina;
      if (u.engaged) engaged++;
      if (!u.supplied) cut++;
      if (u.starving) starving++;
    }
    const hpFrac = hp / maxHp;
    const stFrac = stam / (sel.length * STAMINA.max);
    this.selHp.fill.style.width = `${hpFrac * 100}%`;
    this.selHp.fill.style.background = hpFrac > 0.6 ? '#5fae4e' : hpFrac > 0.3 ? '#e0a526' : '#d23c2a';
    this.selStam.fill.style.width = `${stFrac * 100}%`;
    if (sel.length === 1) {
      const u = sel[0];
      this.selTitle.textContent = u.type === 'light' ? 'Light infantry' : 'Heavy';
      this.selHp.value.textContent = `${Math.ceil(u.hp)} / ${UNIT_STATS[u.type].maxHp}`;
      this.selStam.value.textContent = `${Math.round(u.stamina)}`;
      const terr = terrainName(terrainAt(world.map, u.x, u.y));
      const status: string[] = [terr];
      if (u.engaged) status.push('fighting');
      else if (u.waypoints.length) status.push('moving');
      else status.push('holding');
      if (u.starving) status.push('starving (over supply cap)');
      else if (!u.supplied) status.push('out of supply');
      this.selDetail.textContent = status.join(' · ');
    } else {
      this.selTitle.textContent = `${sel.length} selected — ${lights} light · ${heavies} heavy`;
      this.selHp.value.textContent = `${Math.round(hpFrac * 100)}%`;
      this.selStam.value.textContent = `${Math.round(stFrac * 100)}%`;
      const bits: string[] = [];
      if (engaged) bits.push(`${engaged} fighting`);
      if (cut) bits.push(`${cut} out of supply`);
      if (starving) bits.push(`${starving} starving`);
      this.selDetail.textContent = bits.length ? bits.join(' · ') : 'All supplied';
    }
  }
}
