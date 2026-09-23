import { VICTORY } from '../config';
import type { World } from './types';

export const DRAW = -2;

/** Cities a team must hold to win. */
export function citiesNeededToWin(totalCities: number): number {
  return Math.max(1, Math.ceil(totalCities * VICTORY.cityShare - 1e-9));
}

/** Sets world.winner when a team holds enough cities or is the last with units. */
export function checkVictory(world: World): void {
  if (world.winner !== -1) return;
  const teams = world.teams.length;
  const unitCounts = new Array<number>(teams).fill(0);
  const cityCounts = new Array<number>(teams).fill(0);
  for (const u of world.units) unitCounts[u.team]++;
  for (const c of world.cities) if (c.owner >= 0) cityCounts[c.owner]++;

  if (world.cities.length > 0) {
    const need = citiesNeededToWin(world.cities.length);
    for (let t = 0; t < teams; t++) {
      if (cityCounts[t] >= need) {
        world.winner = t;
        world.events.push({ kind: 'victory', team: t, reason: 'cities' });
        return;
      }
    }
  }
  const alive: number[] = [];
  for (let t = 0; t < teams; t++) if (unitCounts[t] > 0) alive.push(t);
  if (alive.length === 1) {
    world.winner = alive[0];
    world.events.push({ kind: 'victory', team: alive[0], reason: 'elimination' });
  } else if (alive.length === 0) {
    world.winner = DRAW;
    world.events.push({ kind: 'victory', team: DRAW, reason: 'draw' });
  }
}
