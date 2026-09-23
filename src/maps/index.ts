import { rasterizeMapDef, validateMapDef } from '../sim/mapdef';
import { generateScenario } from '../sim/mapgen';
import type { Scenario } from '../sim/types';
import highlandPass from './highland-pass.json';
import twinRivers from './twin-rivers.json';

export interface MapEntry {
  id: string;
  name: string;
  description: string;
  /** Builds the scenario; `seed` only matters for procedural maps. */
  build: (seed: number) => Scenario;
}

function fromJson(id: string, json: unknown): MapEntry {
  const def = validateMapDef(json);
  return {
    id,
    name: def.name,
    description: def.description ?? '',
    build: () => rasterizeMapDef(def),
  };
}

export const MAPS: MapEntry[] = [
  fromJson('twin-rivers', twinRivers),
  fromJson('highland-pass', highlandPass),
  {
    id: 'random',
    name: 'Random',
    description: 'A procedurally generated, mirror-fair map from a seed.',
    build: (seed) => generateScenario(seed),
  },
];

export function getMap(id: string): MapEntry {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
