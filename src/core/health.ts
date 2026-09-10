/**
 * Health evaluation (plan v5 LC7 "Health is measured, not inferred from waiting").
 *
 * Every required signal declares its source, threshold, minimum samples, staleness bound and
 * window. Missing telemetry, stale data, no traffic or an unavailable probe can never become
 * PASS; they are INSUFFICIENT_DATA. A ten-minute soak is a project setting, never a proof.
 */
import type { HealthResult, HealthSignal } from './types.ts';

export interface SignalEvaluation {
  name: string;
  result: HealthResult;
  detail: string;
  synthetic: boolean;
}

export interface HealthEvaluation {
  result: HealthResult;
  signals: SignalEvaluation[];
  candidate?: string;
  environment?: string;
  window: { from: string; to: string };
  evaluatedAt: string;
}

function compare(op: HealthSignal['threshold']['op'], observed: number, value: number): boolean {
  switch (op) {
    case '<':
      return observed < value;
    case '<=':
      return observed <= value;
    case '>':
      return observed > value;
    case '>=':
      return observed >= value;
    case '==':
      return observed === value;
    default:
      return false;
  }
}

export function evaluateSignal(signal: HealthSignal, now: string): SignalEvaluation {
  const base = { name: signal.name, synthetic: signal.synthetic };
  if (!signal.probeAvailable) return { ...base, result: 'INSUFFICIENT_DATA', detail: 'required probe unavailable' };
  if (signal.samples < signal.minSamples) {
    return { ...base, result: 'INSUFFICIENT_DATA', detail: `samples ${signal.samples} < required ${signal.minSamples}` };
  }
  if (!signal.lastSampleAt) return { ...base, result: 'INSUFFICIENT_DATA', detail: 'no sample timestamp' };
  const age = Date.parse(now) - Date.parse(signal.lastSampleAt);
  if (age > signal.maxStalenessMs) return { ...base, result: 'INSUFFICIENT_DATA', detail: `last sample ${Math.round(age / 1000)}s old exceeds ${Math.round(signal.maxStalenessMs / 1000)}s` };
  if (signal.observed === undefined || Number.isNaN(signal.observed)) return { ...base, result: 'INSUFFICIENT_DATA', detail: 'no observed value' };
  const ok = compare(signal.threshold.op, signal.observed, signal.threshold.value);
  return ok
    ? { ...base, result: 'PASS', detail: `${signal.observed} ${signal.threshold.op} ${signal.threshold.value}` }
    : { ...base, result: 'BREACH', detail: `${signal.observed} violates ${signal.threshold.op} ${signal.threshold.value}` };
}

export function evaluateHealth(
  signals: HealthSignal[],
  window: { from: string; to: string },
  now: string,
  binding: { candidate?: string; environment?: string } = {},
): HealthEvaluation {
  if (signals.length === 0) {
    return { result: 'INSUFFICIENT_DATA', signals: [], window, evaluatedAt: now, ...binding };
  }
  const evaluated = signals.map((s) => evaluateSignal(s, now));
  let result: HealthResult = 'PASS';
  if (evaluated.some((e) => e.result === 'BREACH')) result = 'BREACH';
  else if (evaluated.some((e) => e.result === 'INSUFFICIENT_DATA')) result = 'INSUFFICIENT_DATA';
  return { result, signals: evaluated, window, evaluatedAt: now, ...binding };
}

/** Whether the observation window has elapsed; only then is a PASS meaningful. */
export function windowElapsed(window: { from: string; to: string }, now: string): boolean {
  return Date.parse(now) >= Date.parse(window.to);
}
