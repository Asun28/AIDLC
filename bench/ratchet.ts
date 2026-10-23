// The bench gate (card T0-LOOP-BENCH): counts against checked-in ceilings that only go down. Pure: no I/O, no clock.
import { z } from 'zod';

/** The counts the gate compares. A metric that stops tracking wall time leaves this list (docs/OPERATIONS.md, Loop benchmark). */
export const GATED = ['modules', 'depBytes', 'startFsCalls', 'fsCalls', 'fsBytesRead', 'spawns', 'outBytes'] as const;
export type Metric = (typeof GATED)[number];
export type Entry = 'dist' | 'src' | 'none';

/** One journey's counts, from the counter (`bench/counter.ts`) and the run (`bench/journeys.ts`). */
export interface Measured {
  id: string;
  entry: Entry;
  counts: Record<Metric, number>;
  /** Source bytes of the modules outside node_modules: reported, never compared, since dist/ and src/ differ. */
  ownBytes: number;
  deps: Record<string, number>;
  wallMs?: number;
}

const Ceilings = z.object(Object.fromEntries(GATED.map((m) => [m, z.number().nonnegative().optional()])) as Record<Metric, z.ZodOptional<z.ZodNumber>>).strict();

const PerMetric = z.object(Object.fromEntries(GATED.map((m) => [m, z.number().nonnegative()])) as Record<Metric, z.ZodNumber>).strict();

export const Baseline = z
  .object({
    /** A count fails above the larger of `ceiling * (1 + slack)` and `ceiling + allowance`. */
    slack: PerMetric,
    allowance: PerMetric,
    journeys: z.record(z.string(), z.object({ entry: z.enum(['dist', 'src', 'none']), ceilings: Ceilings }).strict()),
  })
  .strict();
export type Baseline = z.infer<typeof Baseline>;

export interface MetricResult {
  metric: Metric;
  count: number;
  ceiling?: number;
  /** `new`: no ceiling yet, gated after the next ratchet. `skipped`: `startFsCalls` of another entry than the baseline's. */
  status: 'pass' | 'fail' | 'new' | 'skipped';
}

export interface JourneyReport {
  id: string;
  entry: Entry;
  ok: boolean;
  metrics: MetricResult[];
  ownBytes: number;
  /** The three largest dependencies by source bytes loaded: where a cut pays most. */
  topDeps: [string, number][];
  wallMs?: number;
}

/**
 * Each gated count against its ceiling: a count above the larger of `ceiling * (1 + slack)` and `ceiling + allowance`
 * fails, so a small count does not fail on one more fs call, which costs microseconds. `startFsCalls` counts the bin
 * freshness check, which a checkout without dist/ skips, so it is compared only on the entry the baseline recorded.
 */
export function compare(measured: Measured[], baseline: Baseline): JourneyReport[] {
  return measured.map((m) => {
    const recorded = baseline.journeys[m.id];
    const metrics = GATED.map((metric): MetricResult => {
      const count = m.counts[metric];
      const ceiling = recorded?.ceilings[metric];
      if (ceiling === undefined) return { metric, count, status: 'new' };
      if (metric === 'startFsCalls' && m.entry !== recorded?.entry) return { metric, count, ceiling, status: 'skipped' };
      const limit = Math.max(ceiling * (1 + baseline.slack[metric]), ceiling + baseline.allowance[metric]);
      return { metric, count, ceiling, status: count > limit ? 'fail' : 'pass' };
    });
    const topDeps = Object.entries(m.deps)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3);
    return { id: m.id, entry: m.entry, ok: metrics.every((r) => r.status !== 'fail'), metrics, ownBytes: m.ownBytes, topDeps, ...(m.wallMs === undefined ? {} : { wallMs: m.wallMs }) };
  });
}

/** The middle value (the upper one of an even count): the wall time `--time` reports. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The baseline with each ceiling lowered to its count, never raised; a journey or metric with no ceiling gets its
 * count. Only counts of the compiled entry are recorded, since a source run without dist/ skips the freshness check
 * and would record a `startFsCalls` the shipped path never meets.
 */
export function ratchet(measured: Measured[], baseline: Baseline): Baseline {
  const notCompiled = measured.filter((m) => m.entry !== 'dist').map((m) => `${m.id} (${m.entry})`);
  if (notCompiled.length) throw new Error(`ratchet records the compiled entry only; these journeys ran src or no entry: ${notCompiled.join(', ')}. Run npm run build first.`);
  const journeys: Baseline['journeys'] = { ...baseline.journeys };
  for (const m of measured) {
    const ceilings: Baseline['journeys'][string]['ceilings'] = { ...baseline.journeys[m.id]?.ceilings };
    for (const metric of GATED) {
      const ceiling = ceilings[metric];
      ceilings[metric] = ceiling === undefined ? m.counts[metric] : Math.min(ceiling, m.counts[metric]);
    }
    journeys[m.id] = { entry: 'dist', ceilings };
  }
  return { slack: baseline.slack, allowance: baseline.allowance, journeys };
}
