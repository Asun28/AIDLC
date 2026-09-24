import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSPECTIVES, buildReviewPrompt } from '../../src/review/pre-review.ts';
import type { Card } from '../../src/core/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** Characters the writing rule (CLAUDE.md, Writing density) bans in prose: the em dash and the CJK corner brackets. */
const BANNED = /[—「」]/u;

/** 1-based line numbers of `text` that carry a banned character. */
export function bannedProse(text: string): number[] {
  const hits: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (BANNED.test(line)) hits.push(i + 1);
  });
  return hits;
}

/** Markdown files under `dir`, one level or recursive; a missing directory yields none. */
function markdownFiles(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...markdownFiles(abs, true));
    } else if (entry.name.endsWith('.md')) out.push(abs);
  }
  return out.sort();
}

/** Tracked prose. `docs/plans/**` (archived plan documents) is out of scope. Planning scratch files at the root are gitignored and not listed. */
const SCOPE: string[] = [
  ...['CLAUDE.md', 'README.md', 'REVIEW.md', 'CHANGELOG.md'].map((f) => path.join(root, f)),
  ...markdownFiles(path.join(root, 'docs'), false),
  ...markdownFiles(path.join(root, 'docs', 'adr'), true),
  ...markdownFiles(path.join(root, 'docs', 'references'), true),
  ...markdownFiles(path.join(root, 'templates'), true),
  ...markdownFiles(path.join(root, '.claude'), true),
  ...markdownFiles(path.join(root, 'specs'), true),
  ...markdownFiles(path.join(root, 'intent'), false),
  ...markdownFiles(path.join(root, 'plans'), false),
];

describe('prose (writing density)', () => {
  test('bannedProse flags an em dash and corner brackets and passes plain punctuation', () => {
    assert.deepEqual(bannedProse('a — b'), [1]);
    assert.deepEqual(bannedProse('first\n「quoted」\nthird'), [2]);
    assert.deepEqual(bannedProse('plain, with a hyphen - a colon: and "quotes"'), []);
  });

  test('tracked prose carries no em dash and no corner brackets', () => {
    assert.ok(SCOPE.length >= 20, `scope resolved to ${SCOPE.length} files`);
    const offenders: string[] = [];
    for (const file of SCOPE) {
      const lines = bannedProse(readFileSync(file, 'utf8'));
      if (lines.length) offenders.push(`${path.relative(root, file).split(path.sep).join('/')}:${lines.join(',')}`);
    }
    assert.deepEqual(offenders, [], `banned characters (em dash or corner brackets) in: ${offenders.join(' ')}`);
  });
});

/**
 * Instructions the Opus 5 and 5.5 guides say to remove from agent prompts (T1-OPUS55-PROMPTS R8): a request to
 * double-check or re-verify the answer, "think carefully", "think step by step", "use a subagent to verify", and the
 * review limits "be conservative" and "only report high-severity".
 */
const REMOVED_INSTRUCTIONS: Array<[string, RegExp]> = [
  ['double-check', /double(?:-|\s+)check/i],
  ['re-verify', /re-?verify/i],
  ['think carefully', /think\s+carefully/i],
  ['think step by step', /think\s+step\s+by\s+step/i],
  ['use a subagent to verify', /subagent\s+to\s+verify/i],
  ['be conservative', /be\s+conservative/i],
  ['only report high-severity', /only\s+report\s+high(?:-|\s+)severity/i],
];

