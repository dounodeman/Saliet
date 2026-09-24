import { UNIT_STATS, type UnitType } from '../config';
import type { Command } from '../sim/commands';
import { Rng } from '../sim/rng';
import type { Vec2, World } from '../sim/types';
import { unitStrength } from '../sim/units';
import { makeView, type CityView, type PlayerView, type UnitView } from '../sim/view';
import { centroid, findFront, plainsFraction, strengthNear } from './analysis';
import { DIFFICULTIES, type Difficulty, type DifficultyName } from './difficulty';

type TaskKind = 'rest' | 'defend' | 'capture' | 'attack' | 'front' | 'reserve';

interface Task {
  key: string;
  kind: TaskKind;
  target: Vec2;
  /** Front sectors are held with a line order instead of a move. */
  line?: Vec2[];
  /** Strength (in fresh-light units) the task wants. */
  want: number;
  priority: number;
  /** Share of open ground around the target (heavies like it). */
  plains: number;
  /** Estimated enemy strength at the target. */
  pressure: number;
  /** Unit vector toward the enemy (front sectors advance along it). */
  forward?: Vec2;
  units: UnitView[];
  have: number;
}

const EARLY_GAME_TICKS = 20 * 150;
const REST_BELOW = 0.3;
const REST_UNTIL = 0.75;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Computer opponent. It sees only a PlayerView and acts only through the same
 * Command objects a human produces, so it can't cheat and replays/multiplayer
 * treat it like any other player.
 *
 * Each decision it (1) lists tasks — rest, defend threatened cities, capture
 * neutral cities, counterattack weak enemy cities, hold front sectors, reserve —
 * (2) assigns units to tasks by priority, keeping previous assignments to avoid
 * dithering and preferring heavies for open ground, (3) issues move/line orders
 * only where something changed, and (4) manages production under the supply cap.
 */
export class AIController {
  readonly difficulty: Difficulty;
  private rng: Rng;
  private assignment = new Map<number, string>();
  private lineSignatures = new Map<string, string>();
  private resting = new Set<number>();
  private attackKeys: string[] = [];
  private phase: number;
  /** Latest tasks (exposed for debugging overlays and tests). */
  lastTasks: Task[] = [];

  constructor(
    readonly team: number,
    difficulty: DifficultyName | Difficulty,
    seed: number,
  ) {
    this.difficulty = typeof difficulty === 'string' ? DIFFICULTIES[difficulty] : difficulty;
    this.rng = new Rng((seed ^ Math.imul(team + 1, 0x9e3779b1)) >>> 0);
    this.phase = (team * 7) % this.difficulty.reactionTicks;
  }

  /** Called every tick; returns the commands to issue this tick (usually none). */
  update(world: World): Command[] {
    if (world.winner !== -1) return [];
    if ((world.tick + this.phase) % this.difficulty.reactionTicks !== 0) return [];
    return this.decide(makeView(world, this.team));
  }

  decide(view: PlayerView): Command[] {
    const cmds: Command[] = [];
    const d = this.difficulty;
    const me = this.team;
    const mine = view.units.filter((u) => u.team === me);
    if (d.distraction > 0 && this.rng.float() < d.distraction) {
      this.produce(view, mine, [], cmds);
      return cmds;
    }
    const tasks = this.buildTasks(view, mine);
    this.assign(tasks, mine);
    this.issueOrders(tasks, cmds);
    this.produce(view, mine, tasks, cmds);
    this.lastTasks = tasks;
    return cmds;
  }

  private noisy(v: number): number {
    const n = this.difficulty.noise;
    return n > 0 ? v * (1 + (this.rng.float() * 2 - 1) * n) : v;
  }

  // ---- Tasks -------------------------------------------------------------

