import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { finalizeReview } from '../../src/review/pre-review.ts';
import { tmpDir } from '../infra/helpers.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
/** The stdout of the Claude CLI at its Fable limit, exit code 1 (issue 385). */
const STDOUT = "You've hit your Fable limit · resets 1pm (Pacific/Auckland). Switch to another model, or manage usage credits at https://claude.ai/settings/usage?from=cc_cli_limit_message, to continue.\n";
/** 22:56 NZDT; the next 13:00 NZDT is 2026-11-21T00:00:00Z, 14 h 4 min later. */
const FINISHED = '2026-11-20T09:56:00.000Z';

function finalize(stdout: string, exitCode: number) {
  const dir = tmpDir('aidlc-limit-reset-');
  try {
    const receipt = { command: 'claude', args: [], cwd: dir, exitCode, signal: null, timedOut: false, stdout, stderr: '', startedAt: '2026-11-20T09:50:00.000Z', finishedAt: FINISHED, durationMs: 360_000, outputSha256: createHash('sha256').update(stdout).digest('hex') };
    const fin = finalizeReview(receipt, { reviewDir: dir, fileStem: 'r3', head: 'sha-1', reviewer: 'claude-opus' });
    return { outcome: fin.outcome, retryAfterMs: fin.retryAfterMs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a review held on the Claude CLI limit message waits until its reset time (T0-CLI-LIMIT-RESET, issue 394)', () => {
  test('finalizeReview reads the reset time against the receipt finishedAt; a retry-after delay keeps precedence; no reset phrase or no hold reads no delay [R3]', () => {
    assert.deepEqual(finalize(STDOUT, 1), { outcome: 'quota-hold', retryAfterMs: 50_640_000 });
    assert.deepEqual(finalize(`${STDOUT}retry after 30 seconds\n`, 1), { outcome: 'quota-hold', retryAfterMs: 30_000 });
    assert.deepEqual(finalize('Error: quota exceeded\n', 1), { outcome: 'quota-hold', retryAfterMs: undefined });
    const answered = finalize(STDOUT, 0);
    assert.notEqual(answered.outcome, 'quota-hold');
    assert.equal(answered.retryAfterMs, undefined);
  });

  test('docs/OPERATIONS.md names the reset form and issue 394 and no longer says the reset time is not read; docs/ARCHITECTURE.md names limit-reset.ts [R4]', () => {
    const ops = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    const paragraph = ops.split(/\r?\n/).find((line) => line.includes('hit your <name> limit')) ?? '';
    assert.match(paragraph, /`resets <time> \(<zone>\)`/);
    assert.match(paragraph, /issue 394/);
    assert.doesNotMatch(paragraph, /reset time in that message is not read/);
    assert.match(readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8'), /limit-reset\.ts/);
  });
});

describe('the reset zone is read only for a full tzdata 2026a zone or link name (T0-LIMIT-RESET-IANA-NAMES, issue 398)', () => {
  test('docs/OPERATIONS.md names tzdata 2026a, US/Pacific-New and issue 398 in the paragraph of the reset form; docs/ARCHITECTURE.md names iana-zones.ts [R3]', () => {
    const ops = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    const paragraph = ops.split(/\r?\n/).find((line) => line.includes('`resets <time> (<zone>)`')) ?? '';
    assert.match(paragraph, /tzdata 2026a/);
    assert.match(paragraph, /`US\/Pacific-New`/);
    assert.match(paragraph, /issue 398/);
    assert.match(readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8'), /`iana-zones\.ts`/);
  });
});
