import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { limitResetMs } from '../../src/core/limit-reset.ts';

const HOUR = 3_600_000;

describe('limitResetMs: the delay to the reset time a CLI limit message names (T0-CLI-LIMIT-RESET, issue 394)', () => {
  test('the next instant the named zone reads the reset time, strictly after now; 12am is midnight and 12pm noon [R1]', () => {
    // 22:56 NZDT on 20 Nov; the next 13:00 NZDT is 2026-11-21T00:00:00Z.
    assert.equal(limitResetMs('resets 1pm (Pacific/Auckland)', '2026-11-20T09:56:00.000Z'), 14 * HOUR + 4 * 60_000);
    assert.equal(limitResetMs("You've hit your Fable limit · resets 1pm (Pacific/Auckland). Switch", '2026-11-20T23:30:00.000Z'), 1_800_000);
    assert.equal(limitResetMs('RESETS 1:30PM (Pacific/Auckland)', '2026-11-20T23:30:00.000Z'), HOUR);
    assert.equal(limitResetMs('resets 12am (UTC)', '2026-11-20T23:00:00.000Z'), HOUR);
    assert.equal(limitResetMs('resets 12pm (UTC)', '2026-11-20T23:00:00.000Z'), 13 * HOUR);
    assert.equal(limitResetMs('resets 1pm (UTC)', '2026-11-20T13:00:00.000Z'), 24 * HOUR, 'at the reset instant the next day is returned');
    assert.equal(limitResetMs('resets 1pm (UTC)', '2026-11-20T12:59:59.999Z'), 1, 'one millisecond before the reset');
  });

  test('across the Pacific/Auckland daylight-saving start the offset of the reset day applies, and a time in the gap is the end of the gap [R1]', () => {
    // 2026-09-27 00:00 NZST (+12); 02:00 NZST jumps to 03:00 NZDT (+13) at 2026-09-26T14:00:00Z.
    assert.equal(limitResetMs('resets 4am (Pacific/Auckland)', '2026-09-26T12:00:00.000Z'), 3 * HOUR);
    assert.equal(limitResetMs('resets 2am (Pacific/Auckland)', '2026-09-26T12:00:00.000Z'), 2 * HOUR);
    assert.equal(limitResetMs('resets 2:30am (Pacific/Auckland)', '2026-09-26T12:00:00.000Z'), 2 * HOUR);
    assert.equal(limitResetMs('resets 1am (Pacific/Auckland)', '2026-09-26T12:00:00.000Z'), HOUR, 'before the gap the standard offset applies');
  });

  test('across the Pacific/Auckland daylight-saving end a time that occurs twice is the earliest occurrence strictly after now (F1, class skipped-fold-occurrence) [R1]', () => {
    // 2026-04-05 03:00 NZDT (+13) falls back to 02:00 NZST (+12) at 2026-04-04T14:00:00Z: 02:30 occurs at 13:30Z and 14:30Z.
    assert.equal(limitResetMs('resets 2:30am (Pacific/Auckland)', '2026-04-04T13:00:00.000Z'), 1_800_000, 'the first occurrence is ahead');
    assert.equal(limitResetMs('resets 2:30am (Pacific/Auckland)', '2026-04-04T13:45:00.000Z'), 2_700_000, 'the first occurrence has passed, the second is ahead');
    assert.equal(limitResetMs('resets 2:30am (Pacific/Auckland)', '2026-04-04T14:30:00.000Z'), 24 * HOUR, 'at the second occurrence both have passed: the next day, at the same +12');
  });

  test('a numeric offset or other non-IANA zone text reads no delay (F2, class non-iana-reset-zone) [R1] [R2]', () => {
    for (const zone of ['+05:00', '-0800', '+05', '05:00', 'UTC+5', 'GMT+05:00']) assert.equal(limitResetMs(`resets 1pm (${zone})`, '2026-11-20T00:00:00.000Z'), undefined, zone);
    assert.equal(limitResetMs('resets 1pm (Etc/GMT-5)', '2026-11-20T00:00:00.000Z'), 8 * HOUR, 'an IANA Etc zone is a zone name (UTC+5)');
  });

  test('no zone, an unknown zone, an hour or minutes out of range, a date form or no phrase reads no delay and never throws [R2]', () => {
    const now = '2026-11-20T09:56:00.000Z';
    for (const text of ['resets 1pm', 'resets 1pm (Mars/Olympus)', 'resets 13pm (UTC)', 'resets 0am (UTC)', 'resets 1:60pm (UTC)', 'resets 1:5pm (UTC)', 'resets Nov 25', 'all good', '']) {
      assert.doesNotThrow(() => limitResetMs(text, now), text);
      assert.equal(limitResetMs(text, now), undefined, text);
    }
  });
});
