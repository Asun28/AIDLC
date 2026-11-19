// Card T1-PANEL-ARMS-REPORT: bench/outcome/panel.ts combines saved bench reports into panel scores (union, intersection,
// unique hits), assembles bench/outcome/panel.json with the keep rule of intent/review-panel.md, and docs/reliability/panel.md
// reports it, every number in a table row checked against its source.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, tmpDir } from '../infra/helpers.ts';
import { assemble, keep, unionOf, type CaseResult, type Measures, type Union } from '../../bench/outcome/panel.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dirs: string[] = [];
after(() => dirs.forEach(cleanup));
const temp = (): string => { const d = tmpDir('aidlc-panel-'); dirs.push(d); return d; };

type Outcome = CaseResult['outcome'];
const POLICY = 'aa7f80bac1a3df11a5b915c7f85a2ef0b1e268a065229b7790c5020c0dad537e';
const FABLE = { rounds: 1, formalCommand: { path: 'bench/outcome/fable-r3.json', sha256: '0e2b' } };
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);
const bugs = (n: number, hits: number[], other: Record<number, Outcome> = {}, dur = 100): CaseResult[] =>
  range(0, n).map((i) => ({ id: `b${i}`, kind: 'bug', outcome: other[i] ?? (hits.includes(i) ? 'hit' : 'miss'), durationMs: dur, verdictRef: `x/b${i}.json` }));
const cleans = (n: number, blocks: number[], other: Record<number, Outcome> = {}, dur = 100): CaseResult[] =>
  range(0, n).map((i) => ({ id: `c${i}`, kind: 'clean', outcome: other[i] ?? (blocks.includes(i) ? 'false-block' : 'pass'), durationMs: dur, verdictRef: `x/c${i}.json` }));
interface ReportOpts { stage?: string; options?: Record<string, unknown>; policyHash?: string }
const report = (trials: CaseResult[][], o: ReportOpts = {}): string =>
  JSON.stringify({ stage: o.stage ?? 'formal', policyHash: o.policyHash ?? POLICY, options: o.options ?? { rounds: 1 }, leftCheckouts: [], cases: trials[0], trialResults: trials.map((cases) => ({ cases })) });
/** Codex round 1 is `rounds[0]`; the final outcome after three rounds hits one more case (b10), which round 1 missed. */
const withRounds = (cases: CaseResult[]): CaseResult[] =>
  cases.map((c) => ({ ...c, outcome: c.id === 'b10' ? 'hit' : c.outcome, rounds: [{ outcome: c.outcome, durationMs: c.durationMs, cited: 0 }, { outcome: c.id === 'b10' ? 'hit' : c.outcome, durationMs: 1, cited: 0 }] }));

/** Stage 1 inputs: 30 bug cases (b29 no verdict for Fable), 3 clean. Round 1 hits b0-b9, the field-order run b5-b14, Fable b0, b1 and `fableUnique` cases from b10. */
function stage1(fableUnique: number): Record<string, string> {
  return {
    'arms/rounds-miss.json': report([withRounds(bugs(30, range(0, 10)))], { options: { rounds: 3 } }),
    'arms/order-miss.json': report([bugs(30, range(5, 15))], { options: { rounds: 1, order: 'analysis-first' } }),
    'panel-arms/fable-miss.json': report([bugs(30, [0, 1, ...range(10, 10 + fableUnique)], { 29: 'no-verdict' })], { options: FABLE }),
    'arms/rounds-clean.json': report([withRounds(cleans(3, [0]))], { options: { rounds: 3 } }),
    'arms/order-clean.json': report([cleans(3, [0])], { options: { rounds: 1, order: 'analysis-first' } }),
    'panel-arms/fable-clean.json': report([cleans(3, [1])], { options: FABLE }),
  };
}
/** Bug cases b0 and b1, b2 and b3, ... share one triple (one verdict file and its duration), as the cases of one review do. */
const paired = (cases: CaseResult[]): CaseResult[] => cases.map((c, i) => ({ ...c, verdictRef: `x/t${Math.floor(i / 2)}.json` }));
/** Stage 2 inputs: 10 bug cases in 5 triples and 5 clean cases, 3 trials each; Codex takes 100 ms on a bug triple and 200 on a clean one, Fable 300. */
function stage2(): Record<string, string> {
  const codexBug = [bugs(10, [0, 1, 2]), bugs(10, [0, 1, 3]), bugs(10, [0, 4])].map(paired);
  const codexClean = [cleans(5, [0], {}, 200), cleans(5, [], {}, 200), cleans(5, [0], {}, 200)];
  const fableBug = [bugs(10, [5, 6], { 9: 'no-verdict' }, 300), bugs(10, [0, 5], {}, 300), bugs(10, [0, 1, 2, 7], {}, 300)].map(paired);
  const fableClean = [cleans(5, [], {}, 300), cleans(5, [1], {}, 300), cleans(5, [], {}, 300)];
  return {
    'panel-arms/stage2/codex-replay.json': report(codexBug), 'panel-arms/stage2/codex-clean.json': report(codexClean),
    'panel-arms/stage2/fable-replay.json': report(fableBug, { options: FABLE }), 'panel-arms/stage2/fable-clean.json': report(fableClean, { options: FABLE }),
  };
}
/** Writes `files` under a temp input directory and assembles from it; returns the refusal and what was written. */
function run(files: Record<string, string | undefined>): { refusal?: string; written: string[]; doc?: { commit: string; measures: Measures; keep: ReturnType<typeof keep> } } {
  const dir = temp();
  for (const [rel, text] of Object.entries(files)) if (text !== undefined) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const written: string[] = [];
  const read = (rel: string): string | undefined => (existsSync(path.join(dir, rel)) ? readFileSync(path.join(dir, rel), 'utf8') : undefined);
  const r = assemble({ commit: 'abc', hasCommit: (sha) => sha === 'abc', read }, (t) => written.push(t));
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
  for (const [name, files, why] of faults) {
    const r = run(files);
    assert.match(r.refusal ?? '(no refusal)', why, name);
    assert.deepEqual(r.written, [], `${name}: nothing written`);
  }
  assert.match(assemble({ commit: 'zzz', hasCommit: () => false, read: () => undefined }, () => assert.fail('wrote'))?.refusal ?? '', /--commit zzz/);
  // The command writes no file on a refusal.
  const dir = temp();
  const out = path.join(dir, 'panel.json');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'bench', 'outcome', 'panel.ts'), 'assemble', '--commit', head, '--in', dir, '--out', out], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stderr, /panel: arms\/rounds-miss\.json: missing/);
  assert.equal(existsSync(out), false, 'no panel.json on a refusal');
});

