// node bench/outcome/panel.ts assemble --commit <sha> [--in <dir>] [--out <file>] (card T1-PANEL-ARMS-REPORT): panel scores of R3
// (single Codex, Codex+Codex, Codex+Fable) from saved bench reports, and the keep rule of intent/review-panel.md, in bench/outcome/panel.json.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSync } from '../../src/probes/exec.ts';

export interface CaseResult { id: string; kind: 'bug' | 'clean'; outcome: 'hit' | 'miss' | 'pass' | 'false-block' | 'no-verdict' | 'error'; durationMs: number; verdictRef?: string; rounds?: Array<{ outcome: CaseResult['outcome']; durationMs: number; cited: number }> }
export interface Tally { hits: number; falseBlocks: number }
export interface Union { cases: number; bugCases: number; cleanCases: number; members: Tally[]; union: Tally; intersection: Tally; uniqueHits: number[]; excluded: string[] }
export interface Panels { codex: Union; codexCodex: Union; codexFable: Union }
type Medians = Record<keyof Panels, Tally>;
export interface Measures { stage1: Panels & { excluded: string[] }; stage2?: { trials: Array<Panels & { excluded: string[] }>; median: Medians; min: Medians; max: Medians; wallTimeRatio: { codexCodex: number; codexFable: number } } }
export interface Keep { stage2: 'run' | 'skip'; gate: { fableUniqueHits: number; fieldOrderUniqueHits: number; threshold: number }; rule: typeof RULE; panel?: 'keep' | 'drop'; member2?: 'fable' | 'codex' }
export interface AssembleInput { commit: string | undefined; hasCommit: (sha: string) => boolean; read: (rel: string) => string | undefined }
interface Report { stage: string; policyHash: string; options?: { formalCommand?: unknown }; trialResults: Array<{ cases: CaseResult[] }> }

/** Decisions of intent/review-panel.md: stage 2 runs only when Fable's unique hits over Codex round 1 are at least 8. */
export const GATE = 8;
/** Keep rule of intent/review-panel.md: panel gain over single Codex, extra false blocks, wall-time ratio; Fable gain over Codex+Codex. */
export const RULE = { panelGain: 7, extraFalseBlocks: 1, wallTimeRatio: 1.5, fableGain: 5 };
const STAGE1 = ['arms/rounds-miss.json', 'arms/order-miss.json', 'panel-arms/fable-miss.json', 'arms/rounds-clean.json', 'arms/order-clean.json', 'panel-arms/fable-clean.json'];
const STAGE2 = ['codex-replay.json', 'fable-replay.json', 'codex-clean.json', 'fable-clean.json'].map((n) => `panel-arms/stage2/${n}`);
const COMPOSITIONS = ['codex', 'codexCodex', 'codexFable'] as const;
const scored = (c: CaseResult): boolean => c.outcome !== 'no-verdict' && c.outcome !== 'error';
const blocked = (c: CaseResult): boolean => c.outcome === 'hit' || c.outcome === 'false-block';

/** R1 without the member count check: the scores of a panel of `members` over the case ids every member holds. */
function combine(members: CaseResult[][]): Union {
  const maps = members.map((m) => new Map(m.map((c) => [c.id, c])));
  const ids = [...maps[0]!.keys()].filter((id) => maps.every((m) => m.has(id)));
  const excluded = ids.filter((id) => maps.some((m) => !scored(m.get(id)!)));
  const kept = ids.filter((id) => !excluded.includes(id)).map((id) => maps.map((m) => m.get(id)!));
  const count = (rows: CaseResult[][], pick: (row: CaseResult[]) => boolean): Tally => ({ hits: rows.filter((r) => r[0]!.kind === 'bug' && pick(r)).length, falseBlocks: rows.filter((r) => r[0]!.kind === 'clean' && pick(r)).length });
  const bugCases = kept.filter((r) => r[0]!.kind === 'bug').length;
  return {
    cases: kept.length, bugCases, cleanCases: kept.length - bugCases,
    members: maps.map((_, i) => count(kept, (r) => blocked(r[i]!))),
    union: count(kept, (r) => r.some(blocked)),
    intersection: count(kept, (r) => r.every(blocked)),
    uniqueHits: maps.map((_, i) => count(kept, (r) => blocked(r[i]!) && r.every((c, j) => j === i || !blocked(c))).hits),
    excluded,
  };
}
export function unionOf(members: CaseResult[][]): Union {
  if (members.length < 2) throw new Error('unionOf takes two or more members');
  return combine(members);
}

