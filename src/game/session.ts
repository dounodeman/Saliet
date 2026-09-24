import type { UnitType } from '../config';
import { AIController } from '../ai/ai';
import type { DifficultyName } from '../ai/difficulty';
import { sound } from '../audio/sound';
import { InputController, type InputHost } from '../input/input';
import type { Lockstep } from '../net/lockstep';
import type { NetMatch } from '../net/match';
import type { MatchSettings } from '../net/protocol';
import { getMap } from '../maps';
import { Camera } from '../render/camera';
import { Minimap } from '../render/minimap';
import { TEAM_COLORS } from '../render/palette';
import { Renderer } from '../render/renderer';
import type { Command } from '../sim/commands';
import { nearestOwnedCity } from '../sim/cities';
import type { SimEvent, World } from '../sim/types';
import { createWorld, step } from '../sim/world';
import { Hud } from '../ui/hud';
import { FixedLoop } from './loop';

export interface SessionOptions {
  mapId: string;
  seed: number;
  /** Team the human controls; -1 to spectate an AI-vs-AI match. */
  playerTeam: number;
  difficulty: DifficultyName;
  /** Menu backdrop: an AI match with no HUD and no input. */
  background?: boolean;
  /** Online game against a friend (the local player's team comes from the match). */
  online?: { match: NetMatch; settings: MatchSettings };
}

export interface SessionHooks {
  /** Esc / menu button. */
  onMenu(session: GameSession): void;
  /** The simulation declared a winner. */
  onGameOver(session: GameSession, winner: number, reason: 'cities' | 'elimination' | 'draw'): void;
}

