import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { detectQuotaHold, nulList, quotaOutput } from '../../src/core/parse-guard.ts';
import { classifyPreReview } from '../../src/review/pre-review.ts';

const SRC = path.join(import.meta.dirname, '..', '..', 'src');
/** Every TypeScript source under src/, as a path relative to src/ with forward slashes. */
const SOURCES = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => f.split(path.sep).join('/'));
const source = (file: string) => readFileSync(path.join(SRC, file), 'utf8');
const holds = (text: string) => detectQuotaHold(text).hold;

describe('nulList (T1-PARSE-GUARD acceptance 3)', () => {
  test('splits a -z listing on NUL only: a name with a newline stays whole and empty entries are dropped [R3]', () => {
    assert.deepEqual(nulList('docs/line\nbreak.md\u0000src/a.ts\u0000'), ['docs/line\nbreak.md', 'src/a.ts']);
    assert.deepEqual(nulList(' lead.md\u0000\u0000'), [' lead.md'], 'a name is never trimmed');
    assert.deepEqual(nulList(''), []);
  });
  test('no src/ file splits a -z listing outside nulList: no split on a NUL literal, and every file that asks git for -z calls nulList [R3]', () => {
    const nulSplit = /\.split\(\s*(?:'[^'\n]*|"[^"\n]*|\/[^/\n]*)(?:\\u0000|\\0|\\x00)/;
    const splitting = SOURCES.filter((f) => f !== 'core/parse-guard.ts' && nulSplit.test(source(f)));
    assert.deepEqual(splitting, [], `a NUL split outside nulList in: ${splitting.join(', ')}`);
    const listing = SOURCES.filter((f) => source(f).includes("'-z'"));
    assert.ok(listing.length >= 3, `the -z listings resolved to ${listing.join(', ')}`);
    const unguarded = listing.filter((f) => !source(f).includes('nulList('));
    assert.deepEqual(unguarded, [], `a -z listing not read through nulList in: ${unguarded.join(', ')}`);
  });
});

describe('quotaOutput', () => {
  test('a process that exited 0 reports a hold on stderr alone; any other process on either stream', () => {
    assert.equal(quotaOutput({ exitCode: 0, stdout: 'answer', stderr: 'warn' }), 'warn');
    assert.equal(quotaOutput({ exitCode: 1, stdout: 'out', stderr: 'err' }), 'out\nerr');
    assert.equal(quotaOutput({ exitCode: null, stdout: 'out', stderr: 'err' }), 'out\nerr');
  });
});

describe('detectQuotaHold: a numeric status first, else the word rule (T1-PARSE-GUARD acceptance 4)', () => {
  test('status 429 and 529 hold with via structured and name the status [R4]', () => {
    assert.deepEqual(detectQuotaHold('anything', 429), { hold: true, via: 'structured', evidence: 'status 429' });
    assert.deepEqual(detectQuotaHold(undefined, 529), { hold: true, via: 'structured', evidence: 'status 529' });
  });
  test('status 500 with quota words in the text does not hold: the status decides alone [R4]', () => {
    assert.deepEqual(detectQuotaHold('quota exceeded, overloaded, 429 Too Many Requests, retry after 30 seconds', 500), { hold: false, via: 'structured', evidence: 'status 500' });
    assert.equal(detectQuotaHold('rate limit', 0).via, 'structured', 'a status of 0 is a status');
  });
  test('a structured hold carries the retry delay the provider gave, never one read from the text [R4]', () => {
    assert.deepEqual(detectQuotaHold('retry after 5 seconds', 429, 30_000), { hold: true, via: 'structured', evidence: 'status 429', retryAfterMs: 30_000 });
  });
  test('without a status the word rule decides, returns via text and the matched word [R4]', () => {
    assert.deepEqual(detectQuotaHold('Error: quota exceeded'), { hold: true, via: 'text', evidence: 'quota' });
    assert.deepEqual(detectQuotaHold('HTTP 429 Too Many Requests; retry-after: 120 s'), { hold: true, via: 'text', evidence: '429', retryAfterMs: 120_000 });
    assert.deepEqual(detectQuotaHold('all good'), { hold: false, via: 'text' });
    assert.deepEqual(detectQuotaHold(undefined), { hold: false, via: 'text' });
    assert.deepEqual(detectQuotaHold(''), { hold: false, via: 'text' });
  });
  test('the retry delay is read in milliseconds, seconds (the default) and minutes', () => {
    assert.equal(detectQuotaHold('retry after 250 ms').retryAfterMs, 250);
    assert.equal(detectQuotaHold('retry after 30').retryAfterMs, 30_000);
    assert.equal(detectQuotaHold('retry after 30 sec').retryAfterMs, 30_000);
    assert.equal(detectQuotaHold('Retry-After: 2 min').retryAfterMs, 120_000);
    assert.equal(detectQuotaHold('retry after 3 minutes').retryAfterMs, 180_000);
    assert.equal(detectQuotaHold('quota exceeded').retryAfterMs, undefined);
  });
});

