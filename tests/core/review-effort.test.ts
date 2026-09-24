import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { countDiffLines, selectReviewEffort, selectReviewEffortFromDiff } from '../../src/core/review-effort.ts';
import * as effortModule from '../../src/core/review-effort.ts';
import { pathAllowed } from '../../src/review/pre-review.ts';
import type { ReviewEffortPolicy } from '../../src/core/types.ts';

/** This repository's policy: medium, high from 500 changed lines or a change under core, coordination or state. */
const POLICY: ReviewEffortPolicy = { default: 'medium', high: { minChangedLines: 500, paths: ['src/core/**', 'src/coordination/**', 'src/state/**'] } };

describe('selectReviewEffort (T1-OPUS55-R3 acceptance 1)', () => {
  test('no policy selects medium, whatever the candidate [R2]', () => {
    assert.equal(selectReviewEffort(undefined, { changedLines: 10_000, changedPaths: ['src/core/types.ts'] }, pathAllowed), 'medium');
  });

  test('below the threshold with no path matching, the policy default is selected [R2]', () => {
    assert.equal(selectReviewEffort(POLICY, { changedLines: 499, changedPaths: ['src/loop/card-runner.ts', 'docs/OPERATIONS.md'] }, pathAllowed), 'medium');
  });

  test('changed lines equal to the threshold select high [R2]', () => {
    assert.equal(selectReviewEffort(POLICY, { changedLines: 500, changedPaths: ['src/loop/card-runner.ts'] }, pathAllowed), 'high');
  });

  test('changed lines above the threshold select high [R2]', () => {
    assert.equal(selectReviewEffort(POLICY, { changedLines: 1200, changedPaths: ['docs/OPERATIONS.md'] }, pathAllowed), 'high');
  });

  test('one changed path matching a high.paths glob selects high at any size [R2]', () => {
    assert.equal(selectReviewEffort(POLICY, { changedLines: 1, changedPaths: ['docs/OPERATIONS.md', 'src/coordination/leases.ts'] }, pathAllowed), 'high');
  });

  test('a policy without high selects its default at any size [R1] [R2]', () => {
    assert.equal(selectReviewEffort({ default: 'max' }, { changedLines: 100_000, changedPaths: ['src/core/types.ts'] }, pathAllowed), 'max');
  });
});

/**
 * A pinned `--text` diff: a hunk with a deleted line reading `---y` and an added line reading `+++x` (content starting with
 * `--` and `++`) and a missing final newline; a pure rename with no hunk; a file git treats as binary shown as text.
 * Changed lines by hand: 4 in src/a.ts (-old, ---y, +new, +++x), 0 in the rename, 3 in assets/logo.bin.
 */
const PINNED_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' keep',
  '-old',
  '---y',
  '+new',
  '+++x',
  '\\ No newline at end of file',
  'diff --git a/docs/old.md b/docs/new.md',
  'similarity index 100%',
  'rename from docs/old.md',
  'rename to docs/new.md',
  'diff --git a/assets/logo.bin b/assets/logo.bin',
  'index 3333333..4444444 100644',
  '--- a/assets/logo.bin',
  '+++ b/assets/logo.bin',
  '@@ -1 +1,2 @@',
  '-a\u0000b',
  '+a\u0000c',
  '+d',
  '',
].join('\n');

describe('countDiffLines (T1-OPUS55-R3 acceptance 3, R3 decision 1)', () => {
  test('counts the added and deleted hunk lines of the diff the reviewer receives, never the headers [R2]', () => {
    assert.equal(countDiffLines(PINNED_DIFF), 7);
  });

  test('a rename with no hunk counts no line [R2]', () => {
    assert.equal(countDiffLines('diff --git a/docs/old.md b/docs/new.md\nsimilarity index 100%\nrename from docs/old.md\nrename to docs/new.md\n'), 0);
  });

  test('a file git treats as binary, shown as text, counts its hunk lines [R2]', () => {
    assert.equal(countDiffLines('diff --git a/assets/logo.bin b/assets/logo.bin\n--- a/assets/logo.bin\n+++ b/assets/logo.bin\n@@ -1 +1,2 @@\n-a\u0000b\n+a\u0000c\n+d\n'), 3);
  });
});

