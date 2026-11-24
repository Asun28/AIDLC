// Card T1-PANEL-ARMS-REPORT: bench/outcome/panel.ts combines saved bench reports into panel scores (union, intersection,
// unique hits), assembles bench/outcome/panel.json with the keep rule of intent/review-panel.md, and docs/reliability/panel.md
// reports it, every number in a table row checked against its source.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, tmpDir } from '../infra/helpers.ts';
import { LESSON_COMMITS, assemble, keep, unionOf, type CaseResult, type Measures, type Union } from '../../bench/outcome/panel.ts';
import type { ReviewBenchCase } from '../../src/core/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dirs: string[] = [];
after(() => dirs.forEach(cleanup));
const temp = (): string => { const d = tmpDir('aidlc-panel-'); dirs.push(d); return d; };

type Outcome = CaseResult['outcome'];
const POLICY = 'aa7f80bac1a3df11a5b915c7f85a2ef0b1e268a065229b7790c5020c0dad537e';
const FABLE = { rounds: 1, formalCommand: { path: 'bench/outcome/fable-r3.json', sha256: '0e2b' } };
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);
/** A cited reason at `file`:`line`, in the form `citedSite` reads (src/review/bench.ts:437). */
const reason = (file: string, line: number): string => `[spec] [P1] 6 tests (class: x) @ ${file}:${line}: defect`;
/** What the bench saves for a case of each outcome (src/review/bench.ts, score): a hit cites the expected site of its case file (src/f<i>.ts:10) and names it as matched. */
const evidence = (i: number, outcome: Outcome): Partial<CaseResult> => {
  if (outcome === 'no-verdict' || outcome === 'error') return { runStatus: 'tool_error', cited: [] };
  if (outcome === 'hit') return { runStatus: 'success', cited: [reason(`src/f${i}.ts`, 10)], matched: { reason: reason(`src/f${i}.ts`, 10), file: `src/f${i}.ts`, line: 10 } };
  return { runStatus: 'success', cited: outcome === 'false-block' ? [reason(`src/c${i}.ts`, 1)] : [] };
};
const bugs = (n: number, hits: number[], other: Record<number, Outcome> = {}, dur = 100): CaseResult[] =>
  range(0, n).map((i) => { const outcome = other[i] ?? (hits.includes(i) ? 'hit' : 'miss'); return { id: `b${i}`, kind: 'bug', confirmed: true, cited: [], outcome, durationMs: dur, verdictRef: `x/b${i}.json`, ...evidence(i, outcome) }; });
const cleans = (n: number, blocks: number[], other: Record<number, Outcome> = {}, dur = 100): CaseResult[] =>
  range(0, n).map((i) => { const outcome = other[i] ?? (blocks.includes(i) ? 'false-block' : 'pass'); return { id: `c${i}`, kind: 'clean', confirmed: true, cited: [], outcome, durationMs: dur, verdictRef: `x/c${i}.json`, ...evidence(i, outcome) }; });
/** Case files: bug case b<i> expects src/f<i>.ts:10 (window 0), and b0 and b1, b2 and b3, ... share one candidate, base and card (one triple); a clean case has its own. */
const sha = (n: number): string => n.toString(16).padStart(40, '0');
const caseFile = (id: string, kind: 'bug' | 'clean', triple: number): ReviewBenchCase => ({ id, kind, candidate: sha(triple + 1), base: sha(999), card: { id: 'T1-X', path: `specs/tasks/T${triple}.md` }, confirmed: true, confirmedBy: 'fixture', origin: 'fixture', ...(kind === 'bug' ? { expected: [{ file: `src/f${id.slice(1)}.ts`, line: 10, window: 0, class: 'x' }] } : {}) }) as ReviewBenchCase;
const bugFiles = (n: number): ReviewBenchCase[] => range(0, n).map((i) => caseFile(`b${i}`, 'bug', Math.floor(i / 2)));
const cleanFiles = (n: number): ReviewBenchCase[] => range(0, n).map((i) => caseFile(`c${i}`, 'clean', 100 + i));
const CASE_DIRS: Record<string, ReviewBenchCase[]> = { 'arms/miss25': bugFiles(30), 'panel-arms/clean15': cleanFiles(3), 'evals/review/replay': bugFiles(10), 'evals/review/clean': cleanFiles(5) };
interface ReportOpts { stage?: string; options?: Record<string, unknown>; policyHash?: string }
const report = (trials: CaseResult[][], o: ReportOpts = {}): string =>
  JSON.stringify({ stage: o.stage ?? 'formal', policyHash: o.policyHash ?? POLICY, options: o.options ?? { rounds: 1 }, leftCheckouts: [], cases: trials[0], trialResults: trials.map((cases) => ({ cases })) });
/** Codex round 1 is `rounds[0]`; after three rounds the run hits one more case (b10), which round 1 missed. */
const withRounds = (cases: CaseResult[]): CaseResult[] =>
  cases.map((c) => c.id === 'b10'
    ? { ...c, cited: [reason('src/other.ts', 10), ...c.cited], rounds: [{ outcome: 'miss', durationMs: c.durationMs, cited: 1 }, { outcome: c.outcome, durationMs: 1, cited: 1 }] }
    : { ...c, rounds: [{ outcome: c.outcome, durationMs: c.durationMs, cited: c.cited.length }] });

