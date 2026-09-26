/**
 * RED seam (card T1-PARSE-GUARD, R3 decision 1 F1): the behaviour of the code before this card under the names of the new
 * module, so the RED suite runs its assertions against the baseline instead of failing on the import. The merge that follows
 * replaces this file with the implementation.
 */
import { detectQuotaHold as baselineQuotaHold } from './review-policy.ts';

export { quotaOutput } from './review-policy.ts';

export interface QuotaSignal { hold: boolean; via: 'structured' | 'text'; evidence?: string; retryAfterMs?: number }

/** The split `collectCandidateDiff` made before this card: NUL or a line break. */
export const nulList = (stdout: string): string[] => stdout.split(/\u0000|\r?\n/).filter((name) => name.length > 0);

/** The text-only rule of review-policy.ts before this card; the status argument is ignored, as no caller had one. */
export function detectQuotaHold(text: string | undefined, _status?: number, _retryAfterMs?: number): QuotaSignal {
  return baselineQuotaHold(text) as unknown as QuotaSignal;
}