/** The three compositions on the cases every one of the three reviews scored: `excluded` lists the rest. */
function compositions(codex: CaseResult[], second: CaseResult[], fable: CaseResult[]): Panels & { excluded: string[] } {
  const excluded = combine([codex, second, fable]).excluded, drop = (m: CaseResult[]) => m.filter((c) => !excluded.includes(c.id));
  return { excluded, codex: combine([drop(codex)]), codexCodex: combine([drop(codex), drop(second)]), codexFable: combine([drop(codex), drop(fable)]) };
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b), h = Math.floor(s.length / 2); return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2; };
/**
 * Per triple (cases that share the first member's verdict file; the bench gives every case of a triple the duration of its one
 * review), the wall time of the slowest member, over every trial. A triple with a no-verdict case counts: the decision took that time.
 */
function tripleTimes(trials: CaseResult[][][]): number[] {
  return trials.flatMap((members) => [...new Map(members[0]!.map((c) => [path.basename(c.verdictRef ?? c.id), Math.max(...members.map((m) => m.find((x) => x.id === c.id)?.durationMs ?? 0))])).values()]);
}

/** R4: the stage gate and, with stage 2 measures, the keep rule as the owner accepted it. */
export function keep(m: Measures): Keep {
  const gate = { fableUniqueHits: m.stage1.codexFable.uniqueHits[1]!, fieldOrderUniqueHits: m.stage1.codexCodex.uniqueHits[1]!, threshold: GATE };
  if (gate.fableUniqueHits < GATE) return { stage2: 'skip', gate, rule: RULE };
  if (!m.stage2) return { stage2: 'run', gate, rule: RULE };
  const { median: md, wallTimeRatio } = m.stage2;
  const member2 = md.codexFable.hits - md.codexCodex.hits >= RULE.fableGain && md.codexFable.falseBlocks - md.codexCodex.falseBlocks <= RULE.extraFalseBlocks ? 'fable' : 'codex';
  const better = member2 === 'fable' ? 'codexFable' : 'codexCodex';
  const panel = md[better].hits - md.codex.hits >= RULE.panelGain && md[better].falseBlocks - md.codex.falseBlocks <= RULE.extraFalseBlocks && wallTimeRatio[better] <= RULE.wallTimeRatio ? 'keep' : 'drop';
  return { stage2: 'run', gate, rule: RULE, panel, member2 };
}

/** Reads and checks the reports `names` (Fable when the name says so), paired in runs of `group` that must hold the same case ids; a refusal string, or the parsed reports. */
function load(read: AssembleInput['read'], names: string[], group: number): string | Report[] {
  const reports: Report[] = [];
  for (const name of names) {
    const text = read(name);
    if (text === undefined) return `${name}: missing`;
    let r: Report;
    try { r = JSON.parse(text) as Report; if (!Array.isArray(r.trialResults)) throw new Error('no trialResults'); } catch (err) { return `${name}: unparsable (${(err as Error).message})`; }
    const fable = name.includes('fable');
    if (r.stage !== 'formal') return `${name}: stage ${r.stage} is not formal`;
    if (fable && r.options?.formalCommand === undefined) return `${name}: a Fable report without options.formalCommand`;
    if (!fable && r.options?.formalCommand !== undefined) return `${name}: a Codex report with options.formalCommand`;
    reports.push(r);
  }
  if (new Set(reports.map((r) => r.policyHash)).size !== 1) return `${names.join(', ')}: the policy hashes differ`;
  const ids = (r: Report): string => r.trialResults.flatMap((t) => t.cases.map((c) => c.id).sort()).join();
  for (let i = 0; i < names.length; i += group) if (!reports.slice(i, i + group).every((r) => ids(r) === ids(reports[i]!))) return `${names.slice(i, i + group).join(', ')}: the case ids differ`;
  return reports;
}