/** The three-round Codex bug cases: b28 is an error no round reviewed, so it carries an empty `rounds` (src/review/bench.ts:209). */
const roundsMiss = (): CaseResult[] => withRounds(bugs(30, range(0, 11), { 28: 'error' })).map((c) => (c.id === 'b28' ? { ...c, rounds: [] } : c));
/** Stage 1 inputs: 30 bug cases and 3 clean (b28 an error of round 1, b29 and c2 no verdict for Fable). Round 1 hits b0-b9, the field-order run b5-b14, Fable b0, b1 and `fableUnique` cases from b10. */
function stage1(fableUnique: number): Record<string, string> {
  return {
    'arms/rounds-miss.json': report([roundsMiss()], { options: { rounds: 3 } }),
    'arms/order-miss.json': report([bugs(30, range(5, 15)).map((c) => (c.id === 'b20' ? { ...c, cited: [reason('src/other.ts', 10), reason('src/f20.ts', 5), reason('src/f20.ts', 15)] } : c))], { options: { rounds: 1, order: 'analysis-first' } }),
    'panel-arms/fable-miss.json': report([bugs(30, [0, 1, ...range(10, 10 + fableUnique)], { 29: 'no-verdict' })], { options: FABLE }),
    'arms/rounds-clean.json': report([withRounds(cleans(3, [0]))], { options: { rounds: 3 } }),
    'arms/order-clean.json': report([cleans(3, [0])], { options: { rounds: 1, order: 'analysis-first' } }),
    'panel-arms/fable-clean.json': report([cleans(3, [1], { 2: 'no-verdict' })], { options: FABLE }),
  };
}
/** No verdict file, as a case stopped by a quota hold has none: the triple comes from the case files. */
const noRef = (cases: CaseResult[]): CaseResult[] => cases.map(({ verdictRef: _, ...c }) => c);
/** Stage 2 inputs: 10 bug cases in 5 triples and 5 clean cases, 3 trials each; Codex takes 100 ms on a bug triple and 200 on a clean one, Fable 50 and 300. */
function stage2(): Record<string, string> {
  const codexBug = [bugs(10, [0, 1, 2]), bugs(10, [0, 1, 3]), bugs(10, [0, 4])].map(noRef);
  const codexClean = [cleans(5, [0], {}, 200), cleans(5, [], {}, 200), cleans(5, [0], {}, 200)];
  const fableBug = [bugs(10, [5, 6], { 9: 'no-verdict' }, 50), bugs(10, [0, 5], {}, 50), bugs(10, [0, 1, 2, 7], {}, 50)].map(noRef);
  const fableClean = [cleans(5, [], {}, 300), cleans(5, [1], {}, 300), cleans(5, [], {}, 300)];
  return {
    'panel-arms/stage2/codex-replay.json': report(codexBug), 'panel-arms/stage2/codex-clean.json': report(codexClean),
    'panel-arms/stage2/fable-replay.json': report(fableBug, { options: FABLE }), 'panel-arms/stage2/fable-clean.json': report(fableClean, { options: FABLE }),
  };
}
/** docs/LESSONS.md at the two commits: two lessons, then three and a line that is not a lesson. */
const LESSON = (kind: string, n: number): string => `- 2026-11-0${n} T1-X: ${kind} rule ${n} (source: PR ${n})`;
const LESSON_TEXT: Record<string, string> = { [LESSON_COMMITS.arms]: [LESSON('NEVER', 1), LESSON('NOTE', 2)].join('\n'), [LESSON_COMMITS.stage1]: ['# Lessons', LESSON('NEVER', 1), LESSON('NOTE', 2), LESSON('ALWAYS', 3)].join('\n') };
const lessonsAt = (sha: string): string | undefined => LESSON_TEXT[sha];
/** Writes `files` under a temp input directory and assembles from it; returns the refusal and what was written. */
function run(files: Record<string, string | undefined>, caseDirs: Record<string, ReviewBenchCase[] | undefined> = CASE_DIRS, lessons = lessonsAt): { refusal?: string; written: string[]; doc?: { commit: string; lessons: unknown; measures: Measures; keep: ReturnType<typeof keep> } } {
  const dir = temp();
  for (const [rel, text] of Object.entries(files)) if (text !== undefined) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const written: string[] = [];
  const read = (rel: string): string | undefined => (existsSync(path.join(dir, rel)) ? readFileSync(path.join(dir, rel), 'utf8') : undefined);
  const r = assemble({ commit: 'abc', hasCommit: (c) => c === 'abc', read, caseDir: (rel) => caseDirs[rel], lessons }, (t) => written.push(t));
  return { refusal: r?.refusal, written, doc: written[0] === undefined ? undefined : JSON.parse(written[0]) };
}

test('T1-PANEL-ARMS-REPORT acceptance 1: unionOf gives union, intersection, unique hits and excluded', () => {
  // 64 scored bug cases: the first member hits b0-b32 (33), the second b6-b40 (35), 27 shared. b64 is a no-verdict in the second member, b65 an error in the first; only-a and only-b are held by one member.
  const a = [...bugs(66, range(0, 33), { 65: 'error' }), ...cleans(2, [0, 1]), { id: 'only-a', kind: 'bug', outcome: 'hit', durationMs: 1 } as CaseResult];
  const b = [...bugs(66, range(6, 41), { 64: 'no-verdict' }), ...cleans(2, [0]), { id: 'only-b', kind: 'bug', outcome: 'hit', durationMs: 1 } as CaseResult];
  const u = unionOf([a, b]);
  assert.deepEqual(
    { cases: u.cases, bugCases: u.bugCases, cleanCases: u.cleanCases, members: u.members, union: u.union, intersection: u.intersection, uniqueHits: u.uniqueHits, excluded: u.excluded },
    { cases: 66, bugCases: 64, cleanCases: 2, members: [{ hits: 33, falseBlocks: 2 }, { hits: 35, falseBlocks: 1 }], union: { hits: 41, falseBlocks: 2 }, intersection: { hits: 27, falseBlocks: 1 }, uniqueHits: [6, 8], excluded: ['b64', 'b65'] },
  );
  assert.deepEqual(unionOf([cleans(1, [0]), cleans(1, [0])]).union, { hits: 0, falseBlocks: 1 }, 'a clean case both members block is one union false block');
  assert.throws(() => unionOf([a]), /two or more members/);
});

