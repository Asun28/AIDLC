import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lessonTerms, matchedLessons, reviewLessons, type ReviewLessons } from '../../src/artifacts/lessons.ts';
import { loadCardRegistry, renderCard } from '../../src/artifacts/card.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { runSync, type ExecReceipt } from '../../src/probes/exec.ts';
import { buildReviewPrompt, type PriorFinding } from '../../src/review/pre-review.ts';

const rule = (day: number, ref: string, text: string, kind = 'ALWAYS') => `- 2026-01-${String(day).padStart(2, '0')} ${ref}: ${kind} ${text} (source: PR ${day})`;

function withFile(lines: string[], body: (file: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-match-'));
  try {
    const file = path.join(dir, 'LESSONS.md');
    writeFileSync(file, `# Lessons\n\n${lines.join('\n')}\n`);
    body(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const refs = (r: ReviewLessons) => r.lines.map((l) => /^- \S+ (\S+):/.exec(l)?.[1]);

test('T1-LESSON-MATCH acceptance 1: a path match and a term match outrank a newer rule matching nothing, and more matches score higher [R1] [R2]', () => {
  const lines = [rule(1, 'T1-PATH', 'keep the ledger whole'), rule(2, 'T1-TERM', 'guard every `pinCandidate` call'), rule(3, 'T1-NONE', 'read the card once')];
  withFile(lines, (file) => {
    const input = { changedPaths: ['src/a.ts', 'src/b.ts'], diff: '+pinCandidate(cwd, sha)\n', history: [{ subject: 'feat: [T1-PATH] (#1)', files: ['src/a.ts', 'src/b.ts'] }] };
    const got = matchedLessons(file, input);
    // Three rules, each key held by one: idf = ln(1 + 3 / 1) = ln 4. T1-PATH scores 2 ln 4, T1-TERM ln 4, T1-NONE 0.
    assert.deepEqual(refs(got), ['T1-PATH', 'T1-TERM', 'T1-NONE']);
    assert.equal(got.matched, true);
    assert.equal(got.omitted, 0);
  });
});

test('T1-LESSON-MATCH acceptance 1: idf weighs a key by how few rules hold it [R2]', () => {
  const lines = [rule(1, 'T1-RARE', 'guard every `pinCandidate` call'), rule(2, 'T1-COMMON-A', 'guard every `update-ref` call'), rule(3, 'T1-COMMON-B', 'name the `update-ref` target')];
  withFile(lines, (file) => {
    // `pinCandidate` is in one rule of three, ln 4; `update-ref` in two, ln 2.5. So the older rare rule leads.
    assert.deepEqual(refs(matchedLessons(file, { changedPaths: [], diff: '+pinCandidate update-ref\n', history: [] })), ['T1-RARE', 'T1-COMMON-B', 'T1-COMMON-A']);
  });
});

test('T1-LESSON-MATCH acceptance 1: equal scores keep newest first and a NOTE line is never returned [R1] [R2]', () => {
  const lines = [rule(1, 'T1-OLD', 'guard every `pinCandidate` call'), rule(2, 'T1-NOTE', 'a process note on `pinCandidate`', 'NOTE'), rule(3, 'T1-NEW', 'count each `pinCandidate` result')];
  withFile(lines, (file) => {
    assert.deepEqual(refs(matchedLessons(file, { changedPaths: [], diff: 'pinCandidate', history: [] })), ['T1-NEW', 'T1-OLD']);
  });
});

test('T1-LESSON-MATCH acceptance 2: the cap stops at the first rule that does not fit and counts the rest [R1]', () => {
  const best = rule(1, 'T1-BEST', 'guard every `pinCandidate` call');
  const lines = [best, rule(2, 'T1-SHORT', 'read it'), rule(3, 'T1-TOO-LONG', `read ${'x'.repeat(400)}`)];
  withFile(lines, (file) => {
    const size = Buffer.byteLength(best, 'utf8') + 1;
    assert.deepEqual(matchedLessons(file, { changedPaths: [], diff: 'pinCandidate', history: [] }, size + 100), { lines: [best], omitted: 2, matched: true });
    assert.deepEqual(matchedLessons(file, { changedPaths: [], diff: 'pinCandidate', history: [] }, size - 1), { lines: [], omitted: 3, matched: true });
  });
});

test('T1-LESSON-MATCH acceptance 2: with every score 0 the lines and the count equal those of reviewLessons [R1]', () => {
  const lines = Array.from({ length: 12 }, (_, i) => rule(i + 1, `T1-R${i + 1}`, `keep rule number ${i + 1} ${'y'.repeat(300)}`));
  withFile(lines, (file) => {
    const { matched, ...selected } = matchedLessons(file, { changedPaths: [], diff: 'nothing here', history: [] });
    assert.equal(matched, true);
    assert.ok(selected.omitted > 0, 'the fixture is over the cap');
    assert.deepEqual(selected, reviewLessons(file));
  });
});

test('T1-LESSON-MATCH acceptance 2: an absent file carries no rules [R1]', () => {
  assert.deepEqual(matchedLessons(path.join(tmpdir(), 'aidlc-no-such-lessons.md'), { changedPaths: [], diff: '', history: [] }), { lines: [], omitted: 0, matched: true });
});

test('T1-LESSON-MATCH acceptance 3: terms are backticked spans and words with an inner capital, underscore, dot or dash [R3]', () => {
  assert.deepEqual(lessonTerms('Always run `git add -A` before pinCandidate, then update-ref and gc.pruneExpire and MAX_R3 in review'), ['git add -A', 'pinCandidate', 'update-ref', 'gc.pruneExpire', 'MAX_R3']);
  assert.deepEqual(lessonTerms('Always review the plain words.'), []);
  assert.deepEqual(lessonTerms('use `a` and `a` twice'), ['a'], 'a term counts once');
});

test('T1-LESSON-MATCH acceptance 3: a term matches the diff case-sensitively [R3]', () => {
  const lines = [rule(1, 'T1-CASE', 'guard every `pinCandidate` call'), rule(2, 'T1-LATER', 'read the card')];
  withFile(lines, (file) => {
    assert.deepEqual(refs(matchedLessons(file, { changedPaths: [], diff: 'PINCANDIDATE pincandidate', history: [] })), ['T1-LATER', 'T1-CASE']);
    assert.deepEqual(refs(matchedLessons(file, { changedPaths: [], diff: 'pinCandidate', history: [] })), ['T1-CASE', 'T1-LATER']);
  });
});

function repo(body: (root: string, git: (...args: string[]) => string) => void): void {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-match-git-')));
  const git = (...args: string[]): string => {
    const r = runSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root });
    assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  try {
    git('init', '-q', '-b', 'main');
    body(root, git);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const put = (root: string, ...files: string[]) => {
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${file}\n`);
  }
};

test('T1-LESSON-MATCH acceptance 4: commitFiles lists first-parent commits and drops the left-out paths [R4]', () => {
  repo((root, git) => {
    const left = ['CHANGELOG.md', 'docs/a.md', 'specs/tasks/T1-X.md', 'plans/a.md', 'intent/a.md', 'evals/a.json'];
    put(root, 'src/x.ts', 'tests/x.test.ts', ...left);
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: [T1-X] (#1)');
    git('checkout', '-q', '-b', 'side');
    put(root, 'src/side.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: [T1-SIDE] (#2)');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    assert.deepEqual(new GitProbe().commitFiles(root, 'main'), [{ subject: 'merge side', files: ['src/side.ts'] }, { subject: 'feat: [T1-X] (#1)', files: ['src/x.ts', 'tests/x.test.ts'] }], 'the merge names the side file; the side commit is not listed');
  });
});

test('T1-LESSON-MATCH acceptance 4: a non-ASCII path is listed as the candidate diff lists it [R4]', () => {
  repo((root, git) => {
    put(root, 'src/é.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: [T1-X] (#1)');
    assert.deepEqual(new GitProbe().commitFiles(root, 'main'), [{ subject: 'feat: [T1-X] (#1)', files: ['src/é.ts'] }]);
  });
});

test('T1-LESSON-MATCH acceptance 4: a failed git call returns an empty list and never throws [R4]', () => {
  repo((root, git) => {
    put(root, 'src/x.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    assert.deepEqual(new GitProbe().commitFiles(root, 'no-such-ref'), []);
  });
  assert.deepEqual(
    new GitProbe(() => {
      throw new Error('spawn failed');
    }).commitFiles('.', 'main'),
    [],
  );
  const failed = { command: ['git'], cwd: '.', exitCode: 128, stdout: '\x01partial\nsrc/x.ts\n', stderr: 'fatal', durationMs: 1, stdoutSha256: '', stderrSha256: '' } as unknown as ExecReceipt;
  assert.deepEqual(new GitProbe(() => failed).commitFiles('.', 'main'), [], 'output of a failed call is not read');
});

test('T1-LESSON-MATCH acceptance 4: a rule takes the files of commits naming its card as a whole token [R4]', () => {
  repo((root, git) => {
    put(root, 'src/x.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: [T1-X] (#1)');
    put(root, 'src/y.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: [T1-X-2] (#2)');
    const history = new GitProbe().commitFiles(root, 'main');
    withFile([rule(1, 'T1-X', 'keep the ledger whole'), rule(2, 'T1-LATER', 'read the card')], (file) => {
      assert.deepEqual(refs(matchedLessons(file, { changedPaths: ['src/x.ts'], diff: '', history })), ['T1-X', 'T1-LATER'], 'its own file scores');
      assert.deepEqual(refs(matchedLessons(file, { changedPaths: ['src/y.ts'], diff: '', history })), ['T1-LATER', 'T1-X'], 'a file of T1-X-2 does not');
    });
  });
});

test('T1-LESSON-MATCH acceptance 5: the prompt names what a matched section left out, and the newest sentence is unchanged [R5]', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-match-card-'));
  try {
    const cards = path.join(dir, 'specs', 'tasks');
    mkdirSync(cards, { recursive: true });
    writeFileSync(path.join(cards, 'T1-GATE.md'), renderCard({ id: 'T1-GATE', title: 'gate the ship', deliverable: 'a gate', allowPaths: ['src/gate.ts'], dodCommand: 'node --test tests/gate.test.ts', acceptance: ['1. the gate holds [dod arm 1]'] }));
    const card = loadCardRegistry(cards).cards[0]!.card;
    const input = { stage: 'formal' as const, includeDiff: true, reviewPolicy: 'policy', card, base: 'main@abc', head: 'def456', changedPaths: ['src/gate.ts'], diff: '+x\n', priorFindings: [] as PriorFinding[], round: 1, maxRounds: 2 };
    const line = rule(1, 'T1-A', 'read the card');
    assert.ok(buildReviewPrompt({ ...input, lessons: { lines: [line], omitted: 4, matched: true } }).includes('\n- 4 other lessons omitted at the byte cap; the rules that best match this diff are above.\n'));
    assert.ok(buildReviewPrompt({ ...input, lessons: { lines: [line], omitted: 4 } }).includes('\n- 4 older lessons omitted at the byte cap; the newest rules are above.\n'));
    assert.ok(buildReviewPrompt({ ...input, lessons: { lines: [], omitted: 4, matched: true } }).includes('\n- 4 other lessons omitted at the byte cap (not even the best match fits it).\n'));
    assert.ok(buildReviewPrompt({ ...input, lessons: { lines: [], omitted: 4 } }).includes('\n- 4 older lessons omitted at the byte cap (not even the newest rule fits it).\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