/** One match: owns the world, loop, renderer, input and HUD. */
export class GameSession implements InputHost {
  readonly world: World;
  readonly camera = new Camera();
  readonly selection = new Set<number>();
  readonly playerTeam: number;
  readonly renderer: Renderer;
  readonly input: InputController;
  readonly hud: Hud;
  readonly loop: FixedLoop;
  readonly ais: AIController[] = [];
  readonly spectating: boolean;
  readonly minimap: Minimap;
  /** Active while playing online; null offline (or after the friend left). */
  lockstep: Lockstep | null = null;
  spawnCityId = -1;
  menuOpen = false;
  private pending: Command[] = [];
  private alphaNow = 0;
  private hudTimer = 0;
  private gameOverSent = false;
  private fitted = false;
  private resizeObserver: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    readonly options: SessionOptions,
    private hooks: SessionHooks,
  ) {
    const entry = getMap(options.mapId);
    this.world = createWorld(entry.build(options.seed), options.seed);
    const online = options.online;
    const spectating = !online && (options.playerTeam < 0 || options.background === true);
    this.spectating = spectating;
    this.playerTeam = online ? online.match.localTeam : spectating ? 0 : options.playerTeam;
    if (online) {
      this.lockstep = online.match.beginGame(online.settings);
      this.lockstep.onDesync = (tick) =>
        this.goOffline(`The two games drifted apart at ${Math.floor(tick / 20)}s (desync). Continuing against the computer.`);
    } else {
      for (let t = 0; t < this.world.teams.length; t++) {
        if (spectating || t !== this.playerTeam) this.ais.push(new AIController(t, options.difficulty, options.seed));
      }
    }
    this.menuOpen = options.background === true;
    this.minimap = new Minimap(this.world, this.camera);
    this.renderer = new Renderer(canvas, this.world.map);
    this.input = new InputController(canvas, this);
    this.hud = new Hud(hudRoot, this.playerTeam, {
      queue: (t) => this.queueUnit(t),
      cancel: (itemId) => this.issue({ kind: 'cancel', team: this.playerTeam, itemId }),
      togglePause: () => this.togglePause(),
      changeSpeed: (d) => this.changeSpeed(d),
      openMenu: () => this.openMenu(),
      toggleMute: () => this.toggleMute(),
    }, { spectating, minimap: this.minimap.canvas });
    hudRoot.style.display = options.background ? 'none' : '';
    if (online) this.hud.setOnline(true);
    this.spawnCityId = spectating ? -1 : (this.world.cities.find((c) => c.owner === this.playerTeam)?.id ?? -1);
    this.loop = new FixedLoop(
      () => this.tick(),
      (alpha, realDt) => this.frame(alpha, realDt),
    );
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  start(): void {
    this.loop.keepAliveWhenHidden = this.online;
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.minimap.dispose();
    this.resizeObserver.disconnect();
    this.hud.root.innerHTML = '';
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? document.body;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.camera.setViewport(w, h);
    this.renderer.resize(w, h, window.devicePixelRatio || 1);
    // Fit the map once we have a real viewport (the page may start hidden at 0×0).
    if (!this.fitted && w > 50 && h > 50) {
      this.fitted = true;
      this.camera.fit(this.world.map.width, this.world.map.height);
    }
  }

  // ---- InputHost -------------------------------------------------------

  getWorld(): World {
    return this.world;
  }

  alpha(): number {
    return this.alphaNow;
  }

  issue(cmd: Command): void {
    if (this.spectating) return;
    if (this.lockstep) this.lockstep.queueLocal(cmd);
    else this.pending.push(cmd);
  }

  get online(): boolean {
    return this.lockstep !== null;
  }

  /**
   * The friend left (or the games desynced): the computer takes over their army
   * and the match carries on locally.
   */
  goOffline(reason: string): void {
    if (!this.lockstep) return;
    const remote = this.lockstep.remoteTeam;
    this.lockstep = null;
    this.hud.setOnline(false);
    this.ais.push(new AIController(remote, 'normal', this.options.seed));
    this.hud.toast(reason, 'bad');
    this.hud.toast(`The computer now commands ${TEAM_COLORS[remote].name}.`, 'info');
  }

  setSpawnCity(cityId: number): void {
    this.spawnCityId = cityId;
    const c = this.world.cities.find((x) => x.id === cityId);
    if (c) this.renderer.effects.ring(c.x, c.y, performance.now() / 1000, TEAM_COLORS[this.playerTeam].main, 1.2, 2.6, 0.5);
    sound.play('ui');
  }

  queueUnit(type: UnitType): void {
    if (this.spectating) return;
    let city = this.world.cities.find((c) => c.id === this.spawnCityId && c.owner === this.playerTeam);
    if (!city) {
      const any = this.world.cities.find((c) => c.owner === this.playerTeam);
      city = any ? nearestOwnedCity(this.world, this.playerTeam, any.x, any.y) : undefined;
      if (city) this.spawnCityId = city.id;
    }
    if (!city) {
      sound.play('error');
      this.hud.toast('You have no city to build in', 'bad');
      return;
    }
    this.issue({ kind: 'produce', team: this.playerTeam, unitType: type, cityId: city.id });
    sound.play('queue');
  }

  togglePause(): void {
    if (this.online) {
      this.hud.toast('Online games can’t be paused.');
      return;
    }
    this.loop.paused = !this.loop.paused;
    sound.play('ui');
  }

  changeSpeed(dir: 1 | -1): void {
    if (this.online) {
      this.hud.toast('Online games always run at normal speed.');
      return;
    }
    this.loop.changeSpeed(dir);
    sound.play('ui');
  }

  openMenu(): void {
    this.hooks.onMenu(this);
  }

  toggleMute(): void {
    const muted = sound.toggleMute();
    this.hud.toast(muted ? 'Sound off' : 'Sound on');
  }

  feedback(kind: 'select' | 'move' | 'line' | 'error'): void {
    sound.play(kind);
  }

  acceptsInput(): boolean {
    return !this.menuOpen;
  }

  // ---- Loop ------------------------------------------------------------

  private tick(): boolean {
    if (this.world.winner !== -1) return true; // match over: nothing left to simulate
    let commands: Command[];
    if (this.lockstep) {
      const cmds = this.lockstep.tryTick(this.world.tick, performance.now());
      if (!cmds) return false; // waiting for the other player's input
      commands = cmds;
    } else {
      commands = this.pending;
      this.pending = [];
    }
    for (const ai of this.ais) commands.push(...ai.update(this.world));
    step(this.world, commands);
    this.lockstep?.afterStep(this.world);
    this.handleEvents(this.world.events);
    return true;
  }

  private handleEvents(events: readonly SimEvent[]): void {
    const now = performance.now() / 1000;
    const fx = this.renderer.effects;
    for (const e of events) {
      switch (e.kind) {
        case 'spawn':
          fx.ring(e.x, e.y, now, TEAM_COLORS[e.team].main, 0.3, 1.4, 0.5, 1.5);
          if (e.team === this.playerTeam && !this.spectating) sound.play('spawn');
          break;
        case 'death':
          fx.puff(e.x, e.y, now, TEAM_COLORS[e.team].dark, e.type === 'heavy' ? 1.3 : 1);
          fx.ring(e.x, e.y, now, TEAM_COLORS[e.team].main, 0.3, 1.6, 0.7, 1.5);
          this.selection.delete(e.unitId);
          if (!this.options.background) sound.play('death');
          break;
        case 'capture': {
          const c = this.world.cities[e.cityId];
          fx.ring(c.x, c.y, now, TEAM_COLORS[e.team].main, 1, 5, 1.1, 3);
          if (this.options.background) break;
          if (this.spectating) {
            this.hud.toast(`${TEAM_COLORS[e.team].name} takes ${c.name}`, 'info');
          } else if (e.team === this.playerTeam) {
            this.hud.toast(`${c.name} captured`, 'good');
            sound.play('capture');
          } else if (e.prevOwner === this.playerTeam) {
            this.hud.toast(`${c.name} lost!`, 'bad');
            sound.play('cityLost');
          }
          break;
        }
        case 'victory':
          if (!this.gameOverSent) {
            this.gameOverSent = true;
            if (!this.spectating) sound.play(e.team === this.playerTeam ? 'victory' : 'defeat');
            this.hooks.onGameOver(this, e.team, e.reason);
          }
          break;
      }
    }
  }

  private frame(alpha: number, realDt: number): void {
    this.alphaNow = alpha;
    this.input.update(realDt);
    this.renderer.render(
      {
        world: this.world,
        alpha,
        playerTeam: this.playerTeam,
        selection: this.selection,
        box: this.input.box,
        linePreview: this.input.linePoints,
        spawnCityId: this.spawnCityId,
        hoverUnitId: this.input.hoverUnitId,
        now: performance.now() / 1000,
      },
      this.camera,
    );
    this.hudTimer -= realDt;
    if (this.hudTimer <= 0 && !this.options.background) {
      this.hudTimer = 0.1;
      this.minimap.draw();
      if (this.lockstep) {
        const ls = this.lockstep;
        const waiting = ls.waitingSince >= 0 && performance.now() - ls.waitingSince > 500;
        this.hud.setNetStatus(Math.round(this.options.online!.match.rtt), waiting);
      }
      this.hud.update({
        world: this.world,
        playerTeam: this.playerTeam,
        paused: this.loop.paused,
        speed: this.loop.speed,
        spawnCityId: this.spawnCityId,
        selection: this.selection,
        muted: sound.muted,
      });
    }
  }
}