test('T1-PANEL-ARMS-REPORT acceptance 2: assemble refuses each input fault of R2 and writes nothing', () => {
  const ok = stage1(8);
  const fableNoCommand = { ...ok, 'panel-arms/fable-miss.json': report([bugs(30, [0])], { options: { rounds: 1 } }) };
  const codexWithCommand = { ...ok, 'arms/order-miss.json': report([bugs(30, [0])], { options: FABLE }) };
  const faults: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ['missing file', { ...ok, 'arms/order-clean.json': undefined }, /arms\/order-clean\.json: missing/],
    ['unparsable file', { ...ok, 'arms/rounds-miss.json': '{"stage": ' }, /arms\/rounds-miss\.json: unparsable/],
    ['stage not formal', { ...ok, 'arms/order-miss.json': report([bugs(30, [])], { stage: 'pre' }) }, /arms\/order-miss\.json: stage pre is not formal/],
    ['Fable without formalCommand', fableNoCommand, /panel-arms\/fable-miss\.json: a Fable report without options\.formalCommand/],
    ['Codex with formalCommand', codexWithCommand, /arms\/order-miss\.json: a Codex report with options\.formalCommand/],
    ['policy hashes differ', { ...ok, 'panel-arms/fable-clean.json': report([cleans(3, [])], { options: FABLE, policyHash: 'bbbdb10f' }) }, /policy hash/],
    ['case ids differ', { ...ok, 'arms/order-miss.json': report([bugs(31, [])]) }, /case ids/],
    ['stage 2 case ids differ', { ...stage1(8), ...stage2(), 'panel-arms/stage2/fable-clean.json': report([cleans(6, []), cleans(6, []), cleans(6, [])], { options: FABLE }) }, /case ids/],
    ['stage 2 report of two trials', { ...stage1(8), ...stage2(), 'panel-arms/stage2/codex-clean.json': report([cleans(5, []), cleans(5, [])]), 'panel-arms/stage2/fable-clean.json': report([cleans(5, []), cleans(5, [])], { options: FABLE }) }, /not three trials/],
  ];
  const s12 = { ...stage1(8), ...stage2() };
  const at = (cases: CaseResult[], i: number, patch: Record<string, unknown>): CaseResult[] => cases.map((c, j) => (j === i ? ({ ...c, ...patch } as CaseResult) : c));
  const bad = (name: string, patch: Record<string, unknown>, why = /panel-arms\/fable-miss\.json: (unparsable|case b3)/): [string, Record<string, string | undefined>, RegExp] => [name, { ...ok, 'panel-arms/fable-miss.json': report([at(bugs(30, []), 3, patch)], { options: FABLE }) }, why];
  const s2With = (name: string, codex: CaseResult[][], fable: CaseResult[][]): [string, Record<string, string | undefined>, RegExp] => [name, { ...s12, 'panel-arms/stage2/codex-replay.json': report(codex), 'panel-arms/stage2/fable-replay.json': report(fable, { options: FABLE }) }, /case ids/];
  const b4 = bugs(4, []);
  faults.push(
    bad('an outcome outside the bench enum', { outcome: 'hits' }), bad('a bug case with a clean outcome', { outcome: 'pass' }, /fable-miss\.json: case b3: a bug case has outcome pass/), bad('a kind outside bug and clean', { kind: 'other' }),
    bad('no durationMs', { durationMs: undefined }), bad('a negative durationMs', { durationMs: -1 }), bad('a round with a negative duration', { rounds: [{ outcome: 'miss', durationMs: -1, cited: 0 }] }), bad('a round outside the enum', { rounds: [{ outcome: 'x', durationMs: 1, cited: 0 }] }),
    ['a duplicate case id', { ...ok, 'panel-arms/fable-miss.json': report([[...bugs(30, []), bugs(1, [])[0]!]], { options: FABLE }) }, /duplicate case id b0/],
    ['a stage 1 report of two trials', { ...ok, 'arms/order-miss.json': report([bugs(30, []), bugs(30, [])]) }, /not one trial/],
    s2With('trial boundaries differ between paired reports', [[b4[0]!, b4[1]!], [b4[2]!], [b4[3]!]], [[b4[0]!], [b4[1]!, b4[2]!], [b4[3]!]]),
    s2With('consecutive Codex trials differ', [bugs(10, []), bugs(9, []), bugs(10, [])], [bugs(10, []), bugs(9, []), bugs(10, [])]),
  );
  // Rounds (src/review/bench.ts:209 and 405): a scored case of a multi-round report needs its rounds, ending on its outcome.
  const roundsFault = (name: string, patch: Record<string, unknown>, why: RegExp, options: Record<string, unknown> = { rounds: 3 }): [string, Record<string, string | undefined>, RegExp] =>
    [name, { ...ok, 'arms/rounds-miss.json': report([at(roundsMiss(), 3, patch)], { options }) }, why];
  const kindFault = (name: string, rel: string, cases: CaseResult[], options: Record<string, unknown>): [string, Record<string, string | undefined>, RegExp] => [name, { ...ok, [rel]: report([cases], { options }) }, /stage 1: case b3 has kind clean/];
  const fableB3Clean = at(bugs(30, [0, 1, ...range(10, 18)], { 29: 'no-verdict' }), 3, { kind: 'clean', outcome: 'false-block' });
  const fableTrial2B3Clean = [bugs(10, [5, 6], { 9: 'no-verdict' }, 50), at(bugs(10, [0, 5], {}, 50), 3, { kind: 'clean', outcome: 'false-block' }), bugs(10, [0, 1, 2, 7], {}, 50)];
  faults.push(
    roundsFault('a scored case of a multi-round report without rounds', { rounds: undefined }, /arms\/rounds-miss\.json: case b3 has no rounds in a report of 3 rounds/),
    roundsFault('a scored case with an empty rounds', { rounds: [] }, /case b3 is scored \(hit\) with no round/),
    roundsFault('an outcome other than its last round', { outcome: 'miss', cited: [], matched: undefined }, /case b3 has outcome miss but its last round hit/),
    roundsFault('more rounds than the report ran', { rounds: [0, 1, 2, 3].map(() => ({ outcome: 'miss', durationMs: 1, cited: 0 })) }, /case b3 has 4 rounds in a report of 3/),
    ['rounds in a one-round report', { ...ok, 'arms/order-miss.json': report([at(bugs(30, range(5, 15)), 3, { rounds: [{ outcome: 'miss', durationMs: 1, cited: 0 }] })], { options: { rounds: 1 } }) }, /arms\/order-miss\.json: case b3 holds rounds in a one-round report/],
    kindFault('a kind that differs between members', 'panel-arms/fable-miss.json', fableB3Clean, FABLE),
    [ 'a kind that differs in one stage 2 trial', { ...s12, 'panel-arms/stage2/fable-replay.json': report(fableTrial2B3Clean.map(noRef), { options: FABLE }) }, /stage 2 trial 2: case b3 has kind clean/],
    ['ids that a comma join would merge',{ ...ok, 'panel-arms/fable-miss.json': report([at(bugs(30, []), 3, { id: 'b3,b4' })], { options: FABLE }) }, /case b3,b4: id expected letters, digits, dot, underscore or dash/],
    ['an id outside the bench syntax', { ...ok, 'panel-arms/fable-miss.json': report([at(bugs(30, []), 3, { id: 'b 3' })], { options: FABLE }) }, /case b 3: id expected letters/],
    // The member's sorted ids are a prefix of the others' (c2 sorts last of the bug and clean ids).
    ['a member short of the last id', { ...ok, 'panel-arms/fable-clean.json': report([cleans(2, [1])], { options: FABLE }) }, /stage 1: the case ids differ/],
    bad('confirmed not a boolean', { confirmed: 'yes' }), bad('no cited', { cited: undefined }), bad('a runStatus outside the enum', { runStatus: 'done' }),
    bad('matched without a reason', { matched: { file: 'a.ts', line: 1 } }), bad('detail not a string', { detail: 1 }), bad('verdictRef not a string', { verdictRef: 1 }), bad('logRef not a string', { logRef: 1 }),
    roundsFault('a round with a negative duration in a multi-round report', { rounds: [{ outcome: 'hit', durationMs: -1, cited: 0 }] }, /case b3: rounds\.0\.durationMs/),
    roundsFault('a round with no cited count', { rounds: [{ outcome: 'hit', durationMs: 1 }] }, /case b3: rounds\.0\.cited/),
    roundsFault('options.rounds not a whole number', {}, /arms\/rounds-miss\.json: unparsable/, { rounds: 2.5 }),
    ['trialResults not an array', { ...ok, 'arms/order-miss.json': JSON.stringify({ stage: 'formal', policyHash: POLICY, options: { rounds: 1 }, trialResults: 'x' }) }, /arms\/order-miss\.json: unparsable/],
    ['a Fable case moved from the miss report to the clean report', { ...ok, 'panel-arms/fable-miss.json': report([bugs(30, [0, 1, ...range(10, 18)], { 29: 'no-verdict' }).filter((c) => c.id !== 'b3')], { options: FABLE }), 'panel-arms/fable-clean.json': report([[...cleans(3, [1], { 2: 'no-verdict' }), bugs(4, [])[3]!]], { options: FABLE }) }, /stage 1: the case ids differ: panel-arms\/fable-miss\.json against arms\/miss25/],
    ['a Fable case moved from the replay report to the clean report in trial 2', { ...s12, 'panel-arms/stage2/fable-replay.json': report([bugs(10, [5, 6], { 9: 'no-verdict' }, 50), bugs(10, [0, 5], {}, 50).filter((c) => c.id !== 'b3'), bugs(10, [0, 1, 2, 7], {}, 50)], { options: FABLE }), 'panel-arms/stage2/fable-clean.json': report([cleans(5, [], {}, 300), [...cleans(5, [1], {}, 300), bugs(4, [])[3]!], cleans(5, [], {}, 300)], { options: FABLE }) }, /stage 2 trial 2: the case ids differ: panel-arms\/stage2\/fable-replay\.json against evals\/review\/replay/],
    bad('a hit with runStatus timeout and no matched', { outcome: 'hit', runStatus: 'timeout' }, /case b3: rule \(d\): outcome hit with runStatus timeout/), bad('a hit with no matched', { outcome: 'hit' }, /case b3: rule \(f\): only a hit has matched/),
    bad('a miss with matched', { matched: { reason: reason('src/f3.ts', 10), file: 'src/f3.ts', line: 10 }, cited: [reason('src/f3.ts', 10)] }, /case b3: rule \(f\): only a hit has matched/),
    bad('a pass that cites a reason', { outcome: 'pass', kind: 'clean', cited: [reason('src/c3.ts', 1)] }, /case b3: rule \(e\): outcome pass cites no reason/), bad('a no-verdict that cites a reason', { outcome: 'no-verdict', runStatus: 'tool_error', cited: [reason('src/f3.ts', 10)] }, /case b3: rule \(e\): outcome no-verdict cites no reason/),
    bad('a matched reason not among the cited', { outcome: 'hit', cited: [reason('src/f3.ts', 10)], matched: { reason: reason('src/f3.ts', 11), file: 'src/f3.ts', line: 10 } }, /case b3: rule \(f\): only a hit has matched, and its matched reason is one of its cited/),
    bad('a matched reason that cites another file', { outcome: 'hit', cited: [reason('src/g.ts', 10)], matched: { reason: reason('src/g.ts', 10), file: 'src/f3.ts', line: 10 } }, /case b3: rule \(f\): its matched reason cites src\/g\.ts, not its matched file src\/f3\.ts/),
    roundsFault('a round outcome of the other kind', { rounds: [{ outcome: 'pass', durationMs: 1, cited: 0 }, { outcome: 'hit', durationMs: 1, cited: 1 }] }, /rounds-miss\.json: case b3: a bug case has outcome pass/),
    ['a stored hit whose cited reason misses the expected site', { ...ok, 'panel-arms/fable-miss.json': report([at(bugs(30, []), 3, { outcome: 'hit', cited: [reason('src/f3.ts', 99)], matched: { reason: reason('src/f3.ts', 99), file: 'src/f3.ts', line: 10 } })], { options: FABLE }) }, /stage 1: panel-arms\/fable-miss\.json: case b3 is stored as hit; its cited reasons and case file score miss/],
    ['a stored miss whose cited reason hits the expected site', { ...ok, 'panel-arms/fable-miss.json': report([at(bugs(30, []), 3, { cited: [reason('src/f3.ts', 10)] })], { options: FABLE }) }, /stage 1: panel-arms\/fable-miss\.json: case b3 is stored as miss; its cited reasons and case file score hit/],
    ['a hit whose matched is not the first cited reason on a site', { ...ok, 'panel-arms/fable-miss.json': report([at(bugs(30, []), 3, { outcome: 'hit', cited: [reason('src/f3.ts', 10), reason('src/f3.ts', 10) + ' again'], matched: { reason: reason('src/f3.ts', 10) + ' again', file: 'src/f3.ts', line: 10 } })], { options: FABLE }) }, /case b3 is stored as hit by another reason or site than its first cited reason on an expected site/],
    roundsFault('a round hit followed by a round miss', { outcome: 'miss', cited: [], matched: undefined, rounds: [{ outcome: 'hit', durationMs: 1, cited: 1 }, { outcome: 'miss', durationMs: 1, cited: 0 }] }, /case b3: round 2 drops the hit of round 1/),
    ['cases not an array', { ...ok, 'arms/order-miss.json': JSON.stringify({ stage: 'formal', policyHash: POLICY, options: { rounds: 1 }, trialResults: [{ cases: 'x' }] }) }, /arms\/order-miss\.json: unparsable/],
  );
  for (const [name, files, why] of faults) {
    const r = run(files);
    assert.match(r.refusal ?? '(no refusal)', why, name);
    assert.deepEqual(r.written, [], `${name}: nothing written`);
  }
  const noLessons = run(ok, CASE_DIRS, (sha) => (sha === LESSON_COMMITS.arms ? undefined : lessonsAt(sha)));
  assert.match(noLessons.refusal ?? '(no refusal)', /docs\/LESSONS\.md at 1418c7b9acc18621171384e3d92d7ffcbcde3a07 cannot be read/);
  assert.deepEqual(noLessons.written, []);
  const noCaseFile = run(s12, { ...CASE_DIRS, 'evals/review/replay': bugFiles(10).filter((c) => c.id !== 'b3') });
  assert.match(noCaseFile.refusal ?? '(no refusal)', /stage 2 trial 1: the case ids differ: panel-arms\/stage2\/codex-replay\.json against evals\/review\/replay/);
  assert.deepEqual(noCaseFile.written, []);
  const noDir = run(ok, { ...CASE_DIRS, 'arms/miss25': undefined });
  assert.match(noDir.refusal ?? '(no refusal)', /case directory arms\/miss25 cannot be read/);
  assert.deepEqual(noDir.written, []);
  const noDir2 = run(s12, { ...CASE_DIRS, 'evals/review/clean': undefined });
  assert.match(noDir2.refusal ?? '(no refusal)', /case directory evals\/review\/clean cannot be read/);
  assert.deepEqual(noDir2.written, []);
  const zero = run({ ...s12, 'panel-arms/stage2/codex-replay.json': report([0, 1, 2].map(() => bugs(10, [], {}, 0))), 'panel-arms/stage2/codex-clean.json': report([0, 1, 2].map(() => cleans(5, [], {}, 0))) });
  assert.match(zero.refusal ?? '(no refusal)', /wall-time ratio/, 'a single Codex median of 0 gives no ratio');
  assert.deepEqual(zero.written, []);
  assert.match(assemble({ commit: 'zzz', hasCommit: () => false, read: () => undefined, caseDir: () => undefined, lessons: () => undefined }, () => assert.fail('wrote'))?.refusal ?? '', /--commit zzz/);
  // The command writes no file on a refusal.
  const dir = temp();
  const out = path.join(dir, 'panel.json');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'bench', 'outcome', 'panel.ts'), 'assemble', '--commit', head, '--in', dir, '--out', out], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stderr, /panel: arms\/rounds-miss\.json: missing/);
  assert.equal(existsSync(out), false, 'no panel.json on a refusal');
});

