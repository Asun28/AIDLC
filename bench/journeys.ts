// Seam for card T0-LOOP-BENCH: the journeys run nothing yet.
import type { Measured } from './ratchet.ts';

export interface Journey {
  id: string;
  script: 'bin/aidlc-hook.js' | 'bin/aidlc.js';
  args: string[];
  event?: Record<string, unknown>;
  goals?: number;
}

export const JOURNEYS: Journey[] = [];

export interface RunOptions {
  root: string;
  tmpRoot?: string;
  counter?: boolean;
}

export function runJourney(journey: Journey, _options: RunOptions): Measured {
  return {
    id: journey.id,
    entry: 'none',
    counts: { modules: 0, depBytes: 0, startFsCalls: 0, fsCalls: 0, fsBytesRead: 0, spawns: 0, outBytes: 0 },
    ownBytes: 0,
    deps: {},
  };
}