  private buildTasks(view: PlayerView, mine: UnitView[]): Task[] {
    const d = this.difficulty;
    const me = this.team;
    const foe = 1 - me;
    const W = view.map.width;
    const H = view.map.height;
    const tasks: Task[] = [];
    const myCities = view.cities.filter((c) => c.owner === me);
    const foeCities = view.cities.filter((c) => c.owner === foe);
    const enemies = view.units.filter((u) => u.team === foe);
    const home = centroid(myCities) ?? centroid(mine) ?? { x: W / 2, y: H / 2 };
    const enemyHome = centroid(foeCities) ?? centroid(enemies) ?? { x: W - home.x, y: H - home.y };
    const task = (t: Omit<Task, 'units' | 'have' | 'plains' | 'pressure'> & { pressure?: number }): Task => ({
      pressure: 0,
      ...t,
      plains: plainsFraction(view, t.target.x, t.target.y, 6),
      units: [],
      have: 0,
    });
    const nearestOwnDist = (p: Vec2) => Math.min(...myCities.map((c) => dist(c, p)), dist(home, p));

    // Recover: badly hurt units fall back to the safest nearby city.
    if (d.retreat) {
      for (const u of mine) {
        const frac = u.hp / u.maxHp;
        if (frac < REST_BELOW) this.resting.add(u.id);
        if (frac > REST_UNTIL) this.resting.delete(u.id);
      }
      for (const id of [...this.resting]) if (!mine.some((u) => u.id === id)) this.resting.delete(id);
    }

    // Defend threatened cities.
    for (const c of myCities) {
      const threat = this.noisy(strengthNear(enemies, foe, c.x, c.y, 9));
      const beingTaken = c.captureTeam === foe && c.captureProgress > 0;
      if (threat > 0.4 || beingTaken) {
        tasks.push(task({ key: `def:${c.id}`, kind: 'defend', target: c, want: Math.max(threat * 1.4, 1.2), priority: 90 + threat * 4 }));
      }
    }

    // Expand to neutral cities (a big bonus early on).
    const early = view.tick < EARLY_GAME_TICKS ? 25 : 0;
    for (const c of view.cities) {
      if (c.owner !== -1) continue;
      const enemyNear = this.noisy(strengthNear(enemies, foe, c.x, c.y, 8));
      const ownNear = strengthNear(mine, me, c.x, c.y, 8);
      if (enemyNear > ownNear + 3 && enemyNear > 2) continue; // not worth walking into
      tasks.push(
        task({
          key: `cap:${c.id}`,
          kind: 'capture',
          target: c,
          want: 1 + enemyNear * 1.3,
          priority: 55 + early - nearestOwnDist(c) * 0.35 - enemyNear * 6,
        }),
      );
    }

    // Counterattack: enemy cities that are weakly held compared with what we can bring.
    if (d.counterattack && mine.length >= 4) {
      const total = mine.reduce((s, u) => s + unitStrength(u), 0);
      const scored = foeCities
        .map((c) => {
          const defense = this.noisy(strengthNear(enemies, foe, c.x, c.y, 9));
          const key = `atk:${c.id}`;
          const persist = this.attackKeys.includes(key) ? 0.6 : 0;
          const score = 1 / (defense + 0.5) - nearestOwnDist(c) / 60 + persist;
          return { c, defense, key, score };
        })
        .filter((a) => a.defense * d.attackRatio + 1.5 <= total * 0.5)
        .sort((a, b) => b.score - a.score || a.c.id - b.c.id)
        .slice(0, d.maxAttacks);
      this.attackKeys = scored.map((a) => a.key);
      for (const a of scored) {
        tasks.push(task({ key: a.key, kind: 'attack', target: a.c, want: a.defense * d.attackRatio + 1.5, priority: 45 + a.score * 5 }));
      }
    } else {
      this.attackKeys = [];
    }

    // Hold the front: sectors of the border with the enemy.
    const sectors = findFront(view, 6);
    const fx = enemyHome.x - home.x;
    const fy = enemyHome.y - home.y;
    const flen = Math.hypot(fx, fy) || 1;
    const toEnemy = { x: fx / flen, y: fy / flen };
    sectors.forEach((s, i) => {
      const pressure = this.noisy(strengthNear(enemies, foe, s.center.x, s.center.y, 10));
      tasks.push(
        task({
          key: `front:${i}`,
          kind: 'front',
          target: s.center,
          line: s.line,
          forward: toEnemy,
          pressure,
          want: 1 + pressure * 1.1 + s.size / 30,
          priority: 40 + pressure * 6,
        }),
      );
    });

    // Reserve: gather spare units at the most forward city, a little toward the enemy.
    const forward = myCities.slice().sort((a, b) => dist(a, enemyHome) - dist(b, enemyHome) || a.id - b.id)[0];
    if (forward) {
      const dx = enemyHome.x - forward.x;
      const dy = enemyHome.y - forward.y;
      const len = Math.hypot(dx, dy) || 1;
      tasks.push(task({ key: 'reserve', kind: 'reserve', target: { x: forward.x + (dx / len) * 3, y: forward.y + (dy / len) * 3 }, want: Infinity, priority: 0 }));
    }

    // Rest points: one task per city that isn't under threat.
    if (this.resting.size > 0 && myCities.length > 0) {
      const safe = myCities.filter((c) => strengthNear(enemies, foe, c.x, c.y, 8) < 0.5);
      for (const c of safe.length ? safe : myCities) {
        tasks.push(task({ key: `rest:${c.id}`, kind: 'rest', target: c, want: 0, priority: 200 }));
      }
    }
    tasks.sort((a, b) => b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return tasks;
  }

  // ---- Assignment ----------------------------------------------------------

  /** Travel cost of sending `u` to `t`, including terrain suitability. */
  private cost(u: UnitView, t: Task): number {
    let c = dist(u, t.target);
    if (this.difficulty.terrainAware) {
      if (u.type === 'heavy') c *= 1 + (1 - t.plains) * 2;
      else c *= 1 + t.plains * 0.25;
    }
    return c;
  }

  private give(t: Task, u: UnitView, free: Set<number>): void {
    t.units.push(u);
    t.have += unitStrength(u);
    free.delete(u.id);
    this.assignment.set(u.id, t.key);
  }

  private assign(tasks: Task[], mine: UnitView[]): void {
    const free = new Set(mine.map((u) => u.id));
    const byId = new Map(mine.map((u) => [u.id, u]));
    const byKey = new Map(tasks.map((t) => [t.key, t]));

    // Resting units go to the nearest rest point.
    const restTasks = tasks.filter((t) => t.kind === 'rest');
    for (const id of this.resting) {
      const u = byId.get(id);
      if (!u || restTasks.length === 0) continue;
      const best = restTasks.slice().sort((a, b) => dist(u, a.target) - dist(u, b.target) || (a.key < b.key ? -1 : 1))[0];
      this.give(best, u, free);
    }

    // Keep previous assignments that still make sense (avoids dithering).
    for (const t of tasks) {
      if (t.kind === 'rest' || t.kind === 'reserve') continue;
      for (const u of mine) {
        if (!free.has(u.id) || this.assignment.get(u.id) !== t.key) continue;
        if (t.have >= t.want * 1.3 && !u.engaged) continue;
        this.give(t, u, free);
      }
    }

    // Fill tasks in priority order with the cheapest free units.
    for (const t of tasks) {
      if (t.kind === 'rest' || t.kind === 'reserve') continue;
      while (t.have < t.want) {
        let best: UnitView | undefined;
        let bestCost = Infinity;
        for (const u of mine) {
          if (!free.has(u.id)) continue;
          if (u.engaged && t.kind !== 'defend') continue; // don't pull units out of fights
          const c = this.cost(u, t);
          if (c > 90 && t.kind !== 'defend') continue;
          if (c < bestCost) {
            bestCost = c;
            best = u;
          }
        }
        if (!best) break;
        this.give(t, best, free);
      }
    }

    // Leftovers: reinforce the front (nearest sector), else the reserve.
    const fronts = tasks.filter((t) => t.kind === 'front');
    const reserve = byKey.get('reserve');
    for (const u of mine) {
      if (!free.has(u.id)) continue;
      if (fronts.length > 0) {
        const f = fronts.slice().sort((a, b) => this.cost(u, a) / Math.max(0.5, a.want) - this.cost(u, b) / Math.max(0.5, b.want) || (a.key < b.key ? -1 : 1))[0];
        this.give(f, u, free);
      } else if (reserve) {
        this.give(reserve, u, free);
      }
    }
    for (const id of [...this.assignment.keys()]) if (!byId.has(id)) this.assignment.delete(id);
  }

  // ---- Orders --------------------------------------------------------------

  private issueOrders(tasks: Task[], cmds: Command[]): void {
    const team = this.team;
    for (const t of tasks) {
      if (t.units.length === 0) continue;
      const movable = t.units.filter((u) => !u.engaged || t.kind === 'rest').sort((a, b) => a.id - b.id);
      if (movable.length === 0) continue;
      if (t.kind === 'front' && t.line) {
        // Where we are clearly stronger, push the line into enemy land.
        const d = this.difficulty;
        const push = d.pushDistance > 0 && t.forward && t.have >= t.pressure * d.attackRatio + 1 ? d.pushDistance : 0;
        const line = push > 0 ? t.line.map((p) => ({ x: p.x + t.forward!.x * push, y: p.y + t.forward!.y * push })) : t.line;
        const sig = movable.map((u) => u.id).join(',') + '|' + line.map((p) => `${Math.round(p.x / 2)},${Math.round(p.y / 2)}`).join(';');
        const needs = this.lineSignatures.get(t.key) !== sig || movable.some((u) => u.dest === null && dist(u, t.target) > 12);
        if (needs) {
          this.lineSignatures.set(t.key, sig);
          cmds.push({ kind: 'line', team, unitIds: movable.map((u) => u.id), points: line.map((p) => [p.x, p.y] as [number, number]) });
        }
        continue;
      }
      const slack = 2 + Math.sqrt(movable.length) * 1.1;
      const stray = movable.filter((u) => {
        const aim = u.dest ?? u;
        return dist(aim, t.target) > slack;
      });
      if (stray.length > 0) {
        cmds.push({ kind: 'move', team, unitIds: stray.map((u) => u.id), x: t.target.x, y: t.target.y });
      }
    }
  }

  // ---- Production ----------------------------------------------------------

  private produce(view: PlayerView, mine: UnitView[], tasks: Task[], cmds: Command[]): void {
    const d = this.difficulty;
    const me = this.team;
    const myCities = view.cities.filter((c) => c.owner === me);
    if (myCities.length === 0) return;
    const free = view.supplyCap - view.unitCount - view.queue.length - d.supplyBuffer;
    if (free < 0 && view.queue.length > 0) {
      // Lost a city: stop building what we can't feed.
      cmds.push({ kind: 'cancel', team: me, itemId: view.queue[view.queue.length - 1].id });
      return;
    }
    if (free <= 0 || view.queue.length > 0) return;

    const type = this.chooseType(mine, tasks);
    if (view.pp < UNIT_STATS[type].cost + d.ppHoard) return;
    const city = this.spawnCity(view, myCities, tasks);
    cmds.push({ kind: 'produce', team: me, unitType: type, cityId: city.id });
  }

  private chooseType(mine: UnitView[], tasks: Task[]): UnitType {
    const d = this.difficulty;
    if (!d.terrainAware) return this.rng.float() < 0.25 ? 'heavy' : 'light';
    const active = tasks.filter((t) => t.kind === 'front' || t.kind === 'attack' || t.kind === 'defend');
    let open = 0.5;
    if (active.length > 0) {
      let w = 0;
      let sum = 0;
      for (const t of active) {
        const weight = Math.max(0.5, Math.min(8, t.want));
        sum += t.plains * weight;
        w += weight;
      }
      open = sum / w;
    }
    const targetShare = Math.max(0, Math.min(0.45, (open - 0.45) * 1.6));
    const heavies = mine.filter((u) => u.type === 'heavy').length;
    const share = mine.length > 0 ? heavies / mine.length : 0;
    return share < targetShare ? 'heavy' : 'light';
  }

  private spawnCity(view: PlayerView, myCities: CityView[], tasks: Task[]): CityView {
    const foe = 1 - this.team;
    const enemies = view.units.filter((u) => u.team === foe);
    const safe = myCities.filter((c) => strengthNear(enemies, foe, c.x, c.y, 5) < 1);
    const pool = safe.length > 0 ? safe : myCities;
    const focus = tasks.find((t) => t.kind === 'defend' || t.kind === 'front' || t.kind === 'attack');
    if (!focus) return pool[0];
    return pool.slice().sort((a, b) => dist(a, focus.target) - dist(b, focus.target) || a.id - b.id)[0];
  }
}