test('T0-BENCH-FOLLOWUPS acceptance 6: stage 2 pairs with the confirmed cases of its directories, stage 1 with every case of its own', () => {
  const s12 = { ...stage1(8), ...stage2() };
  const unconfirmed = (id: string, kind: 'bug' | 'clean', triple: number): ReviewBenchCase => { const { confirmedBy: _, ...c } = caseFile(id, kind, triple); return { ...c, confirmed: false } as ReviewBenchCase; };
  const dirs = { ...CASE_DIRS, 'evals/review/replay': [...bugFiles(10), unconfirmed('b10', 'bug', 5)], 'evals/review/clean': [...cleanFiles(5), unconfirmed('c5', 'clean', 105)] };
  const r = run(s12, dirs);
  assert.equal(r.refusal, undefined);
  assert.deepEqual(r.doc!.measures, run(s12).doc!.measures);
  const refused = (files: Record<string, string>, d: Record<string, ReviewBenchCase[]>, why: RegExp): void => { const x = run(files, d); assert.match(x.refusal ?? '(no refusal)', why); assert.deepEqual(x.written, []); };
  const three = <T>(f: () => T): T[] => [0, 1, 2].map(f);
  refused({ ...s12, 'panel-arms/stage2/codex-clean.json': report(three(() => cleans(6, []))) }, dirs, /stage 2 trial 1: the case ids differ: panel-arms\/stage2\/codex-clean\.json against evals\/review\/clean/);
  refused({ ...s12, 'panel-arms/stage2/codex-replay.json': report(three(() => bugs(11, []))) }, dirs, /stage 2 trial 1: the case ids differ: panel-arms\/stage2\/codex-replay\.json against evals\/review\/replay/);
  refused(s12, { ...dirs, 'arms/miss25': [...bugFiles(30), unconfirmed('b30', 'bug', 15)] }, /stage 1: the case ids differ: arms\/rounds-miss\.json against arms\/miss25/);
  refused(s12, { ...dirs, 'panel-arms/clean15': [...cleanFiles(3), unconfirmed('c3', 'clean', 103)] }, /stage 1: the case ids differ: arms\/rounds-clean\.json against panel-arms\/clean15/);
});

