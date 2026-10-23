// Seam for card T0-LOOP-BENCH: the API with no comparison yet.
import { z } from 'zod';

export const GATED = ['modules', 'depBytes', 'startFsCalls', 'fsCalls', 'fsBytesRead', 'spawns', 'outBytes'] as const;
export type Metric = (typeof GATED)[number];
export type Entry = 'dist' | 'src' | 'none';

export interface Measured {
  id: string;
  entry: Entry;
  counts: Record<Metric, number>;
  ownBytes: number;
  deps: Record<string, number>;
  wallMs?: number;
}

const Ceilings = z.object(Object.fromEntries(GATED.map((m) => [m, z.number().nonnegative().optional()])) as Record<Metric, z.ZodOptional<z.ZodNumber>>).strict();

export const Baseline = z
  .object({
    slack: z.object(Object.fromEntries(GATED.map((m) => [m, z.number().nonnegative()])) as Record<Metric, z.ZodNumber>).strict(),
    journeys: z.record(z.string(), z.object({ entry: z.enum(['dist', 'src', 'none']), ceilings: Ceilings }).strict()),
  })
  .strict();
export type Baseline = z.infer<typeof Baseline>;

export interface MetricResult {
  metric: Metric;
  count: number;
  ceiling?: number;
  status: 'pass' | 'fail' | 'new' | 'skipped';
}

export interface JourneyReport {
  id: string;
  entry: Entry;
  ok: boolean;
  metrics: MetricResult[];
  ownBytes: number;
  topDeps: [string, number][];
  wallMs?: number;
}

export function compare(measured: Measured[], _baseline: Baseline): JourneyReport[] {
  return measured.map((m) => ({ id: m.id, entry: m.entry, ok: true, metrics: [], ownBytes: m.ownBytes, topDeps: [] }));
}

export function ratchet(_measured: Measured[], baseline: Baseline): Baseline {
  return baseline;
}