export function assemble(input: AssembleInput, write: (text: string) => void): { refusal: string } | undefined {
  if (input.commit === undefined || !input.hasCommit(input.commit)) return { refusal: `--commit ${input.commit ?? '(missing)'} is not a commit of this repository` };
  const one = load(input.read, STAGE1, 3);
  if (typeof one === 'string') return { refusal: one };
  // Codex round 1 is `rounds[0]` of the three-round run.
  const round1 = (cs: CaseResult[]): CaseResult[] => cs.map((c) => (c.rounds?.length ? { ...c, outcome: c.rounds[0]!.outcome, durationMs: c.rounds[0]!.durationMs } : c));
  const [rm, om, fm, rc, oc, fc] = one.map((r) => r.trialResults[0]!.cases);
  const measures: Measures = { stage1: compositions(round1([...rm!, ...rc!]), [...om!, ...oc!], [...fm!, ...fc!]) };
  const hashes: Record<string, string> = Object.fromEntries(STAGE1.map((n) => [n, createHash('sha256').update(input.read(n)!, 'utf8').digest('hex')]));
  const policyHash: Record<string, string> = { stage1: one[0]!.policyHash };
  if (keep(measures).stage2 === 'run' && STAGE2.some((n) => input.read(n) !== undefined)) {
    const two = load(input.read, STAGE2, 2);
    if (typeof two === 'string') return { refusal: two };
    if (two.some((r) => r.trialResults.length !== 3)) return { refusal: 'a stage 2 report is not three trials' };
    const [cr, fr, cc, fcl] = two;
    const codex = [0, 1, 2].map((t) => [...cr!.trialResults[t]!.cases, ...cc!.trialResults[t]!.cases]);
    const fable = [0, 1, 2].map((t) => [...fr!.trialResults[t]!.cases, ...fcl!.trialResults[t]!.cases]);
    // Codex+Codex in trial t pairs Codex trial t with Codex trial t+1 (mod 3): every panel makes two calls per triple.
    const trials = [0, 1, 2].map((t) => compositions(codex[t]!, codex[(t + 1) % 3]!, fable[t]!));
    const stat = (f: (xs: number[]) => number): Medians => Object.fromEntries(COMPOSITIONS.map((k) => [k, { hits: f(trials.map((t) => t[k].union.hits)), falseBlocks: f(trials.map((t) => t[k].union.falseBlocks)) }])) as Medians;
    const time = (members: (t: number) => CaseResult[][]): number => median(tripleTimes([0, 1, 2].map(members)));
    const single = time((t) => [codex[t]!]), ratio = (n: number): number => n / single;
    measures.stage2 = {
      trials, median: stat(median), min: stat((xs) => Math.min(...xs)), max: stat((xs) => Math.max(...xs)),
      wallTimeRatio: { codexCodex: ratio(time((t) => [codex[t]!, codex[(t + 1) % 3]!])), codexFable: ratio(time((t) => [codex[t]!, fable[t]!])) },
    };
    for (const n of STAGE2) hashes[n] = createHash('sha256').update(input.read(n)!, 'utf8').digest('hex');
    policyHash.stage2 = two[0]!.policyHash;
  }
  write(`${JSON.stringify({ commit: input.commit, policyHash, inputs: hashes, measures, keep: keep(measures) }, null, 2)}\n`);
  return undefined;
}

function main(argv: string[]): number {
  const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
  const arg = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i > 0 ? argv[i + 1] : undefined; };
  if (argv[0] !== 'assemble') { process.stderr.write('panel: usage: node bench/outcome/panel.ts assemble --commit <sha> [--in <dir>] [--out <file>]\n'); return 1; }
  const dir = path.resolve(arg('--in') ?? path.join(root, '_local')), out = path.resolve(arg('--out') ?? path.join(here, 'panel.json'));
  const read = (rel: string): string | undefined => (existsSync(path.join(dir, rel)) ? readFileSync(path.join(dir, rel), 'utf8') : undefined);
  const hasCommit = (sha: string): boolean => runSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root }).exitCode === 0;
  const result = assemble({ commit: arg('--commit'), hasCommit, read }, (text) => writeFileSync(out, text));
  if (result) process.stderr.write(`panel: ${result.refusal}\n`);
  return result ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (err) { process.stderr.write(`panel: ${(err as Error).message}\n`); process.exitCode = 1; }
}