test('T0-BENCH-FOLLOWUPS acceptance 7: a multi-round report whose rounds the bench cannot write is refused, and one it can write assembles', () => {
  type Round = [Outcome, number];
  const ok = stage1(8);
  const put = (rel: string, cases: CaseResult[], i: number, patch: Partial<CaseResult>, rounds: Round[]): Record<string, string> =>
    ({ ...ok, [rel]: report([cases.map((c, j) => (j === i ? { ...c, ...patch, rounds: rounds.map(([outcome, cited]) => ({ outcome, durationMs: 1, cited })) } : c))], { options: { rounds: 3 } }) });
  const miss = (i: number, patch: Partial<CaseResult>, ...rounds: Round[]): Record<string, string> => put('arms/rounds-miss.json', roundsMiss(), i, patch, rounds);
  const clean = (i: number, patch: Partial<CaseResult>, ...rounds: Round[]): Record<string, string> => put('arms/rounds-clean.json', withRounds(cleans(3, [0])), i, patch, rounds);
  const other = (...at: number[]): string[] => at.map((line) => reason('src/other.ts', line));
  const hit3 = reason('src/f3.ts', 10);
  // b3 is stored as a hit of one cited reason, b20 as a miss citing none, b28 as an error; c0 is a false block of one cited reason, c1 a pass.
  const faults: Array<[string, Record<string, string>, RegExp]> = [
    ['rule 1: a round before the last cites nothing', miss(20, { cited: other(1) }, ['miss', 0], ['miss', 1]), /arms\/rounds-miss\.json: case b20: rounds rule 1/],
    ['rule 1: the middle round cites nothing', miss(20, { cited: other(1, 2) }, ['miss', 2], ['miss', 0], ['miss', 0]), /case b20: rounds rule 1/],
    ['rule 2: an error round in a scored case', miss(20, { cited: other(1, 2) }, ['error', 1], ['miss', 1]), /case b20: rounds rule 2/],
    ['rule 2: a scored round in an error case', miss(28, {}, ['miss', 1], ['error', 0]), /case b28: rounds rule 2/],
    ['rule 2: a no-verdict round in a scored case', miss(20, { cited: other(1, 2) }, ['no-verdict', 1], ['miss', 1]), /case b20: rounds rule 2/],
    ['rule 2: a no-verdict round in an error case', miss(28, {}, ['no-verdict', 1], ['error', 0]), /case b28: rounds rule 2/],
    ['rule 2: a scored round in a no-verdict case', miss(20, { outcome: 'no-verdict', runStatus: 'tool_error' }, ['miss', 1], ['no-verdict', 0]), /case b20: rounds rule 2/],
    ['rule 3: the first hit round cites nothing', miss(3, { cited: [hit3] }, ['miss', 1], ['hit', 0]), /case b3: rounds rule 3/],
    ['rule 3: a round 1 hit that cites nothing (issue 391, F4)', miss(3, {}, ['hit', 0]), /case b3: rounds rule 3/],
    ['rule 3: a pass round that cites a reason', clean(0, { cited: other(1, 2) }, ['pass', 1], ['false-block', 1]), /arms\/rounds-clean\.json: case c0: rounds rule 3/],
    ['rule 4: no cited reason where a round cites one', miss(20, {}, ['miss', 1]), /case b20: rounds rule 4/],
    ['rule 4: a cited reason where no round cites one', miss(20, { cited: other(1) }, ['miss', 0]), /case b20: rounds rule 4/],
    ['rule 4: more cited reasons than the rounds cite', miss(20, { cited: other(1, 2) }, ['miss', 1]), /case b20: rounds rule 4/],
    ['rule 4: a no-verdict round that cites a reason', miss(20, { outcome: 'no-verdict', runStatus: 'tool_error' }, ['no-verdict', 1]), /case b20: rounds rule 4/],
  ];
  for (const [name, files, why] of faults) {
    const r = run(files);
    assert.match(r.refusal ?? '(no refusal)', why, name);
    assert.deepEqual(r.written, [], `${name}: nothing written`);
  }
  const good: Array<[string, Record<string, string>]> = [
    ['three rounds, the hit in round 2 and a last round that cites nothing', miss(3, { cited: [...other(1), hit3] }, ['miss', 1], ['hit', 1], ['hit', 0])],
    ['a reason cited again in a later round', miss(20, { cited: other(1, 2) }, ['miss', 2], ['miss', 1])],
    ['an error case of a reviewed group', miss(28, {}, ['error', 2], ['error', 0])],
    ['a no-verdict case with its one round', miss(20, { outcome: 'no-verdict', runStatus: 'tool_error' }, ['no-verdict', 0])],
    ['a false block that cites nothing on the changed paths', clean(0, { cited: [] }, ['false-block', 0])],
    ['a false block that a round 2 pass follows', clean(0, {}, ['false-block', 1], ['false-block', 0])],
  ];
  for (const [name, files] of good) assert.equal(run(files).refusal, undefined, name);
});

