/**
 * Parse guard (card T1-PARSE-GUARD): the control decisions read from process output. A `-z` name listing splits on NUL only;
 * a quota hold comes from a provider's numeric error status when it reports one, else from one word rule over the text.
 */
export const nulList = (stdout: string): string[] => stdout.split('\u0000').filter((name) => name.length > 0);

/** A process that exited 0 wrote its answer to stdout, where its reasoning can name a quota word, so only its stderr reports a hold. */
export const quotaOutput = (r: { exitCode: number | null; stdout: string; stderr: string }): string => (r.exitCode === 0 ? r.stderr : `${r.stdout}\n${r.stderr}`);

export interface QuotaSignal { hold: boolean; via: 'structured' | 'text'; evidence?: string; retryAfterMs?: number }

/** A quota word in any letter case, with no letter or digit of any script directly before or after it. */
const QUOTA = /(?<![\p{L}\p{N}])(?:rate[- ]?limit(?:s|ed|er|ing)?|quotas?|usage limits?|429s?|retry[- ]after|too many requests|capacity|overloaded)(?![\p{L}\p{N}])/iu;
/** `_`, a lowercase-to-uppercase change and the last capital of a run before a capitalised word separate words like a space. */
const asWords = (text: string) => text.replace(/_/g, ' ').replace(/(\p{Ll})(?=\p{Lu})|(\p{Lu})(?=\p{Lu}\p{Ll})/gu, '$1$2 ');
const RETRY = /retry[- ]after[:=\s]+(\d+)\s*(ms|m)?/i;

/** A numeric status decides alone (429 and 529 hold); without one the word rule decides. The result names the path that decided. */
export function detectQuotaHold(text: string | undefined, status?: number, retryAfterMs?: number): QuotaSignal {
  const held = status === 429 || status === 529;
  if (status !== undefined) return { hold: held, via: 'structured', evidence: `status ${status}`, ...(held && retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  const word = QUOTA.exec(asWords(text ?? ''))?.[0];
  if (!word) return { hold: false, via: 'text' };
  const retry = RETRY.exec(text ?? '');
  return { hold: true, via: 'text', evidence: word, ...(retry ? { retryAfterMs: Number(retry[1]) * (retry[2] === undefined ? 1000 : retry[2].toLowerCase() === 'ms' ? 1 : 60_000) } : {}) };
}