/** The instructions of REMOVED_INSTRUCTIONS that `text` carries; words may be separated by any whitespace, a line break included. */
export function removedInstructions(text: string): string[] {
  return REMOVED_INSTRUCTIONS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Every agent and skill file, both copies. */
const PROMPT_FILES: string[] = [...markdownFiles(path.join(root, '.claude', 'agents'), true), ...markdownFiles(path.join(root, '.claude', 'skills'), true), ...markdownFiles(path.join(root, 'templates', 'claude'), true)];

/** The review prompts buildReviewPrompt writes, every stage and angle, plus the angle texts themselves. */
function reviewPromptTexts(): string[] {
  const card = { id: 'T1-X', title: 't', allow_paths: ['src/x.ts'], tdd: true, dod_command: 'npm test', acceptance: ['1. x. [dod arm 1]'] } as unknown as Card;
  const input = { reviewPolicy: 'policy', card, base: 'main', head: 'h', changedPaths: ['src/x.ts'], diff: '+x\n', priorFindings: [], round: 1, maxRounds: 2, includeDiff: true };
  const out: string[] = Object.values(PERSPECTIVES);
  for (const stage of ['pre', 'formal'] as const) for (const perspective of [undefined, ...Object.keys(PERSPECTIVES)]) out.push(buildReviewPrompt({ ...input, stage, perspective, coverage: true }));
  return out;
}

/** `text` with every run of whitespace folded to one space, so a sentence wrapped over lines reads as one. */
const flat = (text: string) => text.replace(/\s+/g, ' ');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

describe('Opus 5 and 5.5 guide changes (T1-OPUS55-PROMPTS)', () => {
  test('removedInstructions flags each removed instruction, whatever the case, and passes the review wording in use', () => {
    assert.deepEqual(removedInstructions('Please Double-check your answer'), ['double-check']);
    assert.deepEqual(removedInstructions('re-verify it; reverify it'), ['re-verify']);
    assert.deepEqual(removedInstructions('Think carefully. Think step by step.'), ['think carefully', 'think step by step']);
    assert.deepEqual(removedInstructions('use a subagent to verify the result'), ['use a subagent to verify']);
    assert.deepEqual(removedInstructions('Be conservative and only report high-severity issues'), ['be conservative', 'only report high-severity']);
    // An instruction wrapped across a line break, as Markdown prose wraps, is still the instruction.
    assert.deepEqual(removedInstructions('you should double\ncheck, think\n  step by\nstep, use a subagent\n  to verify, be\nconservative and only report\nhigh severity findings'), ['double-check', 'think step by step', 'use a subagent to verify', 'be conservative', 'only report high-severity']);
    assert.deepEqual(removedInstructions('report every material finding you can defend'), []);
  });

  test('acceptance 5: no agent, skill or review prompt carries an instruction the guides say to remove [R8]', () => {
    assert.ok(PROMPT_FILES.length >= 20, `agent and skill files resolved to ${PROMPT_FILES.length}`);
    const offenders: string[] = [];
    for (const file of PROMPT_FILES) {
      const hits = removedInstructions(readFileSync(file, 'utf8'));
      if (hits.length) offenders.push(`${path.relative(root, file).split(path.sep).join('/')}: ${hits.join(', ')}`);
    }
    reviewPromptTexts().forEach((text, i) => {
      const hits = removedInstructions(text);
      if (hits.length) offenders.push(`review prompt ${i}: ${hits.join(', ')}`);
    });
    assert.deepEqual(offenders, []);
  });

  test('acceptance 3: the reviewer agent ends its turn only on the verdict line, as a numbered procedure step [R7]', () => {
    assert.ok(flat(read('.claude', 'agents', 'reviewer.md')).includes('8. End your turn with the JSON verdict line: a progress note, a summary that announces a next step or an offer to continue is not the end of the review.'));
  });

  test('acceptance 3: the implementer agent ends its turn only with the report or a named blocker [R8]', () => {
    assert.ok(flat(read('.claude', 'agents', 'implementer.md')).includes('Your turn ends only with the report or a named blocker, never with a summary that announces the next step without taking it.'));
  });

  test('acceptance 4: arc.md lists the elapsed time against the deadline among the inputs a child receives [R8]', () => {
    assert.ok(flat(read('.claude', 'skills', 'aidlc-loop', 'arc.md')).includes('deadline, the elapsed time against it (`elapsed <s> / <s>`), owner generation'));
  });

  test('acceptance 6: docs/OPERATIONS.md names the end-of-turn rule and CHANGELOG.md Unreleased carries the entry [R7]', () => {
    // The whole paragraph this card adds, every sentence of it.
    assert.ok(read('docs', 'OPERATIONS.md').split(/\r?\n/).includes('End-of-turn rule (card T1-OPUS55-PROMPTS): every review prompt and the reviewer agent say that the reply ends with the verdict JSON line and that a progress note, a summary that announces a next step or an offer to continue is not the end of the review; a headless reviewer whose turn ends on one has returned no verdict, which spends a no-verdict retry. The R2 prompt also asks for every finding the reviewer can defend: its block rule decides only whether a finding blocks, not whether it is reported.'));
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    // The whole entry this card adds, every clause of it.
    assert.ok(unreleased.split(/\r?\n/).includes('- Review and agent prompts for Opus 5.5, card T1-OPUS55-PROMPTS: every R2 and R3 prompt and the reviewer agent end the turn only on the verdict JSON line; a progress note, a summary that announces a next step or an offer to continue is not the end of the review. The R2 prompt asks for every finding the reviewer can defend and says its block rule decides only whether a finding blocks. The implementer agent ends its turn only with the report or a named blocker, and `arc.md` gives a child the elapsed time against its deadline (`elapsed <s> / <s>`). `tests/surface/prose.test.ts` keeps every agent, skill and review prompt free of the instructions the Opus 5 and 5.5 guides say to remove (double-check or re-verify, "think carefully", "think step by step", "use a subagent to verify", "be conservative", "only report high-severity").'));
  });
});
