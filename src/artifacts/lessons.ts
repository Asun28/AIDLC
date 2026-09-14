/**
 * Lessons (`docs/LESSONS.md`): the frozen line format, an append-only writer and the reader
 * PREPARE uses. One dated line per lesson, written at CLOSE only when a review block or an
 * incident taught a rule the playbook did not state. Existing bytes are never rewritten: the
 * file is created by one exclusive append of the embedded header and the first line, and every
 * lesson is one literal appended line. The `- (none yet)` placeholder of a fresh file is not a lesson; it stays.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const LESSONS_FILE = 'docs/LESSONS.md';
/** The repository copy PREPARE reads and CLOSE appends to. */
export function lessonsPath(mainRoot: string): string {
  return path.join(mainRoot, 'docs', 'LESSONS.md');
}
export const LESSON_KINDS = ['NEVER', 'ALWAYS', 'NOTE'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

/** `- YYYY-MM-DD <card or incident>: NEVER|ALWAYS|NOTE <rule> (source: <ref>)` on one line. */
export const LESSON_LINE = /^- (\d{4}-\d{2}-\d{2}) (\S+): (NEVER|ALWAYS|NOTE) (.+) \(source: ([^()]+)\)$/;
/** The disposition text `aidlc card close --lesson` accepts: the kind, the rule and the source. */
export const LESSON_TEXT = /^(NEVER|ALWAYS|NOTE) (.+) \(source: ([^()]+)\)$/;
const ONE_LINE = /^[^\r\n\u2028\u2029]+$/;

export interface LessonEntry {
  date: string;
  ref: string;
  kind: LessonKind;
  rule: string;
  source: string;
}

export interface LessonsContext {
  file: string;
  count: number;
  recent: string[];
}

const HEADER = [
  '# Lessons',
  '',
  'Durable rules this repository learned from its own review blocks and',
  'incidents. Append-only: one dated line per lesson, written at CLOSE of the',
  'card that learned it, only when a review block or an incident taught a',
  'rule the playbook did not already state. Past lines are never rewritten;',
  'a superseded lesson gets a new line that names it. PREPARE reads this',
  'file once per card.',
  '',
  'Format: `- YYYY-MM-DD <card or incident>: NEVER|ALWAYS|NOTE <rule> (source: <verdict, PR or incident ref>)`',
  '',
  '## Lessons',
  '',
].join('\n');

/** A calendar date in YYYY-MM-DD that round-trips through UTC, so 2026-02-30 is rejected. */
function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

export function formatLesson(entry: LessonEntry): string {
  return `- ${entry.date} ${entry.ref}: ${entry.kind} ${entry.rule} (source: ${entry.source})`;
}

/** Why an entry does not format to a valid line, or undefined when it does. The same rule governs parsing, reading and writing. */
export function lessonProblem(entry: LessonEntry): string | undefined {
  if (!isCalendarDate(entry.date)) return `date ${entry.date} is not a calendar date in YYYY-MM-DD`;
  if (!entry.ref || !ONE_LINE.test(entry.ref) || /\s/.test(entry.ref)) return 'the card or incident ref must be one token';
  if (!(LESSON_KINDS as readonly string[]).includes(entry.kind)) return `kind ${entry.kind} is not NEVER, ALWAYS or NOTE`;
  if (!entry.rule.trim() || entry.rule !== entry.rule.trim() || !ONE_LINE.test(entry.rule)) return 'the rule must be one non-empty line without leading or trailing whitespace';
  if (!entry.source.trim() || entry.source !== entry.source.trim() || !ONE_LINE.test(entry.source) || /[()]/.test(entry.source)) return 'the source must be one non-empty line without parentheses';
  const line = formatLesson(entry);
  return LESSON_LINE.test(line) ? undefined : `line does not match the frozen format: ${line}`;
}

/** A line in the frozen format whose fields pass the validation a written lesson passes; anything else is not a lesson. */
export function parseLessonLine(line: string): LessonEntry | undefined {
  const m = line.match(LESSON_LINE);
  if (!m) return undefined;
  const entry: LessonEntry = { date: m[1]!, ref: m[2]!, kind: m[3] as LessonKind, rule: m[4]!, source: m[5]! };
  return lessonProblem(entry) ? undefined : entry;
}

/** Parse the `--lesson` text into an entry for the card on the given date. */
export function lessonFromText(text: string, ref: string, date: string): LessonEntry {
  const m = text.trim().match(LESSON_TEXT);
  if (!m) throw new Error(`lesson text must read "NEVER|ALWAYS|NOTE <rule> (source: <ref>)", got: ${text}`);
  const entry: LessonEntry = { date, ref, kind: m[1] as LessonKind, rule: m[2]!.trim(), source: m[3]!.trim() };
  const problem = lessonProblem(entry);
  if (problem) throw new Error(problem);
  return entry;
}

/** True when the file already holds this exact line: an earlier append that completed. */
export function hasLesson(file: string, line: string): boolean {
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').split(/\r?\n/).includes(line);
}

/**
 * Append one line. Every write opens the file in append mode, so no writer can overwrite another: a missing
 * file gets its header and first line in one exclusive append (a concurrent creator loses the race and appends
 * its line instead), an existing file gets one literal appended line, and the only race left is the newline
 * placed before a line, worth at most one blank line.
 */
export function appendLesson(file: string, entry: LessonEntry): string {
  const problem = lessonProblem(entry);
  if (problem) throw new Error(problem);
  const line = formatLesson(entry);
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    appendFileSync(file, `${HEADER}${line}\n`, { flag: 'ax' });
    return line;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const current = readFileSync(file, 'utf8');
  appendFileSync(file, `${current.length > 0 && !current.endsWith('\n') ? '\n' : ''}${line}\n`, { flag: 'a' });
  return line;
}

/** The context PREPARE hands the card: the file, the number of valid lessons and the most recent lines. */
export function readLessons(file: string, recent = 5): LessonsContext {
  if (!existsSync(file)) return { file, count: 0, recent: [] };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => parseLessonLine(l) !== undefined);
  return { file, count: lines.length, recent: lines.slice(-recent) };
}

