import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendLesson, formatLesson, hasLesson, lessonFromText, lessonProblem, parseLessonLine, readLessons, reviewLessons, LESSON_LINE, REVIEW_LESSONS_MAX_BYTES } from '../../src/artifacts/lessons.ts';

const ENTRY = { date: '2026-09-14', ref: 'T1-LOOP-LESSONS', kind: 'NEVER' as const, rule: 'skip the lesson step at CLOSE', source: 'PR #11' };
const LINE = '- 2026-09-14 T1-LOOP-LESSONS: NEVER skip the lesson step at CLOSE (source: PR #11)';

describe('lessons artifact (T1-LOOP-LESSONS R6)', () => {
  const dirs: string[] = [];
  const dir = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'aidlc-lessons-'));
    dirs.push(d);
    return d;
  };
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('the frozen line format round-trips and rejects everything else', () => {
    assert.equal(formatLesson(ENTRY), LINE);
    assert.deepEqual(parseLessonLine(LINE), ENTRY);
    assert.ok(LESSON_LINE.test(LINE));
    for (const bad of ['- 2026-09-14 T1: MAYBE do it (source: x)', '2026-09-14 T1: NEVER do it (source: x)', '- 2026-9-14 T1: NEVER do it (source: x)', '- 2026-09-14 T1: NEVER do it', '- 2026-09-14 T1 NEVER do it (source: x)']) {
      assert.equal(parseLessonLine(bad), undefined, bad);
    }
    assert.equal(lessonProblem(ENTRY), undefined);
    assert.match(lessonProblem({ ...ENTRY, kind: 'MAYBE' as never }) ?? '', /kind/);
    assert.match(lessonProblem({ ...ENTRY, source: 'PR (#11)' }) ?? '', /parentheses/);
    assert.match(lessonProblem({ ...ENTRY, ref: 'two words' }) ?? '', /one token/);
    assert.match(lessonProblem({ ...ENTRY, date: '2026-13-40' }) ?? '', /YYYY-MM-DD/);
  });

  test('the --lesson text parses into an entry for the card and the date; malformed text throws', () => {
    assert.deepEqual(lessonFromText('NEVER skip the lesson step at CLOSE (source: PR #11)', 'T1-LOOP-LESSONS', '2026-09-14'), ENTRY);
    assert.throws(() => lessonFromText('skip the lesson step (source: PR #11)', 'T1', '2026-09-14'), /NEVER\|ALWAYS\|NOTE/);
    assert.throws(() => lessonFromText('NOTE something', 'T1', '2026-09-14'));
  });

  test('append creates the file from the embedded header when missing and never rewrites past lines', () => {
    const file = path.join(dir(), 'docs', 'LESSONS.md');
    assert.equal(appendLesson(file, ENTRY), LINE);
    const created = readFileSync(file, 'utf8');
    assert.ok(created.startsWith('# Lessons\n'));
    assert.ok(created.includes('## Lessons\n' + LINE + '\n'), created);
    const second = { ...ENTRY, kind: 'NOTE' as const, rule: 'read the file at PREPARE', source: 'spec R5' };
    appendLesson(file, second);
    const after2 = readFileSync(file, 'utf8');
    assert.ok(after2.startsWith(created), 'the earlier content is untouched');
    assert.ok(after2.endsWith(formatLesson(second) + '\n'));
    assert.deepEqual(readLessons(file), { file, count: 2, recent: [LINE, formatLesson(second)] });
    assert.throws(() => appendLesson(file, { ...ENTRY, source: '' }), /source/);
    assert.equal(readLessons(file).count, 2, 'a rejected entry writes nothing');
  });

  test('existing bytes are never rewritten: the template placeholder stays above the first lesson and is not counted', () => {
    const file = path.join(dir(), 'LESSONS.md');
    const original = '# Lessons\n\nintro\n\n## Lessons\n- (none yet)\n';
    writeFileSync(file, original, 'utf8');
    appendLesson(file, ENTRY);
    assert.equal(readFileSync(file, 'utf8'), original + LINE + '\n', 'the original bytes are a prefix of the result');
    assert.deepEqual(readLessons(file), { file, count: 1, recent: [LINE] }, 'the placeholder is not a lesson');
    const noTrailingNewline = path.join(dir(), 'LESSONS.md');
    writeFileSync(noTrailingNewline, '## Lessons\n' + LINE, 'utf8');
    appendLesson(noTrailingNewline, { ...ENTRY, rule: 'second' });
    assert.equal(readFileSync(noTrailingNewline, 'utf8'), '## Lessons\n' + LINE + '\n' + formatLesson({ ...ENTRY, rule: 'second' }) + '\n');
  });

  test('a rule is appended literally: dollar sequences and percent signs survive, and the header is written exactly once', () => {
    const file = path.join(dir(), 'docs', 'LESSONS.md');
    const odd = { ...ENTRY, rule: 'quote $& and $1 and 100% literally' };
    appendLesson(file, odd);
    appendLesson(file, { ...ENTRY, rule: 'second' });
    const text = readFileSync(file, 'utf8');
    assert.equal(text.split('\n').filter((l) => l === '# Lessons').length, 1, 'one header');
    assert.ok(text.includes('quote $& and $1 and 100% literally'), text);
    assert.equal(readLessons(file).count, 2);
    assert.equal(hasLesson(file, formatLesson(odd)), true);
    assert.equal(hasLesson(file, formatLesson({ ...ENTRY, rule: 'third' })), false);
    assert.equal(hasLesson(path.join(dir(), 'none.md'), LINE), false);
  });

  test('validation is shared by parsing, reading and writing: impossible dates, blank fields and line terminators are never lessons', () => {
    assert.match(lessonProblem({ ...ENTRY, date: '2026-02-30' }) ?? '', /calendar/);
    assert.equal(parseLessonLine('- 2026-02-30 T1: NEVER do it (source: x)'), undefined, 'an impossible date is not a lesson');
    assert.equal(parseLessonLine('- 2026-09-14 T1: NEVER    (source: x)'), undefined, 'a blank rule is not a lesson');
    assert.equal(parseLessonLine('- 2026-09-14 T1: NEVER do it (source:  )'), undefined, 'a blank source is not a lesson');
    assert.match(lessonProblem({ ...ENTRY, rule: 'two\nlines' }) ?? '', /one non-empty line/);
    assert.match(lessonProblem({ ...ENTRY, source: 'a\u2028b' }) ?? '', /one non-empty line/);
    assert.throws(() => lessonFromText('NEVER    (source: x)', 'T1', '2026-09-14'));
    assert.throws(() => appendLesson(path.join(dir(), 'x.md'), { ...ENTRY, date: '2026-02-30' }), /calendar/);
    const file = path.join(dir(), 'LESSONS.md');
    writeFileSync(file, '## Lessons\n- 2026-02-30 T1: NEVER impossible (source: x)\n- 2026-09-14 T1: NEVER    (source: x)\n' + LINE + '\n', 'utf8');
    assert.deepEqual(readLessons(file), { file, count: 1, recent: [LINE] }, 'malformed lines are neither counted nor recent');
  });

  test('a concurrent creator that has not written yet loses nothing: every write is an append', () => {
    const file = path.join(dir(), 'LESSONS.md');
    closeSync(openSync(file, 'wx')); // another closer created the file and has not written its header yet
    appendLesson(file, ENTRY);
    appendLesson(file, { ...ENTRY, rule: 'second' });
    const text = readFileSync(file, 'utf8');
    assert.ok(text.startsWith(LINE + '\n'), text);
    assert.equal(readLessons(file).count, 2, 'both lines survive');
  });

  test('reading a missing file is an empty context; recent is capped', () => {
    const file = path.join(dir(), 'missing.md');
    assert.deepEqual(readLessons(file), { file, count: 0, recent: [] });
    assert.equal(existsSync(file), false, 'reading never creates the file');
    const many = path.join(dir(), 'many.md');
    mkdirSync(path.dirname(many), { recursive: true });
    writeFileSync(many, '## Lessons\n' + [1, 2, 3, 4, 5, 6, 7].map((n) => formatLesson({ ...ENTRY, rule: `rule ${n}` })).join('\n') + '\n', 'utf8');
    const ctx = readLessons(many, 3);
    assert.equal(ctx.count, 7);
    assert.deepEqual(ctx.recent.map((l) => parseLessonLine(l)?.rule), ['rule 5', 'rule 6', 'rule 7']);
  });

  test('T1-REVIEW-INVARIANTS: reviewLessons carries the NEVER and ALWAYS rules newest first, no NOTE line, stops at the byte cap and counts what it left out', () => {
    const file = path.join(dir(), 'docs', 'LESSONS.md');
    const never = { ...ENTRY, rule: 'skip the lesson step at CLOSE' };
    const always = { ...ENTRY, date: '2026-09-15', ref: 'T0-SHIP-BASE-SYNC-2', kind: 'ALWAYS' as const, rule: 'encode every failure detail once at the failure helper', source: 'PR #18' };
    const note = { ...ENTRY, date: '2026-09-16', ref: 'T1-LOOP-RESUME', kind: 'NOTE' as const, rule: 'amend the card on main before the next round', source: 'PR #13' };
    for (const entry of [never, always, note]) appendLesson(file, entry);
    assert.deepEqual(reviewLessons(file), { lines: [formatLesson(always), formatLesson(never)], omitted: 0 }, 'newest first, and a NOTE line is not an invariant');
    const newest = formatLesson(always);
    assert.deepEqual(reviewLessons(file, Buffer.byteLength(newest, 'utf8') + 1), { lines: [newest], omitted: 1 }, 'the cap keeps the newest rules and counts the rest as omitted');
    assert.deepEqual(reviewLessons(file, 1), { lines: [], omitted: 2 }, 'a cap below the newest line leaves every rule out');
    assert.deepEqual(reviewLessons(path.join(dir(), 'missing.md')), { lines: [], omitted: 0 }, 'an absent file carries no invariants');
    assert.ok(REVIEW_LESSONS_MAX_BYTES >= 1000, 'the default cap holds several rules');
  });
});