const tally = (hits: number, falseBlocks: number) => ({ hits, falseBlocks });
const unionWith = (uniqueHits: number[]): Union => ({ cases: 0, bugCases: 0, cleanCases: 0, members: [], union: tally(0, 0), intersection: tally(0, 0), uniqueHits, excluded: [] });
/** Measures for keep(): the stage 1 gate value and, with `s2`, the stage 2 medians [codex, codexCodex, codexFable] as [hits, falseBlocks] and the wall-time ratios. */
function measuresOf(fableUnique: number, s2?: { med: Array<[number, number]>; ratio: [number, number] }): Measures {
  const stage1 = { excluded: [], excludedKinds: { bug: 0, clean: 0 }, codex: unionWith([0]), codexCodex: unionWith([0, 7]), codexFable: unionWith([0, fableUnique]) };
  if (!s2) return { stage1 };
  const [codex, codexCodex, codexFable] = s2.med.map(([h, f]) => ({ ...unionWith([]), union: tally(h, f) })) as [Union, Union, Union];
  const med = { codex, codexCodex, codexFable };
  return { stage1, stage2: { trials: [], median: med, min: med, max: med, wallTimeRatio: { codexCodex: s2.ratio[0], codexFable: s2.ratio[1] } } };
}

test('T1-PANEL-ARMS-REPORT acceptance 3: measures and keep equal those recomputed from the inputs', () => {
  // Stage 1 only, gate edge 8 and 7.
  const runGate = run(stage1(8)).doc!;
  assert.deepEqual(runGate.measures.stage1.codex, { cases: 30, bugCases: 28, cleanCases: 2, members: [tally(10, 1)], union: tally(10, 1), intersection: tally(10, 1), uniqueHits: [10], excluded: [] });
  assert.deepEqual(runGate.measures.stage1.codexCodex, { cases: 30, bugCases: 28, cleanCases: 2, members: [tally(10, 1), tally(10, 1)], union: tally(15, 1), intersection: tally(5, 1), uniqueHits: [5, 5], excluded: [] });
  assert.deepEqual(runGate.measures.stage1.codexFable, { cases: 30, bugCases: 28, cleanCases: 2, members: [tally(10, 1), tally(10, 1)], union: tally(18, 2), intersection: tally(2, 0), uniqueHits: [8, 8], excluded: [] });
  assert.deepEqual([runGate.measures.stage1.excluded, runGate.measures.stage1.excludedKinds], [['b28', 'b29', 'c2'], { bug: 2, clean: 1 }], 'an error with empty rounds is left out, not refused');
  assert.deepEqual(runGate.lessons, { arms: { commit: LESSON_COMMITS.arms, lessons: 2 }, stage1: { commit: LESSON_COMMITS.stage1, lessons: 3 }, added: 1 });
  assert.deepEqual(runGate.keep, { stage2: 'run', gate: { fableUniqueHits: 8, fieldOrderUniqueHits: 5, threshold: 8 }, rule: { panelGain: 7, extraFalseBlocks: 1, wallTimeRatio: 1.5, fableGain: 5 } });
  assert.equal(runGate.measures.stage2, undefined);
  const skip = run({ ...stage1(7), ...stage2() }).doc!;
  assert.deepEqual(skip.keep, { stage2: 'skip', gate: { fableUniqueHits: 7, fieldOrderUniqueHits: 5, threshold: 8 }, rule: { panelGain: 7, extraFalseBlocks: 1, wallTimeRatio: 1.5, fableGain: 5 } }, 'stage 2 inputs are not read without the gate');
  assert.equal(skip.measures.stage2, undefined);

  // Stage 2 from inputs, worked by hand: single Codex hits 3, 3, 2; Codex+Codex (trial t with trial t+1) 4, 4, 4; Codex+Fable 5, 4, 5.
  const s2 = run({ ...stage1(8), ...stage2() }).doc!.measures.stage2!;
  assert.deepEqual(s2.trials.map((t) => [t.codex.union.hits, t.codexCodex.union.hits, t.codexFable.union.hits]), [[3, 4, 5], [3, 4, 4], [2, 4, 5]]);
  assert.deepEqual(s2.trials.map((t) => t.excluded), [['b9'], [], []]);
  const unions = (x: typeof s2.median) => ({ codex: x.codex.union, codexCodex: x.codexCodex.union, codexFable: x.codexFable.union });
  assert.deepEqual([s2.median, s2.min, s2.max].map(unions), [
    { codex: tally(3, 1), codexCodex: tally(4, 1), codexFable: tally(5, 1) },
    { codex: tally(2, 0), codexCodex: tally(4, 1), codexFable: tally(4, 1) },
    { codex: tally(3, 1), codexCodex: tally(4, 1), codexFable: tally(5, 1) },
  ]);
  // Every R1 field per composition, worked by hand for Codex+Fable: trials of 14, 15, 15 cases; members 3/1 and 2/0, 3/0 and 2/1, 2/1 and 4/0;
  // union 5/1, 4/1, 5/1; intersection 0/0, 1/0, 1/0; unique hits [3, 2], [2, 1], [1, 3].
  const cf = (cases: number, bugCases: number, m0: [number, number], m1: [number, number], u: [number, number], i: [number, number], uniqueHits: number[]) =>
    ({ cases, bugCases, cleanCases: 5, members: [tally(...m0), tally(...m1)], union: tally(...u), intersection: tally(...i), uniqueHits });
  assert.deepEqual([s2.median.codexFable, s2.min.codexFable, s2.max.codexFable], [
    cf(15, 10, [3, 1], [2, 0], [5, 1], [1, 0], [2, 2]), cf(14, 9, [2, 0], [2, 0], [4, 1], [0, 0], [1, 1]), cf(15, 10, [3, 1], [4, 1], [5, 1], [1, 0], [3, 3]),
  ]);
  assert.deepEqual(s2.median.codexCodex.uniqueHits.length, 2, 'Codex+Codex summaries keep both members');
  // Per-triple wall time, pooled over trials: 15 bug triples at 100 and 15 clean at 200 give single Codex a median of 150 (by case it would be 100);
  // Codex+Codex has the same slower member times; Codex+Fable 100 (Codex is slower) on a bug triple and 300 on a clean one, median 200.
  assert.deepEqual(s2.wallTimeRatio, { codexCodex: 1, codexFable: 200 / 150 });
  assert.deepEqual(run({ ...stage1(8), ...stage2() }).doc!.keep, { stage2: 'run', gate: { fableUniqueHits: 8, fieldOrderUniqueHits: 5, threshold: 8 }, rule: { panelGain: 7, extraFalseBlocks: 1, wallTimeRatio: 1.5, fableGain: 5 }, panel: 'drop', member2: 'codex' });

  // Keep rule edges (R4).
  const k = (m: Measures) => { const r = keep(m); return [r.stage2, r.panel, r.member2]; };
  assert.deepEqual(k(measuresOf(8, { med: [[50, 1], [57, 1], [62, 2]], ratio: [1.2, 1.5] })), ['run', 'keep', 'fable'], 'Fable +5 over Codex+Codex, +1 false block, ratio 1.5');
  assert.deepEqual(k(measuresOf(8, { med: [[50, 1], [57, 1], [61, 1]], ratio: [1.2, 1.5] })), ['run', 'keep', 'codex'], 'Fable +4: two Codex runs, gain 7');
  assert.deepEqual(k(measuresOf(8, { med: [[50, 1], [56, 1], [60, 1]], ratio: [1.2, 1.5] })), ['run', 'drop', 'codex'], 'gain 6');
  assert.deepEqual(k(measuresOf(8, { med: [[50, 1], [57, 1], [62, 2]], ratio: [1.2, 1.51] })), ['run', 'drop', 'fable'], 'ratio 1.51');
  assert.deepEqual(k(measuresOf(8, { med: [[50, 0], [57, 1], [62, 2]], ratio: [1.2, 1.5] })), ['run', 'drop', 'fable'], 'panel +2 false blocks');
  assert.deepEqual(k(measuresOf(8, { med: [[50, 1], [57, 1], [62, 3]], ratio: [1.2, 1.5] })), ['run', 'keep', 'codex'], 'Fable +2 false blocks over Codex+Codex');
  assert.deepEqual(k(measuresOf(7, { med: [[50, 1], [57, 1], [62, 2]], ratio: [1.2, 1.5] })), ['skip', undefined, undefined]);
  assert.deepEqual(k(measuresOf(8)), ['run', undefined, undefined], 'gate met, no stage 2 inputs yet');

  // The committed panel.json: the stage 1 count of 2026-11-19 (61 scored bug cases) and a keep equal to keep(measures).
  const doc = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'outcome', 'panel.json'), 'utf8')) as { lessons: unknown; measures: Measures; keep: ReturnType<typeof keep> };
  // Counted by hand with `git show <sha>:docs/LESSONS.md`: 171 lesson lines at the arms pin, 187 when stage 1 started.
  assert.deepEqual(doc.lessons, { arms: { commit: '1418c7b9acc18621171384e3d92d7ffcbcde3a07', lessons: 171 }, stage1: { commit: 'be8b2c8a584bd56b982e14d3f1c70f32d0e354f2', lessons: 187 }, added: 16 });
  const m = doc.measures.stage1;
  assert.deepEqual([m.codex.bugCases, m.codex.union.hits, m.codexCodex.members[1]!.hits, m.codexFable.members[1]!.hits, m.codexCodex.union.hits, m.codexFable.union.hits, m.codexFable.uniqueHits[1], m.codexCodex.uniqueHits[1]], [61, 33, 34, 20, 40, 38, 5, 7]);
  assert.deepEqual([m.excluded.length, m.excludedKinds], [18, { bug: 3, clean: 15 }], '3 Fable bug cases and 15 Fable clean cases have no verdict');
  assert.deepEqual(doc.keep, keep(doc.measures));
  assert.equal(doc.keep.stage2, 'skip');
});