/** Whether the process that wrote a lock is still alive on this host; a dead holder never blocks a closer. */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(lock: string): { pid: number; token: string; ageMs: number } | undefined {
  try {
    const [pid, token] = readFileSync(lock, 'utf8').trim().split(' ');
    return { pid: Number(pid), token: token ?? '', ageMs: Date.now() - statSync(lock).mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * One closer at a time: an exclusive lock file next to the lessons file guards the lookup, the append and the record
 * of a disposition. The lock carries the holder process and a token; it is taken over only when its holder is no
 * longer running or the lock is older than `staleMs` (a holder that hung for that long). A live holder refuses and the
 * caller retries. The work receives `assertHeld`, which throws once the lock changed hands, so an evicted closer never
 * writes; on release only a lock still carrying this token is removed, never the next owner's.
 */
export function withLessonsLock<T>(file: string, work: (assertHeld: () => void) => T, staleMs = 10 * 60_000): T {
  const lock = `${file}.lock`;
  mkdirSync(path.dirname(file), { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd: number | undefined;
    try {
      fd = openSync(lock, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const held = readLock(lock);
      if (held && processAlive(held.pid) && held.ageMs <= staleMs) {
        throw new Error(`another closer holds ${lock} (process ${held.pid}); retry once it is released`);
      }
      try {
        unlinkSync(lock);
      } catch {
        /* another closer took it over first */
      }
      continue;
    }
    try {
      writeSync(fd, `${process.pid} ${token}\n`);
    } finally {
      closeSync(fd);
    }
    const assertHeld = () => {
      if (readLock(lock)?.token !== token) throw new Error(`the lessons lock ${lock} changed hands; nothing was written`);
    };
    try {
      return work(assertHeld);
    } finally {
      if (readLock(lock)?.token === token) {
        try {
          unlinkSync(lock);
        } catch {
          /* already gone */
        }
      }
    }
  }
  throw new Error(`could not take the stale lock ${lock}`);
}