const tally = (hits: number, falseBlocks: number) => ({ hits, falseBlocks });
const unionWith = (uniqueHits: number[]): Union => ({ cases: 0, bugCases: 0, cleanCases: 0, members: [], union: tally(0, 0), intersection: tally(0, 0), uniqueHits, excluded: [] });
/** Measures for keep(): the stage 1 gate value and, with `s2`, the stage 2 medians [codex, codexCodex, codexFable] as [hits, falseBlocks] and the wall-time ratios. */
function measuresOf(fableUnique: number, s2?: { med: Array<[number, number]>; ratio: [number, number] }): Measures {
  const stage1 = { excluded: [], codex: unionWith([0]), codexCodex: unionWith([0, 7]), codexFable: unionWith([0, fableUnique]) };
  if (!s2) return { stage1 };
  const [codex, codexCodex, codexFable] = s2.med.map(([h, f]) => tally(h, f)) as [ReturnType<typeof tally>, ReturnType<typeof tally>, ReturnType<typeof tally>];
  const med = { codex, codexCodex, codexFable };
  return { stage1, stage2: { trials: [], median: med, min: med, max: med, wallTimeRatio: { codexCodex: s2.ratio[0], codexFable: s2.ratio[1] } } };
}

test('T1-PANEL-ARMS-REPORT acceptance 3: measures and keep equal those recomputed from the inputs', () => {
  // Stage 1 only, gate edge 8 and 7.
  const runGate = run(stage1(8)).doc!;
  assert.deepEqual(runGate.measures.stage1.codex, { cases: 32, bugCases: 29, cleanCases: 3, members: [tally(10, 1)], union: tally(10, 1), intersection: tally(10, 1), uniqueHits: [10], excluded: [] });
  assert.deepEqual(runGate.measures.stage1.codexCodex, { cases: 32, bugCases: 29, cleanCases: 3, members: [tally(10, 1), tally(10, 1)], union: tally(15, 1), intersection: tally(5, 1), uniqueHits: [5, 5], excluded: [] });
  assert.deepEqual(runGate.measures.stage1.codexFable, { cases: 32, bugCases: 29, cleanCases: 3, members: [tally(10, 1), tally(10, 1)], union: tally(18, 2), intersection: tally(2, 0), uniqueHits: [8, 8], excluded: [] });
  assert.deepEqual(runGate.measures.stage1.excluded, ['b29']);
  assert.deepEqual(runGate.keep, { stage2: 'run', gate: { fableUniqueHits: 8, fieldOrderUniqueHits: 5, threshold: 8 }, rule: { panelGain: 7, extraFalseBlocks: 1, wallTimeRatio: 1.5, fableGain: 5 } });
  assert.equal(runGate.measures.stage2, undefined);
  const skip = run({ ...stage1(7), ...stage2() }).doc!;
  assert.deepEqual(skip.keep, { stage2: 'skip', gate: { fableUniqueHits: 7, fieldOrderUniqueHits: 5, threshold: 8 }, rule: { panelGain: 7, extraFalseBlocks: 1, wallTimeRatio: 1.5, fableGain: 5 } }, 'stage 2 inputs are not read without the gate');
  assert.equal(skip.measures.stage2, undefined);

  // Stage 2 from inputs, worked by hand: single Codex hits 3, 3, 2; Codex+Codex (trial t with trial t+1) 4, 4, 4; Codex+Fable 5, 4, 5.
  const s2 = run({ ...stage1(8), ...stage2() }).doc!.measures.stage2!;
  assert.deepEqual(s2.trials.map((t) => [t.codex.union.hits, t.codexCodex.union.hits, t.codexFable.union.hits]), [[3, 4, 5], [3, 4, 4], [2, 4, 5]]);
  assert.deepEqual(s2.trials.map((t) => t.excluded), [['b9'], [], []]);
  assert.deepEqual([s2.median, s2.min, s2.max], [
    { codex: tally(3, 1), codexCodex: tally(4, 1), codexFable: tally(5, 1) },
    { codex: tally(2, 0), codexCodex: tally(4, 1), codexFable: tally(4, 1) },
    { codex: tally(3, 1), codexCodex: tally(4, 1), codexFable: tally(5, 1) },
  ]);
  // Per-triple wall time, pooled over trials: 15 bug triples at 100 and 15 clean at 200 give single Codex a median of 150 (by case it would be 100);
  // Codex+Codex has the same slower member times, Codex+Fable 300.
  assert.deepEqual(s2.wallTimeRatio, { codexCodex: 1, codexFable: 2 });
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
  const doc = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'outcome', 'panel.json'), 'utf8')) as { measures: Measures; keep: ReturnType<typeof keep> };
  const m = doc.measures.stage1;
  assert.deepEqual([m.codex.bugCases, m.codex.union.hits, m.codexCodex.members[1]!.hits, m.codexFable.members[1]!.hits, m.codexCodex.union.hits, m.codexFable.union.hits, m.codexFable.uniqueHits[1], m.codexCodex.uniqueHits[1]], [61, 33, 34, 20, 40, 38, 5, 7]);
  assert.equal(m.excluded.length, 18, '3 Fable bug cases and 15 Fable clean cases have no verdict');
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