// Acceptance 4: docs/reliability/panel.md.
const DOC = path.join(ROOT, 'docs', 'reliability', 'panel.md');
const HEADINGS = ['Method', 'Earlier records', 'Stage 1', 'Stage 2', 'Keep rule', 'What these numbers do not show'];
const HEADER = '| Measure | Value | Source |';
const SEPARATOR = /^\|( *:?-+:? *\|){3}$/;
const lines = (text: string): string[] => text.split('\n').map((l) => l.replace(/\r$/, ''));
/** The value at a JSON pointer of panel.json: a number, a string, or the length of an array. */
function pointerValue(doc: unknown, pointer: string): number | string {
  let at = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, token)) throw new Error(`the pointer does not resolve at ${token}`);
    at = (at as Record<string, unknown>)[token];
  }
  if (Array.isArray(at)) return at.length;
  if (typeof at === 'number' || typeof at === 'string') return at;
  throw new Error('the pointer names neither a number, a string nor an array');
}
const equalShown = (shown: string, source: number | string): boolean => {
  if (typeof source === 'string') return shown === source;
  if (!/^-?\d+(\.\d+)?$/.test(shown)) return false;
  const places = shown.includes('.') ? shown.length - shown.indexOf('.') - 1 : 0;
  return Math.abs(Number(shown) - source) <= 0.5 * 10 ** -places + 1e-9;
};

/**
 * Each earlier-record row of panel.md, by its measure: its record (a code span of the Record cell of intent/review-panel.md,
 * Existing bench records) and the phrase of that record whose number is the value.
 */
