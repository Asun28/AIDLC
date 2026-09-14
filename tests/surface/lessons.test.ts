import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendLesson, formatLesson, lessonFromText, lessonProblem, parseLessonLine, readLessons, LESSON_LINE } from '../../src/artifacts/lessons.ts';

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

  test('the template placeholder gives way to the first lesson; a file with lessons keeps every line', () => {
    const file = path.join(dir(), 'LESSONS.md');
    writeFileSync(file, '# Lessons\n\nintro\n\n## Lessons\n- (none yet)\n', 'utf8');
    appendLesson(file, ENTRY);
    assert.equal(readFileSync(file, 'utf8'), '# Lessons\n\nintro\n\n## Lessons\n' + LINE + '\n');
    const noTrailingNewline = path.join(dir(), 'LESSONS.md');
    writeFileSync(noTrailingNewline, '## Lessons\n' + LINE, 'utf8');
    appendLesson(noTrailingNewline, { ...ENTRY, rule: 'second' });
    assert.equal(readFileSync(noTrailingNewline, 'utf8'), '## Lessons\n' + LINE + '\n' + formatLesson({ ...ENTRY, rule: 'second' }) + '\n');
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
});
