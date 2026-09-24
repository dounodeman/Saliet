/**
 * AI difficulty = how fast it reacts and how well it decides. All levels use the
 * same command interface and see the same information.
 */
export interface Difficulty {
  name: DifficultyName;
  label: string;
  /** Ticks between decisions (20 ticks = 1 s). */
  reactionTicks: number;
  /** ± relative error applied to every strength estimate. */
  noise: number;
  /** Launch attacks on weak enemy cities. */
  counterattack: boolean;
  /** Max simultaneous attack groups. */
  maxAttacks: number;
  /** Our local strength must exceed theirs by this factor before attacking. */
  attackRatio: number;
  /** Pull badly hurt units back to heal. */
  retreat: boolean;
  /** Pick heavies for open ground and keep them off rough terrain. */
  terrainAware: boolean;
  /** Keep this many supply slots free (a small buffer against losing a city). */
  supplyBuffer: number;
  /** Chance per decision to skip re-planning (sloppiness). */
  distraction: number;
  /** Production points hoarded before queueing (slower build-up). */
  ppHoard: number;
  /** How far (cells) a locally superior front sector advances into enemy land; 0 = hold only. */
  pushDistance: number;
}

export type DifficultyName = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: Record<DifficultyName, Difficulty> = {
  easy: {
    name: 'easy',
    label: 'Easy',
    reactionTicks: 60,
    noise: 0.4,
    counterattack: false,
    maxAttacks: 0,
    attackRatio: 3,
    retreat: false,
    terrainAware: false,
    supplyBuffer: 2,
    distraction: 0.3,
    ppHoard: 40,
    pushDistance: 0,
  },
  normal: {
    name: 'normal',
    label: 'Normal',
    reactionTicks: 30,
    noise: 0.15,
    counterattack: true,
    maxAttacks: 1,
    attackRatio: 1.8,
    retreat: true,
    terrainAware: true,
    supplyBuffer: 1,
    distraction: 0.08,
    ppHoard: 0,
    pushDistance: 3,
  },
  hard: {
    name: 'hard',
    label: 'Hard',
    reactionTicks: 10,
    noise: 0,
    counterattack: true,
    maxAttacks: 2,
    attackRatio: 1.35,
    retreat: true,
    terrainAware: true,
    supplyBuffer: 0,
    distraction: 0,
    ppHoard: 0,
    pushDistance: 3,
  },
};
