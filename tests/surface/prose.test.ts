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
 * Where one sentence ends and the next begins, read case-sensitively: `.`, `!` or `?`, any closing quotes or brackets,
 * whitespace and a capital letter (so e.g., i.e., etc. or an ellipsis before a lowercase word stay inside the sentence); a
 * blank line; or a new list item.
 */
const SENTENCE_BREAK = /[.!?]["')\]]*\s+(?=[A-Z])|\n[ \t\r]*\n|\n[ \t]*(?:[-*+]|\d+[.)])\s/;
/** "subagent" in each spelling and spacing, singular or plural. */
const SUBAGENT = String.raw`sub(?:-|\s+)?agents?`;
const SUBAGENT_TO_VERIFY = new RegExp(String.raw`${SUBAGENT}\s+to\s+verify`, 'i');
const WITH_SUBAGENT = new RegExp(String.raw`with\s+(?:a\s+)?${SUBAGENT}`, 'i');

/** "use a subagent to verify", or "verify" (verifying too) and a later "with a subagent" with no sentence break between them. */
function verifiesWithSubagent(text: string): boolean {
  if (SUBAGENT_TO_VERIFY.test(text)) return true;
  for (const verify of text.matchAll(/verify/gi)) {
    const rest = text.slice(verify.index + verify[0].length);
    const tool = WITH_SUBAGENT.exec(rest);
    if (!tool) return false;
    // The first letter of the phrase comes along: a capital there starts a new sentence.
    if (!SENTENCE_BREAK.test(rest.slice(0, tool.index + 1))) return true;
  }
  return false;
}

/**
 * Instructions the Opus 5 and 5.5 guides say to remove from agent prompts (T1-OPUS55-PROMPTS R8): a request to
 * double-check or re-verify the answer, "think carefully", "think step by step", "use a subagent to verify", and the
 * review limits "be conservative" and "only report high-severity" (T1-PROMPT-CHECK-2 R5 widened three of them).
 */
const REMOVED_INSTRUCTIONS: Array<[string, { test(text: string): boolean }]> = [
  ['double-check', /double(?:-|\s+)?check/i],
  ['re-verify', /re-?verify|\bre\s+verify|verify\s+again/i],
  ['think carefully', /think\s+(?:very\s+)?carefully/i],
  ['think step by step', /think\s+step(?:-|\s+)by(?:-|\s+)step/i],
  // "verify ... with a subagent" with any number of words between, inside one sentence.
  ['use a subagent to verify', { test: verifiesWithSubagent }],
  ['be conservative', /(?:be|stay)\s+conservative|\b(?:be|stay)\s+(?:(?:very|more|even|extra)\s+){1,2}conservative/i],
  ['only report high-severity', /(?:only\s+report|report\s+only)\s+(?:the\s+)?high(?:-|\s+)severity/i],
];

/** The instructions of REMOVED_INSTRUCTIONS that `text` carries; words may be separated by any whitespace, a line break included. */
export function removedInstructions(text: string): string[] {
  return REMOVED_INSTRUCTIONS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Every agent and skill file, both copies, and the review policy the prompts carry (both copies). */
const PROMPT_FILES: string[] = [...markdownFiles(path.join(root, '.claude', 'agents'), true), ...markdownFiles(path.join(root, '.claude', 'skills'), true), ...markdownFiles(path.join(root, 'templates', 'claude'), true), path.join(root, 'REVIEW.md'), path.join(root, 'templates', 'REVIEW.md')];

/** The review prompts buildReviewPrompt writes, every stage and angle, with this repository's REVIEW.md as the policy, plus the angle texts themselves. */
function reviewPromptTexts(): string[] {
  const card = { id: 'T1-X', title: 't', allow_paths: ['src/x.ts'], tdd: true, dod_command: 'npm test', acceptance: ['1. x. [dod arm 1]'] } as unknown as Card;
  const input = { reviewPolicy: readFileSync(path.join(root, 'REVIEW.md'), 'utf8'), card, base: 'main', head: 'h', changedPaths: ['src/x.ts'], diff: '+x\n', priorFindings: [], round: 1, maxRounds: 2, includeDiff: true };
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

  test('removedInstructions catches each word order and spelling of an instruction the guides say to remove [R8]', () => {
    const cases: Array<[string, string]> = [
      ['Double-check your work.', 'double-check'],
      ['Double check your work.', 'double-check'],
      ['Doublecheck your work.', 'double-check'],
      ['Re-verify the result.', 're-verify'],
      ['Reverify the result.', 're-verify'],
      ['Then verify again.', 're-verify'],
      ['Think carefully about it.', 'think carefully'],
      ['Think very carefully about it.', 'think carefully'],
      ['Think step by step.', 'think step by step'],
      ['Think step-by-step.', 'think step by step'],
      ['Use a subagent to verify the answer.', 'use a subagent to verify'],
      ['Verify the answer with a subagent.', 'use a subagent to verify'],
      ['Be conservative.', 'be conservative'],
      ['Stay conservative.', 'be conservative'],
      ['Only report high-severity issues.', 'only report high-severity'],
      ['Report only high-severity issues.', 'only report high-severity'],
      ['Report only the high severity issues.', 'only report high-severity'],
    ];
    for (const [text, name] of cases) assert.deepEqual(removedInstructions(text), [name], text);
  });

  test('T1-PROMPT-CHECK-2 acceptance 2: removedInstructions catches the phrasings the T1-OPUS55-PROMPTS reviews found missing [R5]', () => {
    const cases: Array<[string, string]> = [
      ['Be very conservative.', 'be conservative'],
      ['Be more conservative.', 'be conservative'],
      ['Stay more conservative.', 'be conservative'],
      ['Stay very conservative.', 'be conservative'],
      ['Be even more conservative.', 'be conservative'],
      ['Be extra conservative.', 'be conservative'],
      ['Be very\nconservative.', 'be conservative'],
      ['Re verify the result.', 're-verify'],
      ['Re\nverify the result.', 're-verify'],
      ['Verify every step of the result with a subagent.', 'use a subagent to verify'],
      ['Verify src/a.ts and every other changed file of the candidate, line by line, with a subagent.', 'use a subagent to verify'],
      ['Verify the answer\nwith a subagent.', 'use a subagent to verify'],
      ['Verify the change from version\n1.5 to 2.0 with a subagent.', 'use a subagent to verify'],
      // R3 decision 1: an abbreviation or an ellipsis before a lowercase word is inside the sentence, as the old pattern read it.
      ['Verify e.g. the diff with a subagent.', 'use a subagent to verify'],
      ['Verify i.e. the diff with a subagent.', 'use a subagent to verify'],
      ['Verify the diff etc. with a subagent.', 'use a subagent to verify'],
      ['Verify the result... with a subagent.', 'use a subagent to verify'],
      ['Verify it. then run the tests with a subagent.', 'use a subagent to verify'],
      ['Verify it. Then verify the diff with a subagent.', 'use a subagent to verify'],
      ['Verify, with a subagent, the diff.', 'use a subagent to verify'],
      ['Try verifying the output with a subagent.', 'use a subagent to verify'],
      ['Verify the answer with a sub-agent.', 'use a subagent to verify'],
      ['Verify the answer with a sub agent.', 'use a subagent to verify'],
      ['Verify the answers with subagents.', 'use a subagent to verify'],
      ['Use a sub-agent to verify the answer.', 'use a subagent to verify'],
      ['Use subagents to verify the answers.', 'use a subagent to verify'],
    ];
    for (const [text, name] of cases) assert.deepEqual(removedInstructions(text), [name], text);
  });

  test('T1-PROMPT-CHECK-2 acceptance 2: a verify and a with a subagent in two sentences, paragraphs or list items stay clean, and so do look-alike words [R5]', () => {
    const clean = [
      'Verify it. Then with a subagent, run the tests.',
      'Verify it. With a subagent, run the tests.',
      'Verify it.  Then run the tests with a subagent.',
      '"Verify it." Then run the tests with a subagent.',
      "'Verify it.' Then run the tests with a subagent.",
      '(Verify it.) Then run the tests with a subagent.',
      '[Verify it.] Then run the tests with a subagent.',
      'Verify the output\r\n\r\nRun the tests with a subagent',
      'Verify the output! Run the tests with a subagent.',
      'Verify the output?\nRun the tests with a subagent.',
      'Verify the output\n\nRun the tests with a subagent',
      'Verify the output\n \t\nRun the tests with a subagent',
      '- verify the output\n- run the tests with a subagent',
      '  - verify the output\n  - run the tests with a subagent',
      '* verify the output\n+ run the tests with a subagent',
      '+ verify the output\n* run the tests with a subagent',
      '1) verify the output\n2) run the tests with a subagent',
      'Where verify steps run, nothing changes.',
      'Maybe more conservative estimates hold.',
    ];
    for (const text of clean) assert.deepEqual(removedInstructions(text), [], text);
  });

  test('acceptance 5: no agent, skill, REVIEW.md or review prompt carries an instruction the guides say to remove [R8]', () => {
    assert.ok(PROMPT_FILES.length >= 20, `agent and skill files resolved to ${PROMPT_FILES.length}`);
    for (const policy of ['REVIEW.md', path.join('templates', 'REVIEW.md')]) assert.ok(PROMPT_FILES.includes(path.join(root, policy)), `${policy} is scanned`);
    assert.ok(reviewPromptTexts().every((text, i) => i < Object.keys(PERSPECTIVES).length || text.includes(readFileSync(path.join(root, 'REVIEW.md'), 'utf8').trim())), 'the prompts carry the real REVIEW.md');
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

  test('T1-PROMPT-CHECK-2 acceptance 3: CHANGELOG.md Unreleased carries the entry, every sentence of it [R4] [R5]', () => {
    const changelog = read('CHANGELOG.md').replace(/\r\n/g, '\n');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const sentences = [
      '- End-of-turn wording and removed-instruction patterns, card T1-PROMPT-CHECK-2: the end-of-turn line of every R2 and R3 prompt and the end-of-turn rule in `docs/OPERATIONS.md` now say that a note after the verdict line is ignored only when it contains no JSON, since the reader takes the last JSON document that parses; `docs/OPERATIONS.md` said that any note after the verdict line is ignored.',
      '`removedInstructions` (`tests/surface/prose.test.ts`) also catches "be very conservative", "be more conservative", "stay more conservative", "re verify" and "verify ... with a subagent" with any number of words between, and "subagent" spelled "sub-agent" or "sub agent", each with a self-test case.',
      'A "verify" and a "with a subagent" in two sentences, paragraphs or list items no longer match, where the old pattern matched across a sentence end within three words; a sentence ends at `.`, `!` or `?`, after any closing quote or bracket, followed by whitespace and a capital letter, so e.g., i.e., etc. or an ellipsis before a lowercase word stay inside one sentence.',
    ];
    for (const sentence of sentences) assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
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
    // The note rule sentence is T1-PROMPT-CHECK-2's (acceptance 1): it replaced the parenthesis that said any note after the verdict line is ignored.
    assert.ok(read('docs', 'OPERATIONS.md').split(/\r?\n/).includes('End-of-turn rule (card T1-OPUS55-PROMPTS): every review prompt and the reviewer agent say that the reply ends with the verdict JSON line and that a progress note, a summary that announces a next step or an offer to continue is not the end of the review; a headless reviewer whose reply ends on such a note with no verdict line before it has returned no verdict, which spends a no-verdict retry. Every review prompt says that a note after the verdict line is ignored only when it contains no JSON, since the reader takes the last JSON document that parses: a JSON document in the note is read instead of the verdict, and one that does not parse leaves no verdict (card T1-PROMPT-CHECK-2). The R2 prompt also asks for every finding the reviewer can defend: its block rule decides only whether a finding blocks, not whether it is reported.'));
    // In the formal review section: after its heading, before the placeholder paragraph and the next section.
    const ops = read('docs', 'OPERATIONS.md');
    const at = ops.indexOf('\n' + 'End-of-turn rule (card T1-OPUS55-PROMPTS): every review prom');
    const section = ops.indexOf('\n### Formal review (R3) as a command\n');
    assert.ok(section >= 0 && at > section, 'after the formal review heading');
    assert.ok(at < ops.indexOf('\nPlaceholders in argv:', section), 'before the placeholder paragraph');
    assert.ok(at < ops.indexOf('\n### ', section + 1), 'before the next section');
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    // The whole entry this card adds, every clause of it.
    assert.ok(unreleased.split(/\r?\n/).includes('- Review and agent prompts for Opus 5.5, card T1-OPUS55-PROMPTS: every R2 and R3 prompt and the reviewer agent end the turn only on the verdict JSON line; a progress note, a summary that announces a next step or an offer to continue is not the end of the review, and a reply that ends on one with no verdict line before it has returned no verdict. The R2 prompt asks for every finding the reviewer can defend and says its block rule decides only whether a finding blocks. The implementer agent ends its turn only with the report or a named blocker, and `arc.md` gives a child the elapsed time against its deadline (`elapsed <s> / <s>`). `tests/surface/prose.test.ts` keeps every agent, skill, `REVIEW.md` and review prompt free of the instructions the Opus 5 and 5.5 guides say to remove (double-check or re-verify, "think carefully", "think step by step", "use a subagent to verify", "be conservative", "only report high-severity", each in the word orders and spellings the test lists).'));
  });
});
