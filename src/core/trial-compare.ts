/**
 * Median and range over trials, and the four-way verdict on two summaries (card T1-BENCH-TRIALS-2). Pure: the reviewer
 * bench passes recall and the false-block rate; another caller can pass any rate where higher is better and one where
 * lower is better. A difference counts only when the two ranges (minimum to maximum) do not overlap.
 */
import { z } from 'zod';

/** A rate over trials, each value from 0 to 1. */
const Rate = z.number().min(0).max(1);
export const TrialRange = z.object({ median: Rate, min: Rate, max: Rate });
export type TrialRange = z.infer<typeof TrialRange>;

/** `recall` is higher-is-better and `falseBlockRate` lower-is-better; each is null when any trial had none. */
export const TrialSummary = z.object({ trials: z.number().int().min(1), recall: TrialRange.nullable(), falseBlockRate: TrialRange.nullable(), noVerdict: z.number().int().min(0), errors: z.number().int().min(0) });
export type TrialSummary = z.infer<typeof TrialSummary>;

export type TrialVerdict = 'better' | 'worse' | 'no-measurable-difference' | 'inconclusive';

/** The fewest trials a side needs for a verdict other than `inconclusive`. */
export const MIN_TRIALS = 3;

/** The median, minimum and maximum of the trial values; null when there is none or any is null. */
export function trialRange(values: Array<number | null>): TrialRange | null {
  if (!values.length || values.some((v) => v === null)) return null;
  const xs = (values as number[]).slice().sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return { median, min: xs[0]!, max: xs[xs.length - 1]! };
}

export type TrialSide = { summary: TrialSummary; caseIds: string[] };

const span = (r: TrialRange) => `${r.min.toFixed(2)} to ${r.max.toFixed(2)}`;

/** The verdict on `after` against `before`, with a one-line reason built from the summaries; case ids are quoted as JSON strings. */
export function compareTrials(before: TrialSide, after: TrialSide): { verdict: TrialVerdict; reason: string } {
  const causes: string[] = [];
  const only = (a: string[], b: string[]) => [...new Set(a)].filter((id) => !b.includes(id)).sort();
  const [onlyBefore, onlyAfter] = [only(before.caseIds, after.caseIds), only(after.caseIds, before.caseIds)];
  if (onlyBefore.length || onlyAfter.length) {
    const list = (name: string, ids: string[]) => (ids.length ? [`only ${name} ${ids.map((id) => JSON.stringify(id)).join(', ')}`] : []);
    causes.push(`the case ids differ: ${[...list('before', onlyBefore), ...list('after', onlyAfter)].join(', ')}`);
  }
  for (const [name, s] of [['before', before.summary], ['after', after.summary]] as const) {
    if (s.trials < MIN_TRIALS) causes.push(`${name} has ${s.trials} trials, fewer than the ${MIN_TRIALS} a verdict needs`);
    if (s.noVerdict || s.errors) causes.push(`${name} has ${s.noVerdict} no-verdict and ${s.errors} errors over its trials`);
  }
  if (causes.length) return { verdict: 'inconclusive', reason: causes.join('; ') };
  const decide = (name: string, a: TrialRange | null, b: TrialRange | null, higherIsBetter: boolean) => {
    if (!a || !b || (b.max >= a.min && b.min <= a.max)) return undefined;
    const verdict: TrialVerdict = b.min > a.max === higherIsBetter ? 'better' : 'worse';
    return { verdict, reason: `${name} ${span(b)} after, ${span(a)} before: the ranges do not overlap` };
  };
  const { recall: r0, falseBlockRate: f0 } = before.summary;
  const { recall: r1, falseBlockRate: f1 } = after.summary;
  return decide('recall', r0, r1, true) ?? decide('false-block rate', f0, f1, false) ?? { verdict: 'no-measurable-difference', reason: 'the recall ranges and the false-block rate ranges each overlap or are not scored on both sides' };
}