const EARLIER: Record<string, [string, RegExp]> = {
  '2026-11-07 Codex run A1, hits of the bug cases': ['_local/bench-step4/', /Codex run A1 hit (\d+)/],
  '2026-11-07 identical rerun A2, hits': ['_local/bench-step4/', /identical rerun A2 hit (\d+)/],
  '2026-11-07 A1 or A2, hits': ['_local/bench-step4/', /A1 or A2 hit (\d+)/],
  'Recall baseline, bug cases': ['bench/outcome/replay-main.json', /\((\d+) bug cases/],
  'Recall baseline, hits': ['bench/outcome/replay-main.json', /recall (\d+) of/],
  '2026-11-16 pair, bug cases of the triples with a baseline miss': ['_local/arms/rounds-*.json', /(\d+) bug cases of/],
  '2026-11-16 Codex round 1, hits of the 64': ['_local/arms/rounds-*.json', /round 1 hit (\d+)/],
  '2026-11-16 field-order run, hits of the 64': ['_local/arms/rounds-*.json', /field-order run (\d+)/],
  '2026-11-16 pair, shared hits': ['_local/arms/rounds-*.json', /(\d+) shared/],
  '2026-11-16 pair, union hits': ['_local/arms/rounds-*.json', /union (\d+)/],
  '2026-11-16 pair, clean cases (one blocked by both runs)': ['_local/arms/rounds-*.json', /(\d+) clean\)/],
  'DeepSeek R2 arm, scored bug cases (1 hit)': ['_local/arms/r2-*.json', /hit of (\d+) scored/],
  'Claude Opus adjudicator, rows wrong of those the owner checked': ['bench/outcome/adjudication.json', /wrong on (\d+) of/],
  'Claude Opus adjudicator, rows the owner checked': ['bench/outcome/adjudication.json', /of the (\d+) rows/],
};
/** Why each table row of `doc` does not equal its source (a pointer into panel.json, or the bound phrase of its earlier record), and the rows per section. */
function docProblems(doc: string[]): { bad: string[]; bySection: Map<string, number> } {
  const panel = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'outcome', 'panel.json'), 'utf8')) as unknown;
  const intentRows = lines(readFileSync(path.join(ROOT, 'intent', 'review-panel.md'), 'utf8'));
  const from = intentRows.indexOf('## Existing bench records (read 2026-11-19)');
  const records = intentRows.slice(from, intentRows.findIndex((l, i) => i > from && l.startsWith('## '))).filter((l) => l.startsWith('| `'));
  const [bad, bySection] = [[] as string[], new Map<string, number>()];
  let section = '';
  for (const line of doc) {
    if (line.startsWith('## ')) section = line.slice(3);
    if (!line.startsWith('|') || line === HEADER || SEPARATOR.test(line)) continue;
    const cells = line.endsWith('|') ? line.slice(1, -1).split('|').map((c) => c.trim()) : [];
    const source = cells.length === 3 ? /^`([^`]+)`$/.exec(cells[2]!)?.[1] : undefined;
    const [measure, value] = [cells[0] ?? '', cells[1] ?? ''];
    bySection.set(section, (bySection.get(section) ?? 0) + 1);
    if (source === undefined) { bad.push(`no source: ${line}`); continue; }
    if (source.startsWith('/')) {
      try { if (!equalShown(value, pointerValue(panel, source))) bad.push(`value differs: ${line}`); } catch (e) { bad.push(`${(e as Error).message}: ${line}`); }
      continue;
    }
    const bound = EARLIER[measure];
    const record = bound && bound[0] === source ? records.find((r) => r.split('|')[1]!.includes('`' + source + '`')) : undefined;
    const fact = record === undefined ? undefined : bound![1].exec(record)?.[1];
    if (fact === undefined) bad.push(`no bound fact of an intent/review-panel.md record: ${line}`);
    else if (fact !== value) bad.push(`${value} is not ${fact}: ${line}`);
  }
  return { bad, bySection };
}

test('T1-PANEL-ARMS-REPORT acceptance 4: panel.md has its title, sections and the banned-character rule, and every table value equals its source', () => {
  assert.ok(existsSync(DOC), 'docs/reliability/panel.md exists');
  const doc = lines(readFileSync(DOC, 'utf8'));
  assert.equal(doc[0], '# Review panel');
  assert.deepEqual(doc.filter((l) => l.startsWith('## ')), HEADINGS.map((h) => `## ${h}`));
  assert.deepEqual(doc.filter((l) => /[—「」]/.test(l)), [], 'no em dash and no corner bracket');
  const { bad, bySection } = docProblems(doc);
  assert.deepEqual(bad, [], 'every table row names its source and its value equals it');
  assert.deepEqual(Object.keys(EARLIER).filter((m) => !doc.some((l) => l.startsWith(`| ${m} |`))), [], 'every bound earlier record is a row');
  assert.deepEqual(['Earlier records', 'Stage 1', 'Stage 2'].filter((s) => !bySection.get(s)), [], 'Earlier records, Stage 1 and Stage 2 hold rows');
  // A swapped value fails: an earlier-record number that occurs elsewhere in the same record, and a panel.json number.
  const swap = (measure: string, to: string): number =>
    docProblems(doc.map((l) => (l.startsWith(`| ${measure} |`) ? `| ${measure} | ${to} |${l.split('|').slice(3).join('|')}` : l))).bad.length;
  assert.deepEqual([swap('Recall baseline, hits', '124'), swap('2026-11-16 pair, union hits', '33'), swap('Codex+Codex, union hits', '41')], [1, 1, 1]);
  const s2 = doc.slice(doc.indexOf('## Stage 2'), doc.indexOf('## Keep rule')).join('\n');
  assert.ok(s2.includes('not run') && s2.includes('`/keep/gate/fableUniqueHits`'), 'Stage 2 states not run and the gate value');
  const limits = doc.slice(doc.indexOf('## What these numbers do not show')).join('\n');
  const lessonRows = ['/lessons/arms/commit', '/lessons/arms/lessons', '/lessons/stage1/commit', '/lessons/stage1/lessons', '/lessons/added'];
  assert.deepEqual(lessonRows.filter((p) => !limits.includes(`| \`${p}\` |`)), [], 'the lesson limit carries its counts and commits as rows');
  const names = /\b(stage|round|issue) \d+\b|\d{4}-\d{2}-\d{2}/g;
  assert.deepEqual(limits.split('\n').filter((l) => !l.startsWith('|')).join('\n').replace(names, '').match(/\b\d+\b/g) ?? [], [], 'the limits carry no count outside a table row (stage, round and issue names and dates aside)');
});