describe('selectReviewEffortFromDiff (T1-OPUS55-R3-2 acceptance 7 and 9)', () => {
  /** The diff of one changed line as `git diff` writes it under `color.ui=always`: every line starts with an SGR escape. */
  const COLOURED_DIFF = '\u001b[1mdiff --git a/src/loop/x.ts b/src/loop/x.ts\u001b[m\n\u001b[1m--- a/src/loop/x.ts\u001b[m\n\u001b[1m+++ b/src/loop/x.ts\u001b[m\n\u001b[36m@@ -1 +1 @@\u001b[m\n\u001b[31m-a\u001b[m\n\u001b[32m+b\u001b[m\n';

  test('a non-empty diff with no diff --git section (a coloured one) selects high, never a count of zero [R5]', () => {
    assert.equal(selectReviewEffortFromDiff(POLICY, COLOURED_DIFF, ['src/loop/x.ts'], pathAllowed), 'high');
  });

  test('the fail-closed level never lowers a higher default: xhigh and max are kept on a coloured diff [R5]', () => {
    assert.equal(selectReviewEffortFromDiff({ default: 'xhigh' }, COLOURED_DIFF, ['src/loop/x.ts'], pathAllowed), 'xhigh');
    assert.equal(selectReviewEffortFromDiff({ default: 'max' }, COLOURED_DIFF, ['src/loop/x.ts'], pathAllowed), 'max');
  });

  test('a small undecorated diff below the threshold keeps the default [R2]', () => {
    assert.equal(selectReviewEffortFromDiff(POLICY, 'diff --git a/src/loop/x.ts b/src/loop/x.ts\n--- a/src/loop/x.ts\n+++ b/src/loop/x.ts\n@@ -1 +1 @@\n-a\n+b\n', ['src/loop/x.ts'], pathAllowed), 'medium');
  });

  test('a rename out of src/core under the threshold selects high: the changed paths name the source [R6]', () => {
    const renamed = 'diff --git a/src/core/old.ts b/src/loop/new.ts\nsimilarity index 90%\nrename from src/core/old.ts\nrename to src/loop/new.ts\n@@ -1 +1 @@\n-a\n+b\n';
    assert.equal(selectReviewEffortFromDiff(POLICY, renamed, ['src/core/old.ts', 'src/loop/new.ts'], pathAllowed), 'high');
  });
});

describe('the path rule reads the changed-path list alone (T1-RENAME-PATHS acceptance 3)', () => {
  test('a small candidate renaming a non-ASCII file out of src/core/*.ts selects high through its unquoted source [R3]', () => {
    const quoted = 'diff --git "a/src/core/\\303\\251.ts" "b/src/loop/\\303\\251.ts"\nsimilarity index 100%\nrename from "src/core/\\303\\251.ts"\nrename to "src/loop/\\303\\251.ts"\n';
    const single: ReviewEffortPolicy = { default: 'medium', high: { minChangedLines: 500, paths: ['src/core/*.ts'] } };
    assert.equal(selectReviewEffortFromDiff(single, quoted, ['src/core/é.ts', 'src/loop/é.ts'], pathAllowed), 'high');
  });

  test('a rename from line the changed paths do not carry selects nothing: the default is kept [R3]', () => {
    const renamed = 'diff --git a/src/core/old.ts b/src/loop/new.ts\nsimilarity index 100%\nrename from src/core/old.ts\nrename to src/loop/new.ts\n';
    assert.equal(selectReviewEffortFromDiff(POLICY, renamed, ['src/loop/new.ts'], pathAllowed), 'medium');
  });

  test('renameSources is removed [R3]', () => {
    assert.equal('renameSources' in effortModule, false);
  });

  test('a hunk line with a high path at column 12 selects nothing: a small docs edit keeps the default [R6]', () => {
    const docs = 'diff --git a/docs/x.md b/docs/x.md\n--- a/docs/x.md\n+++ b/docs/x.md\n@@ -1 +1 @@\n-old\n+' + ' '.repeat(11) + 'src/core/x.ts\n';
    assert.equal(selectReviewEffortFromDiff(POLICY, docs, ['docs/x.md'], pathAllowed), 'medium');
  });
});

describe('selectReviewEffortFromDiff matches the changed paths (T1-OPUS55-R3-3 acceptance 11)', () => {
  test('a two-line plain edit of src/core/x.ts selects high through its changed path [R2]', () => {
    const edited = 'diff --git a/src/core/x.ts b/src/core/x.ts\n--- a/src/core/x.ts\n+++ b/src/core/x.ts\n@@ -1 +1 @@\n-a\n+b\n';
    assert.equal(selectReviewEffortFromDiff(POLICY, edited, ['src/core/x.ts'], pathAllowed), 'high');
  });

  test('a rename into src/core selects high through its destination, the changed path [R6]', () => {
    const renamed = 'diff --git a/src/loop/a.ts b/src/core/a.ts\nsimilarity index 100%\nrename from src/loop/a.ts\nrename to src/core/a.ts\n';
    assert.equal(selectReviewEffortFromDiff(POLICY, renamed, ['src/core/a.ts'], pathAllowed), 'high');
  });
});

describe('selectReviewEffortFromDiff fail-closed scope (T1-OPUS55-R3-3 acceptance 12)', () => {
  test('an empty diff is not a decorated one: the default is kept [R5]', () => {
    assert.equal(selectReviewEffortFromDiff(POLICY, '', ['src/loop/x.ts'], pathAllowed), 'medium');
  });
});

describe('review-effort survivors of the wider mutation sweep (T1-OPUS55-R3-3 acceptance 12)', () => {
  test('a diff of blank lines only is empty, not decorated: the default is kept [R5]', () => {
    assert.equal(selectReviewEffortFromDiff(POLICY, '\n  \n', ['src/loop/x.ts'], pathAllowed), 'medium');
  });
});
