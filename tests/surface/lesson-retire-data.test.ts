import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lessonRetirements } from '../../src/artifacts/lessons.ts';

// T0-LESSON-RETIRE-DATA: the five lessons that later lessons name as superseded or replaced are retired in this checkout.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R2_TEXT = ' T0-LESSON-RETIRE-DATA: ALWAYS treat `aidlc card next` at SHIP as the action that pushes, opens the PR, waits for CI and merges after R3 passes; this supersedes the 2026-11-25 T0-BENCH-INPUTS ALWAYS lesson, whose advice to retain the command\'s whole output did not preserve the refused merge\'s failure text (source: PR 482, issue 489)';

test('T0-LESSON-RETIRE-DATA acceptance 2: docs/LESSONS-RETIRED.md retires lines 30, 32, 33, 194 and 247 by their named replacements with no problem [R2] [R3]', () => {
  const retiredFile = path.join(ROOT, 'docs', 'LESSONS-RETIRED.md');
  assert.ok(existsSync(retiredFile), 'docs/LESSONS-RETIRED.md exists');
  const lessons = readFileSync(path.join(ROOT, 'docs', 'LESSONS.md'), 'utf8');
  const lines = lessons.split(/\r?\n/);
  const r2 = lines.filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l) && l.slice('- 0000-00-00'.length) === R2_TEXT).map((l) => lines.indexOf(l) + 1);
  assert.equal(r2.length, 1, 'docs/LESSONS.md holds the R2 line once');
  const result = lessonRetirements(lessons, readFileSync(retiredFile, 'utf8'));
  assert.deepEqual(result.problems, []);
  const entries = result.entries.map((e) => ({ old: e.old, by: e.by }));
  for (const expected of [{ old: [30], by: 105 }, { old: [32], by: 239 }, { old: [33], by: 109 }, { old: [194], by: 225 }, { old: [247], by: r2[0] }]) {
    assert.ok(entries.some((e) => JSON.stringify(e) === JSON.stringify(expected)), `an entry retires line ${expected.old[0]} by line ${expected.by}`);
  }
});