test('T1-PANEL-ARMS-REPORT acceptance 4: panel.md has its title, sections and the banned-character rule, and every table value equals its source', () => {
  assert.ok(existsSync(DOC), 'docs/reliability/panel.md exists');
  const doc = lines(readFileSync(DOC, 'utf8'));
  assert.equal(doc[0], '# Review panel');
  assert.deepEqual(doc.filter((l) => l.startsWith('## ')), HEADINGS.map((h) => `## ${h}`));
  assert.deepEqual(doc.filter((l) => /[—「」]/.test(l)), [], 'no em dash and no corner bracket');
  const panel = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'outcome', 'panel.json'), 'utf8')) as unknown;
  const intentRows = lines(readFileSync(path.join(ROOT, 'intent', 'review-panel.md'), 'utf8'));
  const from = intentRows.indexOf('## Existing bench records (read 2026-11-19)');
  const records = intentRows.slice(from, intentRows.findIndex((l, i) => i > from && l.startsWith('## '))).filter((l) => l.startsWith('| `'));
  const bad: string[] = [];
  const bySection = new Map<string, number>();
  let section = '';
  for (const line of doc) {
    if (line.startsWith('## ')) section = line.slice(3);
    if (!line.startsWith('|') || line === HEADER || SEPARATOR.test(line)) continue;
    const cells = line.endsWith('|') ? line.slice(1, -1).split('|').map((c) => c.trim()) : [];
    const source = cells.length === 3 ? /^`([^`]+)`$/.exec(cells[2]!)?.[1] : undefined;
    const value = cells[1] ?? '';
    bySection.set(section, (bySection.get(section) ?? 0) + 1);
    if (source === undefined) { bad.push(`no source: ${line}`); continue; }
    if (source.startsWith('/')) {
      try { if (!equalShown(value, pointerValue(panel, source))) bad.push(`value differs: ${line}`); } catch (e) { bad.push(`${(e as Error).message}: ${line}`); }
      continue;
    }
    const record = records.find((r) => r.split('|')[1]!.includes(`\`${source}\``));
    if (record === undefined) bad.push(`not a record of intent/review-panel.md: ${line}`);
    else if (!new RegExp(`(^|[^\\d.])${value.replace('.', '\\.')}([^\\d.%]|$)`).test(record)) bad.push(`value not in its record: ${line}`);
  }
  assert.deepEqual(bad, [], 'every table row names its source and its value equals it');
  assert.deepEqual(['Earlier records', 'Stage 1', 'Stage 2'].filter((s) => !bySection.get(s)), [], 'Earlier records, Stage 1 and Stage 2 hold rows');
  const s2 = doc.slice(doc.indexOf('## Stage 2'), doc.indexOf('## Keep rule')).join('\n');
  assert.ok(s2.includes('not run') && s2.includes('`/keep/gate/fableUniqueHits`'), 'Stage 2 states not run and the gate value');
});
