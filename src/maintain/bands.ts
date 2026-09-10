/**
 * Control-band monitoring (playbook Stage 6 "Maintenance and closing the loop").
 *
 * Detection is deterministic: rolling baseline mean/std over a window plus Western Electric
 * rules. No model is involved in detection. Response tiers come from version-controlled
 * `bands.yaml`: 1σ log, 2σ diagnose (read-only tools), 3σ propose (PR or pre-approved runbook).
 */
import { z } from 'zod';
import YAML from 'yaml';

export const BandTier = z.object({
  action: z.enum(['log', 'diagnose', 'propose']),
  tools: z.string().optional(),
  routes: z.array(z.string()).optional(),
});

export const BandsConfig = z.object({
  metric: z.string().min(1),
  baseline: z.string().default('rolling_30d'),
  rules: z.enum(['western_electric', 'threshold']).default('western_electric'),
  /** Minimum baseline samples before any band is evaluated. */
  min_samples: z.number().int().positive().default(8),
  direction: z.enum(['both', 'above', 'below']).default('both'),
  tiers: z.object({ '1sigma': BandTier.optional(), '2sigma': BandTier.optional(), '3sigma': BandTier.optional() }),
  owner: z.string().optional(),
  dedupe_window_ms: z.number().int().positive().default(6 * 60 * 60 * 1000),
});
export type BandsConfig = z.infer<typeof BandsConfig>;

export function parseBandsYaml(text: string): BandsConfig {
  return BandsConfig.parse(YAML.parse(text));
}

export interface Sample {
  at: string;
  value: number;
}

export interface Baseline {
  mean: number;
  std: number;
  n: number;
}

export function computeBaseline(samples: number[]): Baseline {
  const n = samples.length;
  if (n === 0) return { mean: 0, std: 0, n: 0 };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, std: Math.sqrt(variance), n };
}

export type WesternElectricRule = 'WE1' | 'WE2' | 'WE3' | 'WE4';

export interface BandBreach {
  metric: string;
  rule: WesternElectricRule | 'threshold';
  sigma: 1 | 2 | 3;
  side: 'above' | 'below';
  tier: '1sigma' | '2sigma' | '3sigma';
  action: 'log' | 'diagnose' | 'propose';
  observed: number[];
  baseline: Baseline;
  at: string;
  detail: string;
}

function sideOf(v: number, mean: number): 'above' | 'below' {
  return v >= mean ? 'above' : 'below';
}

/**
 * Evaluate Western Electric rules on the most recent points against a baseline:
 * WE1: one point beyond 3σ (tier 3σ)
 * WE2: two of three consecutive beyond 2σ on the same side (tier 2σ)
 * WE3: four of five consecutive beyond 1σ on the same side (tier 1σ)
 * WE4: eight consecutive on the same side of the mean (tier 1σ, slow drift)
 */
export function evaluateBands(config: BandsConfig, baselineSamples: number[], recent: Sample[]): BandBreach[] {
  const baseline = computeBaseline(baselineSamples);
  const breaches: BandBreach[] = [];
  if (baseline.n < config.min_samples || recent.length === 0) return breaches;
  const std = baseline.std;
  const allowSide = (s: 'above' | 'below') => config.direction === 'both' || config.direction === s;
  const last = recent[recent.length - 1]!;
  const z = (v: number) => (std === 0 ? (v === baseline.mean ? 0 : Number.POSITIVE_INFINITY) : Math.abs(v - baseline.mean) / std);
  const push = (rule: BandBreach['rule'], sigma: 1 | 2 | 3, side: 'above' | 'below', observed: Sample[], detail: string) => {
    const tier = (`${sigma}sigma`) as BandBreach['tier'];
    const cfg = config.tiers[tier];
    if (!cfg || !allowSide(side)) return;
    breaches.push({ metric: config.metric, rule, sigma, side, tier, action: cfg.action, observed: observed.map((s) => s.value), baseline, at: last.at, detail });
  };
  // WE1
  if (z(last.value) > 3) push('WE1', 3, sideOf(last.value, baseline.mean), [last], `one point ${z(last.value).toFixed(2)}σ from baseline mean ${baseline.mean.toFixed(3)}`);
  // WE2
  const last3 = recent.slice(-3);
  if (last3.length === 3) {
    for (const side of ['above', 'below'] as const) {
      const hits = last3.filter((s) => sideOf(s.value, baseline.mean) === side && z(s.value) > 2);
      if (hits.length >= 2) push('WE2', 2, side, last3, `two of three consecutive points beyond 2σ ${side}`);
    }
  }
  // WE3
  const last5 = recent.slice(-5);
  if (last5.length === 5) {
    for (const side of ['above', 'below'] as const) {
      const hits = last5.filter((s) => sideOf(s.value, baseline.mean) === side && z(s.value) > 1);
      if (hits.length >= 4) push('WE3', 1, side, last5, `four of five consecutive points beyond 1σ ${side}`);
    }
  }
  // WE4
  const last8 = recent.slice(-8);
  if (last8.length === 8) {
    for (const side of ['above', 'below'] as const) {
      if (last8.every((s) => sideOf(s.value, baseline.mean) === side && s.value !== baseline.mean)) push('WE4', 1, side, last8, `eight consecutive points ${side} the mean (drift)`);
    }
  }
  // Dedupe: keep the highest tier per side.
  const best = new Map<string, BandBreach>();
  for (const b of breaches) {
    const key = b.side;
    const prev = best.get(key);
    if (!prev || b.sigma > prev.sigma) best.set(key, b);
  }
  return [...best.values()];
}

/** Stable identity for deduplicating incident intents within the dedupe window. */
export function breachIdentity(b: BandBreach): string {
  return `${b.metric}:${b.rule}:${b.side}:${b.tier}`;
}

export const DEFAULT_BANDS_YAML = `# Control-band monitoring (Stage 6). Detection is deterministic; Claude is invoked only when a band breaches.
metric: ci_test_failure_rate
baseline: rolling_30d
rules: western_electric
min_samples: 8
direction: above
tiers:
  1sigma: { action: log }
  2sigma: { action: diagnose, tools: "Read,Grep,Bash(gh run view *)" }
  3sigma: { action: propose, routes: [pull_request, runbook:rollback-deploy] }
owner: service-owner
dedupe_window_ms: 21600000
`;