const CARD = ['---', 'id: T0-LESSON', 'title: a card that closes with a lesson', 'status: todo', 'branch: T0-LESSON', 'worktree: wt/T0-LESSON', 'allow_paths:', '  - src/x.ts', 'dod_command: node -e 0', 'dod_exit: 0', 'acceptance:', '  - 1. x. [dod arm 1]', 'plan_ref: plans/x.md#1', 'budget: 10', 'tdd: false', '---', '', '# T0-LESSON', ''].join('\n');

describe('aidlc card close --lesson / --skip-lesson / --all through the CLI (T1-LOOP-LESSONS R6)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const bin = path.join(root, 'bin', 'aidlc.js');
  const repos: string[] = [];
  after(() => {
    for (const d of repos) rmSync(d, { recursive: true, force: true });
  });

  /** A temp repository on the dry-run ship path with one card driven to CLOSE through the CLI. */
  function repoAtClose() {
    const tmp = mkdtempSync(path.join(tmpdir(), 'aidlc-lessons-cli-'));
    repos.push(tmp);
    mkdirSync(path.join(tmp, 'specs', 'tasks'), { recursive: true });
    writeFileSync(path.join(tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', cardsDir: 'specs/tasks', worktreeRoot: path.join(tmp, 'wt') }));
    writeFileSync(path.join(tmp, 'specs', 'tasks', 'T0-LESSON.md'), CARD);
    const env = { ...process.env, AIDLC_STATE_DIR: path.join(tmp, 'state') };
    const cli = (...args: string[]) => {
      const r = spawnSync(process.execPath, [bin, ...args, '--json'], { cwd: tmp, env, encoding: 'utf8', timeout: 60_000 });
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
      return JSON.parse(r.stdout) as Record<string, any>;
    };
    const created = cli('goal', 'new', 'implement T0-LESSON', '--card', 'T0-LESSON');
    const goal = typeof created['goal'] === 'string' ? (created['goal'] as string) : (created['goal']?.id as string);
    for (let i = 0; i < 4; i += 1) {
      const d = cli('next', '--goal', goal)['directive'] ?? cli('next', '--goal', goal);
      const kind = String(d['kind']);
      if (kind === 'run-card') break;
      if (kind === 'plan') cli('report', '--goal', goal, '--result', 'plan-produced', '--plan-ref', 'plans/x.md');
      else if (kind.startsWith('cards') || kind.startsWith('project')) cli('report', '--goal', goal, '--result', 'cards-projected', '--cards', 'T0-LESSON');
      else assert.fail(`unexpected goal directive ${kind}: ${String(d['narration'])}`);
    }
    assert.equal(cli('card', 'next', 'T0-LESSON', '--goal', goal)['directive']['kind'], 'prepare');
    assert.equal(cli('card', 'next', 'T0-LESSON', '--goal', goal)['directive']['kind'], 'build');
    cli('card', 'attempt', 'T0-LESSON', '--goal', goal, '--outcome', 'success', '--dod-receipt', 'dod:cli', '--candidate-sha', 'sha-cli');
    const close = cli('card', 'next', 'T0-LESSON', '--goal', goal)['directive'];
    assert.equal(close['kind'], 'close', String(close['narration']));
    assert.deepEqual(close['missing'], ['metadata', 'docSync', 'findings', 'evidence', 'cleanup', 'lessons']);
    return { tmp, goal, cli };
  }

  test('--all leaves the lesson step open, the close hint names --lesson and --skip-lesson, and --lesson appends one line before DONE', () => {
    const { tmp, goal, cli } = repoAtClose();
    const all = cli('card', 'close', 'T0-LESSON', '--goal', goal, '--all');
    assert.equal(all['lessons'], false, '--all never records the lesson disposition');
    const still = cli('card', 'next', 'T0-LESSON', '--goal', goal)['directive'];
    assert.equal(still['kind'], 'close');
    assert.deepEqual(still['missing'], ['lessons']);
    assert.ok(String(still['narration']).includes('--lesson "'), String(still['narration']));
    assert.ok(String(still['narration']).includes('--skip-lesson'), String(still['narration']));
    assert.ok(!String(still['narration']).includes('--lessons'), 'no invented flag');
    const recorded = cli('card', 'close', 'T0-LESSON', '--goal', goal, '--lesson', 'NEVER close a card without its lesson step (source: T1-LOOP-LESSONS R6)');
    assert.equal(recorded['lessons'], true);
    const file = readFileSync(path.join(tmp, 'docs', 'LESSONS.md'), 'utf8');
    assert.ok(file.startsWith('# Lessons'), 'the file is created from the header');
    assert.equal(file.split('\n').filter((l) => LESSON_LINE.test(l)).length, 1);
    assert.ok(file.includes('T0-LESSON: NEVER close a card without its lesson step (source: T1-LOOP-LESSONS R6)'), file);
    assert.equal(cli('card', 'next', 'T0-LESSON', '--goal', goal)['directive']['kind'], 'done');
  });

  test('--skip-lesson records the reason and closes the step without touching the file; malformed --lesson text is refused', () => {
    const { tmp, goal, cli } = repoAtClose();
    cli('card', 'close', 'T0-LESSON', '--goal', goal, '--all');
    const bad = spawnSync(process.execPath, [bin, 'card', 'close', 'T0-LESSON', '--goal', goal, '--lesson', 'do it later', '--json'], { cwd: tmp, env: { ...process.env, AIDLC_STATE_DIR: path.join(tmp, 'state') }, encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(bad.status, 0, 'malformed lesson text is refused');
    assert.ok(!existsSync(path.join(tmp, 'docs', 'LESSONS.md')), 'nothing is written for a refused lesson');
    const skipped = cli('card', 'close', 'T0-LESSON', '--goal', goal, '--skip-lesson', 'the reviews taught no new rule');
    assert.equal(skipped['lessons'], true);
    assert.ok(!existsSync(path.join(tmp, 'docs', 'LESSONS.md')), 'a skip writes no file');
    assert.equal(cli('card', 'next', 'T0-LESSON', '--goal', goal)['directive']['kind'], 'done');
  });
});