describe('the six items of issue #45, decided (T1-PARSE-GUARD acceptance 7)', () => {
  test('#45.1: an all-capitals word with a lowercase suffix is cut before its last capital and never holds', () => {
    assert.equal(holds('QUOTAs'), false);
    assert.equal(holds('RATE LIMITed'), false);
    assert.equal(holds('QUOTAS'), true, 'the all-capitals plural still holds');
    assert.equal(holds('RATE LIMITED'), true);
  });
  test('#45.2: camelCase identifiers hold on the output of a process that did not exit 0, and not on the stdout of one that exited 0', () => {
    for (const id of ['retryAfterMs', 'usageLimit', 'tooManyRequests']) {
      assert.equal(holds(quotaOutput({ exitCode: 1, stdout: `{"${id}": 1}`, stderr: '' })), true, `${id} on a failed process`);
      assert.equal(holds(quotaOutput({ exitCode: 0, stdout: `{"${id}": 1}`, stderr: '' })), false, `${id} on the answer of a process that exited 0`);
    }
  });
  test('#45.3: a review that timed out with a quota message on stderr stays a timeout no-verdict round, never a hold', () => {
    const r = classifyPreReview(undefined, { exitCode: null, timedOut: true, stdout: '', stderr: 'Error: 429 Too Many Requests, quota exceeded' });
    assert.equal(r.outcome, 'no-verdict');
    assert.equal(r.runStatus, 'timeout');
  });
  test('#45.4: a letter or digit of any script next to the word joins it', () => {
    for (const text of ['quotaé', 'équota', 'É429', '429É', 'ÉQUOTA', 'quota²', 'Ωoverloaded', 'quota٣']) assert.equal(holds(text), false, text);
    for (const text of ['quota é', 'quotaÉxceeded', 'éQuota', '«quota»', 'quota…']) assert.equal(holds(text), true, text);
  });
  test('#45.5: 429TooManyRequests does not hold: a digit before a capital joins the words', () => {
    assert.equal(holds('429TooManyRequests'), false);
    assert.equal(holds('429 TooManyRequests'), true);
  });
  test('#45.6: 429s holds, and names 429s as the word', () => {
    assert.deepEqual(detectQuotaHold('seeing 429s from the API'), { hold: true, via: 'text', evidence: '429s' });
  });
});

describe('the merged word rule against the rules it replaces (T1-PARSE-GUARD hygiene)', () => {
  test('against the review-policy rule: only a non-ASCII letter or digit next to the word changes the outcome', () => {
    for (const text of ['équotas', 'rate limité', 'É429S', 'usage limits²', 'ÉRETRY-AFTER', 'too_many_requestsé', 'CAPACITYÉ']) assert.equal(holds(text), false, text);
    for (const text of ['insufficient_quota', 'RATE_LIMIT_EXCEEDED', 'rateLimitExceeded', 'RateLimitError', 'APIQuotaExceeded', 'QuotaExceeded', '429s', 'rate-limited', 'overloaded_error']) assert.equal(holds(text), true, text);
  });
  test('against the claude-code substring rule: a word inside a longer word, a separator other than space, hyphen or _ and an all-capitals suffix no longer hold', () => {
    for (const text of ['Quotation', 'subquota', 'HTTP429', 'E429', 'commit 1429abf', 'quotaexceeded', 'rate limitation', 'usage limitation', 'rate.limit', 'rate/limit', 'rate:limit', 'QUOTAed', 'API429Error']) assert.equal(holds(text), false, text);
  });
  test('against the claude-code substring rule: the phrases it never had and the camelCase and _ forms of usage limit now hold', () => {
    for (const text of ['overloaded_error', 'Overloaded', 'at capacity', 'too many requests', 'TooManyRequests', 'retry after 30', 'retryAfter', 'usageLimit', 'usage_limit', 'USAGE_LIMIT']) assert.equal(holds(text), true, text);
  });
});

describe('one module owns every quota matcher (T1-PARSE-GUARD acceptance 8)', () => {
  /**
   * A quota word as a matcher would write it: in a regular expression literal, in a string that carries regular expression
   * syntax (`?`, `[`, a backslash), or as the status 429 or 529.
   */
  const QUOTA_WORD = /quota|rate.{0,6}limit|usage.{0,6}limit|429|529|too.{0,6}many|overloaded|capacity|retry.{0,6}after/i;
  const REGEX_SYNTAX = /[?[\\]/;
  /** CI log classes are out of scope (card non_goals; plan finding F5): `ci-policy.ts` reads a CI log, never a provider. */
  const EXEMPT = ['core/parse-guard.ts', 'core/ci-policy.ts'];
  function matchers(file: string): string[] {
    const sf = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      const at = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
      if (ts.isRegularExpressionLiteral(node) && QUOTA_WORD.test(node.text)) found.push(`${at} ${node.text}`);
      else if (ts.isNumericLiteral(node) && (node.text === '429' || node.text === '529')) found.push(`${at} ${node.text}`);
      else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) && QUOTA_WORD.test(node.text) && REGEX_SYNTAX.test(node.text)) found.push(`${at} '${node.text}'`);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  }

  test('the scan finds the matchers of src/core/parse-guard.ts itself, so it can see one [R5]', () => {
    assert.ok(matchers('core/parse-guard.ts').length >= 2, matchers('core/parse-guard.ts').join(' | '));
  });
  test('no src/ file outside src/core/parse-guard.ts carries a quota word pattern or a quota status [R5]', () => {
    const found = SOURCES.filter((f) => !EXEMPT.includes(f)).flatMap(matchers);
    assert.deepEqual(found, [], `quota matchers outside src/core/parse-guard.ts: ${found.join(' | ')}`);
  });
  test('src/core/parse-guard.ts is at most 30 lines [R5] [R6]', () => {
    const lines = source('core/parse-guard.ts').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
    assert.ok(lines <= 30, `src/core/parse-guard.ts has ${lines} lines`);
  });
});
