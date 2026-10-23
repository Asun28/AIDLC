import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvalCase } from '../../src/evals/runner.ts';
import { DeliveryOpsConfig } from '../../src/delivery/ops.ts';
import { ProjectConfig } from '../../src/config.ts';
import { parseBandsYaml } from '../../src/maintain/bands.ts';
import { parseCardText } from '../../src/artifacts/card.ts';
import { parseIntent } from '../../src/artifacts/intent.ts';
import { templatesDir } from '../../src/scaffold/init.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tpl = path.join(root, 'templates');

/** Plan v5 §4: measured full-file caps for the five lazy modules (R40-R45, Q14). */
const CAPS: Record<string, number> = { 'SKILL.md': 4500, 'card-loop.md': 6500, 'arc.md': 4500, 'release.md': 4500, 'migrate.md': 3000 };

describe('templates (Q14 packaging)', () => {
  test('templatesDir resolves to the repository templates', () => {
    assert.equal(path.resolve(templatesDir()), path.resolve(tpl));
  });

  test('the five aidlc-loop skill files exist, are ASCII and stay under their measured caps', () => {
    for (const [name, cap] of Object.entries(CAPS)) {
      const file = path.join(tpl, 'claude', 'skills', 'aidlc-loop', name);
      assert.ok(existsSync(file), `${name} missing`);
      const bytes = statSync(file).size;
      assert.ok(bytes <= cap, `${name} is ${bytes} bytes > cap ${cap}`);
      const text = readFileSync(file, 'utf8');
      assert.ok(!/[^\x00-\x7F]/.test(text), `${name} must be ASCII so bytes == chars`);
      assert.ok(/aidlc (next|report|card|goal|release|board|audit|migrate|ops|op|cards|evidence)/.test(text), `${name} must route state changes through the aidlc CLI`);
    }
    const skill = readFileSync(path.join(tpl, 'claude', 'skills', 'aidlc-loop', 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: aidlc-loop\n/);
  });

  test('every safeguard owner module names its rule', () => {
    const read = (n: string) => readFileSync(path.join(tpl, 'claude', 'skills', 'aidlc-loop', n), 'utf8');
    assert.match(read('card-loop.md'), /3 ?h|three hours|3-hour/i);
    assert.match(read('card-loop.md'), /(missing|malformed|stale)[^.]*verdict[^.]*never\s+pass/i);
    assert.match(read('card-loop.md'), /one retry/i);
    assert.match(read('arc.md'), /12 ?h|twelve hours|12-hour/i);
    assert.match(read('arc.md'), /two workers|cap (?:of )?two|at most two/i);
    assert.match(read('release.md'), /NOT CONFIGURED/);
    assert.match(read('release.md'), /INSUFFICIENT_DATA/);
    assert.match(read('release.md'), /recovered/);
    assert.match(read('migrate.md'), /contract/);
    assert.match(read('migrate.md'), /UNKNOWN/);
  });

  test('agents carry name/description/tools frontmatter and the reviewer is read-only', () => {
    for (const name of ['verifier', 'reviewer', 'planner', 'implementer', 'investigator', 'release-specialist']) {
      const text = readFileSync(path.join(tpl, 'claude', 'agents', `${name}.md`), 'utf8');
      assert.match(text, /^---\nname: /, `${name} frontmatter`);
      assert.match(text, /\ndescription: /, `${name} description`);
      assert.match(text, /\ntools: /, `${name} tools`);
    }
    const reviewer = readFileSync(path.join(tpl, 'claude', 'agents', 'reviewer.md'), 'utf8');
    const tools = reviewer.match(/\ntools: (.*)/)?.[1] ?? '';
    assert.ok(!/Edit|Write|Bash/.test(tools), `reviewer must not have write tools: ${tools}`);
  });

  test('settings.json wires one dispatcher process per event (PreToolUse, Stop, UserPromptSubmit) and denies secret reads', () => {
    const settings = JSON.parse(readFileSync(path.join(tpl, 'claude', 'settings.json'), 'utf8')) as { permissions: { deny: string[] }; hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> };
    for (const event of ['PreToolUse', 'Stop', 'UserPromptSubmit']) {
      const commands = (settings.hooks[event] ?? []).flatMap((h) => h.hooks.map((x) => x.command));
      assert.equal(commands.length, 1, `${event} must run exactly one hook process per call: ${commands.join(', ') || 'none'}`);
      assert.match(commands[0]!, /aidlc hook auto$/, `${event} must call the dispatcher`);
    }
    const matcher = settings.hooks['PreToolUse']![0]!.matcher ?? '';
    for (const tool of ['Bash', 'Edit', 'Write', 'MultiEdit']) assert.ok(matcher.split('|').includes(tool), `PreToolUse matcher must include ${tool}: ${matcher}`);
    assert.ok(settings.permissions.deny.length >= 18);
    assert.ok(settings.permissions.deny.some((d) => d.includes('.env')));
    assert.ok(settings.hooks['Stop']?.length, 'Stop hook missing');
  });

  test('the secret scan is a gate: both copies of security-scanners.yml are identical and carry no continue-on-error', () => {
    const live = readFileSync(path.join(root, '.github', 'workflows', 'security-scanners.yml'), 'utf8');
    const template = readFileSync(path.join(tpl, 'github', 'workflows', 'security-scanners.yml'), 'utf8');
    assert.equal(live, template);
    assert.ok(live.includes('name: Gitleaks (committed history)'), 'the check-run name the ship gate and the config refer to');
    assert.ok(!live.includes('continue-on-error'), 'the gitleaks step must block the job');
  });

  test('the CI gate docs state the security class, the github config block and the changelog entry (T1-LOOP-GATES-2 acceptance 6)', () => {
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.ok(architecture.includes('the `security` class, keyed off a failing check-run name that matches a secret or security scan or off raw gitleaks output, is STOP/risk and never reruns'), 'outcome map names the security class');
    assert.ok(architecture.includes('The `github` config block (`requiredChecks`, `requireVerdict`, `ciTimeoutMs`, `ciPollMs`) reaches the path through `shipPathFor`'), 'ship path bullet names the config block');
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    assert.ok(operations.includes('`github.requiredChecks|requireVerdict|ciTimeoutMs|ciPollMs` (see Ship gates)'), 'config keys list the github block');
    assert.ok(operations.includes('## Ship gates (GitHub ship path)'), 'the ship gates section exists');
    assert.ok(operations.includes('it may be false only while `gateRequired` is false'), 'the waived verdict rule is documented');
    assert.ok(operations.includes('| `risk` | secrets or license gates tripped, a red secret or security scan in CI, or a high-risk operation refused |'), 'the STOP table names the red scan');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## ', changelog.indexOf('## Unreleased') + 1));
    assert.ok(unreleased.includes('CI gates in the loop, card T1-LOOP-GATES'), 'the Unreleased section carries the entry');
    assert.ok(unreleased.includes('a block verdict for the candidate fails the ship even when the requirement is waived'), 'the entry records the never-waived block verdict');
  });
  test('JSON/YAML templates validate against the runtime schemas', () => {
    EvalCase.parse(JSON.parse(readFileSync(path.join(tpl, 'evals', 'example-regression.json'), 'utf8')));
    DeliveryOpsConfig.parse(JSON.parse(readFileSync(path.join(tpl, 'aidlc.ops.example.json'), 'utf8')));
    ProjectConfig.parse(JSON.parse(readFileSync(path.join(tpl, 'aidlc.config.json'), 'utf8')));
    const bands = parseBandsYaml(readFileSync(path.join(tpl, 'bands.yaml'), 'utf8'));
    assert.equal(bands.metric, 'ci_test_failure_rate');
  });

  test('card template keeps the placeholder id (skipped by validators) and the intent template validates once filled', () => {
    const card = readFileSync(path.join(tpl, 'cards', '_TEMPLATE.md'), 'utf8');
    assert.match(card, /^id: T\?-EXAMPLE/m);
    const parsed = parseCardText(card.replace(/T\?-EXAMPLE/g, 'T0-EXAMPLE'), 'T0-EXAMPLE.md');
    assert.ok(!('error' in parsed), 'template card must parse once the id is real');
    const intent = readFileSync(path.join(tpl, 'intent', '_TEMPLATE.md'), 'utf8');
    const v = parseIntent(intent);
    assert.ok(v.problems.length > 0, 'an untouched intent template must not validate');
  });

  test('companion skills exist, are ASCII, carry frontmatter and attribution, stay under their caps and are wired', () => {
    const COMPANION_CAPS: Record<string, number> = { tdd: 3500, diagnose: 3500, grilling: 2500, 'merge-conflicts': 1500 };
    for (const [name, cap] of Object.entries(COMPANION_CAPS)) {
      const file = path.join(tpl, 'claude', 'skills', name, 'SKILL.md');
      assert.ok(existsSync(file), `${name}/SKILL.md missing`);
      const bytes = statSync(file).size;
      assert.ok(bytes <= cap, `${name}/SKILL.md is ${bytes} bytes > cap ${cap}`);
      const text = readFileSync(file, 'utf8');
      assert.ok(!/[^\x00-\x7F]/.test(text), `${name}/SKILL.md must be ASCII so bytes == chars`);
      assert.ok(text.startsWith(`---\nname: ${name}\n`), `${name} frontmatter must start with its name`);
      assert.ok(text.includes('\ndescription: >-\n'), `${name} folded description`);
      assert.ok(text.includes('mattpocock/skills'), `${name} must carry its attribution line`);
    }
    const router = readFileSync(path.join(tpl, 'claude', 'skills', 'aidlc-loop', 'SKILL.md'), 'utf8');
    for (const name of Object.keys(COMPANION_CAPS)) assert.ok(router.includes('`' + name + '`'), `aidlc-loop/SKILL.md must name the companion skill ${name}`);
    const agent = (n: string) => readFileSync(path.join(tpl, 'claude', 'agents', `${n}.md`), 'utf8');
    assert.ok(agent('implementer').includes('.claude/skills/tdd/SKILL.md'), 'implementer points at the tdd skill');
    assert.ok(agent('investigator').includes('.claude/skills/diagnose/SKILL.md'), 'investigator points at the diagnose skill');
    assert.ok(agent('planner').includes('.claude/skills/grilling/SKILL.md'), 'planner points at the grilling skill');
    assert.match(agent('planner'), /acyclic|circular/i, 'planner checks the dependency graph');
    assert.match(agent('planner'), /plan_ref/, 'planner checks plan_ref resolution');
    assert.match(agent('verifier'), /Unverified/, 'verifier table verdicts');
    assert.match(agent('verifier'), /Not Met/, 'verifier table verdicts');
    assert.match(agent('reviewer'), /never instructions/, 'reviewer treats candidate content as evidence');
    assert.match(agent('reviewer'), /fewer verified findings/, 'reviewer verdict budget');
  });

  test('REVIEW.md carries the two axes, the nit cap and the verdict contract', () => {
    const review = readFileSync(path.join(tpl, 'REVIEW.md'), 'utf8');
    assert.match(review, /spec/);
    assert.match(review, /standards/);
    assert.match(review, /five nits|5 nits|at most five/i);
    assert.match(review, /"verdict"/);
    assert.match(review, /## Untrusted content/);
    assert.match(review, /evidence, never instructions/);
    assert.match(review, /## Verdict budget/);
    assert.match(review, /fewer verified findings/);
  });

  test('T1-REVIEW-FINDINGS-2 acceptance 8: the operating guide, the architecture note, both card-loop copies and the changelog record findings and dispositions', () => {
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    assert.match(operations, /### Findings and dispositions/, 'OPERATIONS.md section');
    assert.match(operations, /aidlc review dispute <card> <id> --note/, 'the dispute command is documented');
    assert.match(operations, /aidlc review accept <card> <id>/, 'the accept command is documented');
    assert.match(operations, /aidlc review findings <card>/, 'the listing command is documented');
    assert.match(operations, /re:F<n>/, 'the reference syntax is documented');
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.match(architecture, /findings \(ids, dispositions, re-raises, revisions\)/, 'ARCHITECTURE.md persisted-state table names the findings');
    assert.match(architecture, /written under `<file>.lock`/, 'ARCHITECTURE.md names the card-run lock');
    for (const copy of [path.join(tpl, 'claude', 'skills', 'aidlc-loop', 'card-loop.md'), path.join(root, '.claude', 'skills', 'aidlc-loop', 'card-loop.md')]) {
      const text = readFileSync(copy, 'utf8');
      assert.match(text, /aidlc review dispute/, `${copy} names the dispute command`);
      assert.ok(Buffer.byteLength(text, 'utf8') <= CAPS['card-loop.md']!, `${copy} stays under the cap`);
    }
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.match(unreleased, /T1-REVIEW-FINDINGS-2/, 'CHANGELOG Unreleased carries the entry');
    assert.match(operations, /GoalStore.updateCardRun/, 'OPERATIONS.md documents the card-run lock');
  });

  test('T1-REVIEW-INPUTS acceptance 4 and 5: REVIEW.md names the advisory tags, both configs carry the current policy version (REVIEW.md@4 since T1-REVIEW-CLASS-SWEEP), and the docs record the cap refusal, the policy hash, the delta and the tags', () => {
    for (const file of [path.join(tpl, 'REVIEW.md'), path.join(root, 'REVIEW.md')]) {
      const review = readFileSync(file, 'utf8');
      assert.match(review, /\[question\][^\n]*\[suggestion\][^\n]*(advisory|never block)/i, `${file} names the tags and says they never block`);
    }
    for (const file of [path.join(tpl, 'aidlc.config.json'), path.join(root, 'aidlc.config.json')]) {
      assert.equal((JSON.parse(readFileSync(file, 'utf8')) as { reviewPolicyVersion: string }).reviewPolicyVersion, 'REVIEW.md@4', `${file} policy version`);
    }
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    assert.match(operations, /maxDiffBytes[^\n]*refus/i, 'OPERATIONS.md records the cap refusal');
    assert.match(operations, /policy_hash/, 'OPERATIONS.md records the policy hash');
    assert.match(operations, /## Delta since the last reviewed candidate/, 'OPERATIONS.md records the delta section');
    assert.match(operations, /first-round miss/, 'OPERATIONS.md records the first-round miss');
    assert.match(operations, /\[question\][^\n]*\[suggestion\]/, 'OPERATIONS.md records the tags');
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.match(architecture, /policy hash/, 'ARCHITECTURE.md names the policy hash');
    assert.match(architecture, /first-round miss/, 'ARCHITECTURE.md names the first-round miss');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.match(unreleased, /T1-REVIEW-INPUTS/, 'CHANGELOG Unreleased carries the entry');
  });

  test('T1-REVIEW-STATS acceptance 4: the operating guide documents the statistics command and its fields, the architecture names the module and the changelog carries the entry', () => {
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    assert.match(operations, /### Review statistics/, 'OPERATIONS.md section');
    assert.match(operations, /aidlc review stats \[--goal <id>\] \[--card <id>\]/, 'OPERATIONS.md documents the command');
    assert.match(operations, /blocksByPerspective/, 'OPERATIONS.md names the R2 fields');
    assert.match(operations, /firstRoundMiss/, 'OPERATIONS.md names the finding fields');
    assert.match(operations, /wallMs/, 'OPERATIONS.md names the wall time');
    assert.match(operations, /superseded_by/, 'OPERATIONS.md names the family chain');
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.match(architecture, /review\/stats\.ts/, 'ARCHITECTURE.md names the module');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.match(unreleased, /T1-REVIEW-STATS/, 'CHANGELOG Unreleased carries the entry');
  });

  test('T0-PLANNING-CLAIMS acceptance 5 and 6: entry check 1 carries the claim rule in both identical copies under the cap; the docs and the changelog record the two surfaces', () => {
    const live = readFileSync(path.join(root, '.claude', 'skills', 'aidlc-loop', 'SKILL.md'), 'utf8');
    const template = readFileSync(path.join(tpl, 'claude', 'skills', 'aidlc-loop', 'SKILL.md'), 'utf8');
    assert.equal(live, template, 'both SKILL.md copies are identical');
    assert.ok(Buffer.byteLength(template, 'utf8') <= CAPS['SKILL.md']!, `SKILL.md is ${Buffer.byteLength(template, 'utf8')} bytes > cap ${CAPS['SKILL.md']}`);
    const entry1 = template.slice(template.indexOf('\n1. `aidlc doctor`'), template.indexOf('\n2. ')).replace(/\s+/g, ' ');
    assert.match(entry1, /names the goal claiming each uncommitted planning file/, 'entry check 1 says doctor names the claiming goal');
    assert.match(entry1, /another goal's file[^.]*alone/, "entry check 1 says another goal's file is left alone");
    assert.match(entry1, /commit your own goal's planning artifacts on main as soon as they validate and before you stop/, 'entry check 1 says when to commit');
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    assert.match(operations, /derived from the goal record and its lease/, 'OPERATIONS.md states the claim rule');
    assert.match(operations, /`workingTree`/, 'OPERATIONS.md names the doctor surface');
    assert.match(operations, /Planning artifacts of goal <id> are uncommitted on main/, 'OPERATIONS.md names the Stop surface');
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.match(architecture, /`claims\.ts`/, 'ARCHITECTURE.md names the module');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.match(unreleased, /T0-PLANNING-CLAIMS/, 'CHANGELOG Unreleased carries the entry');
  });

  test('T0-DOCTOR-BASE-SYNC acceptance 4 and 5: entry check 1 says to push main and names baseSync in both identical copies under the cap; the docs and the changelog state the check', () => {
    const live = readFileSync(path.join(root, '.claude', 'skills', 'aidlc-loop', 'SKILL.md'), 'utf8');
    const template = readFileSync(path.join(tpl, 'claude', 'skills', 'aidlc-loop', 'SKILL.md'), 'utf8');
    assert.equal(live, template, 'both SKILL.md copies are identical');
    assert.ok(Buffer.byteLength(template, 'utf8') <= CAPS['SKILL.md']!, `SKILL.md is ${Buffer.byteLength(template, 'utf8')} bytes > cap ${CAPS['SKILL.md']}`);
    const entry1 = template.slice(template.indexOf('\n1. `aidlc doctor`'), template.indexOf('\n2. ')).replace(/\s+/g, ' ');
    assert.ok(entry1.includes("commit your own goal's planning artifacts on main as soon as they validate and before you stop, then push main."), 'entry check 1 says to push main after the commit');
    assert.ok(entry1.includes('A `baseSync` that names a git command => run it.'), 'entry check 1 names baseSync and its repair');
    for (const copy of [live, template]) assert.ok(!copy.includes('Prints size, kind, target, card count (or unknown), modules, next module.'), 'the Route line is removed to stay under the cap');
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    for (const sentence of [
      "Doctor reads the refs as they are and never fetches, so the counts are as of the last fetch; the line never changes doctor's exit code.",
      'Every git call of the check runs as `git --no-lazy-fetch <command>`, so a partial clone never fetches a missing object from its promisor remote; git older than 2.45 refuses the option and the value is then `UNREADABLE: git rev-parse failed (exit 129)`.',
      'Card branches start from `origin/<base>`, so a planning commit left only on local main is invisible to them, and a card PR that edits the same text conflicts with it when main is next synced',
      'Entry check 1 of `aidlc-loop` says to push main after committing planning artifacts, and to run the git command a `baseSync` value names; the `n/a` and `UNREADABLE` values name none.',
      'A failed lookup or count, or a count whose output is not two non-negative integers, is `UNREADABLE: git rev-parse failed (exit <n>)` or `UNREADABLE: git rev-list failed (exit <n>)`, with `(UNREADABLE)` when there is no exit code, never git\x27s text.',
    ]) assert.ok(operations.includes(sentence), `OPERATIONS.md states: ${sentence}`);
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.ok(architecture.includes('`base-sync.ts` compares the local base branch with `origin/<base>` for `aidlc doctor`, reading refs only and never fetching.'), 'ARCHITECTURE.md names the module');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.ok(unreleased.includes('- T0-DOCTOR-BASE-SYNC-2 (supersedes T0-DOCTOR-BASE-SYNC): `aidlc doctor` prints `baseSync`, the local base branch against `origin/<base>` as of the last fetch: in sync, ahead, behind or diverged, each with the git command that brings them together.'), 'CHANGELOG Unreleased carries the entry');
  });

  test('T1-REVIEW-COVERAGE acceptance 6: the operating guide documents the coverage setting, its contract line, the round field and the summary line; the architecture names the join and the schemas; the changelog carries the entry', () => {
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    assert.match(operations, /preReview\.coverage/, 'OPERATIONS.md names the setting');
    assert.match(operations, /"coverage":\[\{"item"/, 'OPERATIONS.md quotes the contract line');
    assert.match(operations, /PreReviewRound\.coverage|round record[^\n]*coverage/, 'OPERATIONS.md names the round field');
    assert.match(operations, /coverage: <accounted>\/<expected> accounted|coverage: \d+\/\d+ accounted/, 'OPERATIONS.md shows the summary line');
    for (const label of ['unaccounted', 'conflicted', 'inconsistent', 'malformed']) assert.match(operations, new RegExp(label), `OPERATIONS.md names ${label}`);
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
    assert.match(architecture, /joinCoverage/, 'ARCHITECTURE.md names the join');
    assert.match(architecture, /CoverageEntry/, 'ARCHITECTURE.md names the verdict schema');
    assert.match(architecture, /RoundCoverage/, 'ARCHITECTURE.md names the round schema');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.match(unreleased, /T1-REVIEW-COVERAGE/, 'CHANGELOG Unreleased carries the entry');
  });

  test('T1-REVIEW-COVERAGE-STATS acceptance 4: the operating guide documents the coverage fields under Review statistics and the changelog carries the entry', () => {
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
    const section = operations.slice(operations.indexOf('### Review statistics'), operations.indexOf('## Evals'));
    assert.ok(section.length, 'OPERATIONS.md keeps the Review statistics section');
    for (const field of ['roundsRequested', 'roundsComplete', 'unaccounted', 'conflicted', 'inconsistent', 'r3SpecFindingsAfterIncomplete']) {
      assert.ok(section.includes('`' + field + '`'), `OPERATIONS.md names ${field} under Review statistics`);
    }
    assert.match(section, /coverage: <roundsComplete>\/<roundsRequested> complete, unaccounted <n>, conflicted <n>, inconsistent <n>, r3 spec findings after incomplete <n>/, 'OPERATIONS.md shows the line form');
    assert.match(section, /coverage: not requested/, 'OPERATIONS.md shows the line for a card without coverage rounds');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('## 0.1.0'));
    assert.match(unreleased, /T1-REVIEW-COVERAGE-STATS/, 'CHANGELOG Unreleased carries the entry');
  });
});


describe('T1-EFF-AGENTS-DOD: agent model and effort, the implementer effort rule, targeted DoD', () => {
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
  const front = (text: string) => text.slice(0, text.indexOf('\n---', 4));

  test('acceptance 1: each agent file names exactly one model and one effort [R1]', () => {
    const want: Record<string, [string, string]> = { planner: ['opus', 'high'], reviewer: ['opus', 'medium'], 'release-specialist': ['opus', 'medium'], investigator: ['sonnet', 'medium'], verifier: ['sonnet', 'medium'], implementer: ['inherit', 'medium'] };
    for (const [name, [model, effort]] of Object.entries(want)) {
      const fm = front(read(`templates/claude/agents/${name}.md`));
      assert.deepEqual(fm.match(/^model: .*$/gm), [`model: ${model}`], name);
      assert.deepEqual(fm.match(/^effort: .*$/gm), [`effort: ${effort}`], name);
    }
  });

  test('acceptance 2: both arc.md copies start an implementer subagent at the directive effort, identical and under the cap [R2]', () => {
    const live = read('.claude/skills/aidlc-loop/arc.md');
    const template = read('templates/claude/skills/aidlc-loop/arc.md');
    assert.equal(live, template);
    assert.ok(Buffer.byteLength(template, 'utf8') <= CAPS['arc.md']!, `arc.md is ${Buffer.byteLength(template, 'utf8')} bytes`);
    assert.ok(flat('templates/claude/skills/aidlc-loop/arc.md').includes("Start an implementer subagent with the `run-card` directive's `effort` as its effort"));
  });

  test('acceptance 3: Verifying your work names the card DoD, CI for the full suite and the SHIP refusal, and no hook that blocks done [R3]', () => {
    const text = read('templates/CLAUDE.aidlc.md');
    const section = text.slice(text.indexOf('### Verifying your work'), text.indexOf('### Hard limits')).replace(/\s+/g, ' ');
    assert.ok(section.includes("the card's `dod_command` runs the typecheck and the card's own tests"), section);
    assert.ok(section.includes('The full suite and the build run in CI on every candidate'), section);
    assert.ok(section.includes('The card machine refuses SHIP without a DoD receipt'), section);
    assert.ok(!section.includes('A hook blocks'), section);
  });

  test('acceptance 4: the planner, the implementer and both card templates state the targeted DoD [R4]', () => {
    assert.ok(flat('templates/claude/agents/planner.md').includes("Each card's `dod_command` runs only that card's tests and fast static checks (typecheck), never the full suite"));
    assert.ok(!read('templates/claude/agents/implementer.md').includes('the affected checks'));
    for (const file of ['templates/cards/_TEMPLATE.md', 'specs/tasks/_TEMPLATE.md']) {
      assert.ok(read(file).includes("# the card's own tests and fast static checks; the full suite runs in CI"), file);
    }
  });

  test('acceptance 5: OPERATIONS names the six agent defaults and the implementer effort rule; the CHANGELOG Unreleased section names the card [R5]', () => {
    const ops = flat('docs/OPERATIONS.md');
    for (const phrase of ['the planner on `opus` at `high`', 'the reviewer and the release-specialist on `opus` at `medium`', 'the investigator and the verifier on `sonnet` at `medium`', "the implementer on the session's model (`inherit`) at `medium`", "starts an implementer subagent with the `run-card` directive's `effort`"]) {
      assert.ok(ops.includes(phrase), phrase);
    }
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    assert.match(unreleased, /^- T1-EFF-AGENTS-DOD: /m);
  });
});

describe('T1-VERIFY-SKILL: the verify-card-run-writes skill, the card-loop rule for project verify skills and their docs', () => {
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  const SKILL = '.claude/skills/verify-card-run-writes/SKILL.md';
  const CHECK = 'tests/scenarios/fault-points.test.ts';
  const HEADINGS = ['Property', 'Coverage', 'Run', 'Bounds and assumptions', 'Not covered', 'Shown failing', 'Bug or modelling error', 'Findings', 'Extending the check', 'Keeping in sync'];
  /** The body of the `## <heading>` section of `text`, up to the next `## ` heading or the end. */
  const section = (text: string, heading: string): string => {
    const at = text.indexOf(`\n## ${heading}\n`);
    assert.ok(at >= 0, `## ${heading} missing`);
    const end = text.indexOf('\n## ', at + 1);
    return text.slice(at + `\n## ${heading}\n`.length, end < 0 ? undefined : end);
  };
  const spansOf = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  const isPath = (span: string): boolean => /^[\w.-]+(\/[\w.-]+)+$/.test(span);
  const fences = (text: string): string[] => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  /** One sentence: ends with a full stop, and no full stop, `!` or `?` before it is followed by a space and a capital letter or a backtick. */
  const oneSentence = (text: string): boolean => /\.$/.test(text) && !/[.!?]["')\]]*\s+["'(`]*[A-Z`]/.test(text.slice(0, -1));
  /** Coverage lines `- \`path\`: \`Function\`, \`Class.method\``, as the path and the names after it. */
  const coverage = (body: string): Array<{ file: string; names: string[] }> =>
    body.split('\n').filter((l) => l.startsWith('- `')).map((l) => {
      const [file, ...names] = spansOf(l);
      return { file: file!, names };
    });

  test('acceptance 1: the skill exists, is ASCII and at most 8000 bytes, its front matter names it and says what it covers and when to use it, and it carries no placeholder [R1]', () => {
    const file = path.join(root, SKILL);
    assert.ok(existsSync(file), `${SKILL} missing`);
    assert.ok(statSync(file).size <= 8000, `${SKILL} is ${statSync(file).size} bytes > 8000`);
    const text = read(SKILL);
    assert.ok(!/[^\x00-\x7F]/.test(text), `${SKILL} must be ASCII`);
    assert.ok(text.startsWith('---\nname: verify-card-run-writes\n'), 'front matter opens with name: verify-card-run-writes');
    const front = text.slice(4, text.indexOf('\n---\n', 4));
    const description = (front.split(/\n(?=\S)/).find((k) => k.startsWith('description:')) ?? '').replace(/\s+/g, ' ');
    assert.ok(description.includes('card-run'), `the description names the card-run write protocol: ${description}`);
    assert.ok(description.includes('Use when'), `the description says when to use the skill: ${description}`);
    for (const marker of [/\bTODO\b/, /\bTBD\b/, /\bFIXME\b/, /<[A-Za-z][^<>\n]*>/]) assert.ok(!marker.test(text), `${SKILL} carries a placeholder: ${marker}`);
  });

  test('acceptance 2: the skill has the ten sections, the property and harm in one sentence each, the run command with its runtime, what it leaves out, where findings go and the four drift outcomes [R2]', () => {
    const text = read(SKILL);
    for (const heading of HEADINGS) assert.ok(text.includes(`\n## ${heading}\n`), `## ${heading} missing`);
    const property = section(text, 'Property').split('\n');
    for (const key of ['Property', 'Harm']) {
      const lines = property.filter((l) => l.startsWith(`${key}:`));
      assert.equal(lines.length, 1, `one ${key}: line`);
      assert.ok(oneSentence(lines[0]!.slice(key.length + 1).trim()), `${key}: is one sentence: ${lines[0]}`);
    }
    const run = section(text, 'Run');
    assert.deepEqual(fences(run).map((b) => b.trim()), [`node --test ${CHECK}`], 'Run has one fenced block holding the check command');
    assert.match(run.replace(/```[\s\S]*?```/g, ''), /\b\d+(\.\d+)? ?(s|seconds)\b/, 'Run states the runtime in seconds');
    const notCovered = section(text, 'Not covered').replace(/\s+/g, ' ');
    assert.match(notCovered, /\blease\b/i, 'Not covered names the lease');
    assert.match(notCovered, /\breview[- ]queue\b/i, 'Not covered names the review queue');
    assert.match(notCovered, /more than one fault per run/i, 'Not covered names more than one fault per run');
    assert.ok(section(text, 'Findings').includes('T0-bugfix'), 'Findings names a T0-bugfix card');
    const sync = section(text, 'Keeping in sync').replace(/\s+/g, ' ');
    for (const outcome of ['in sync', 'updated', 'bug', 'blocked']) assert.match(sync, new RegExp(`\\b${outcome}\\b`), `Keeping in sync names the outcome ${outcome}`);
  });

  test('acceptance 3: the coverage record names one sync commit and only existing files, functions found in them and CardRunner methods the check drives [R3] [R4]', () => {
    const body = section(read(SKILL), 'Coverage');
    const sync = body.split('\n').filter((l) => l.startsWith('Sync commit:'));
    assert.equal(sync.length, 1, 'one Sync commit: line');
    assert.match(sync[0]!, /^Sync commit: `[0-9a-f]{40}`$/, 'the sync commit is a full 40-hex sha in backticks');
    const paths = spansOf(body).filter(isPath);
    for (const p of paths) assert.ok(existsSync(path.join(root, p)), `${p} does not exist`);
    for (const p of [CHECK, 'src/loop/card-runner.ts', 'src/state/goal-store.ts', 'src/state/journal.ts']) assert.ok(paths.includes(p), `the record names ${p}`);
    const lines = coverage(body);
    assert.ok(lines.length >= 4, 'one coverage line per file');
    const check = read(CHECK);
    const methods: string[] = [];
    for (const { file, names } of lines) {
      assert.ok(isPath(file) && existsSync(path.join(root, file)), `${file} is a repository path`);
      assert.ok(names.length > 0, `${file} lists what it covers`);
      const source = read(file);
      for (const name of names) {
        const [owner, fn] = name.includes('.') ? name.split('.') : [undefined, name];
        assert.match(fn!, /^\w+$/, `${file}: ${name} is a function or Class.method`);
        assert.match(source, new RegExp(`\\b${fn}\\(`), `${file} has no ${fn}(`);
        if (owner) assert.match(source, new RegExp(`\\bclass ${owner}\\b`), `${file} has no class ${owner}`);
        if (owner === 'CardRunner') methods.push(fn!);
      }
    }
    assert.ok(methods.length > 0, 'the record names the CardRunner commands');
    for (const m of new Set([...methods, ...spansOf(body).filter((s) => s.startsWith('CardRunner.')).map((s) => s.slice('CardRunner.'.length))])) {
      assert.match(check, new RegExp(`\\b${m}\\b`), `CardRunner.${m} does not occur in ${CHECK}`);
    }
  });

  test('acceptance 4: Shown failing names an existing src/ file and a covered function and holds a TAP excerpt with a not ok line of the check [R10]', () => {
    const text = read(SKILL);
    const shown = section(text, 'Shown failing');
    const prose = shown.replace(/```[\s\S]*?```/g, '');
    const src = spansOf(prose).filter((s) => isPath(s) && s.startsWith('src/'));
    assert.ok(src.length > 0 && src.every((s) => existsSync(path.join(root, s))), `Shown failing names an existing file under src/: ${src.join(', ')}`);
    const covered = coverage(section(text, 'Coverage')).flatMap((l) => l.names);
    assert.ok(spansOf(prose).some((s) => covered.includes(s)), `Shown failing names a covered function of ${covered.join(', ')}`);
    const tap = fences(shown).find((b) => /^\s*not ok \d+ - /m.test(b));
    assert.ok(tap, 'a fenced TAP excerpt with a not ok line');
    assert.match(tap, /tests[\\/]+scenarios[\\/]+fault-points\.test\.ts:\d+:\d+/, 'the excerpt locates the failure in the check');
  });

  const RULE = "Verify skills: when a card changes a file that a `.claude/skills/verify-*/SKILL.md` covers, run that skill's check before SHIP; at CLOSE, move its sync commit to the merge commit only after confirming that the check describes the code there.";

  test('acceptance 5: both card-loop.md copies are identical, ASCII, under the cap and open SHIP with the verify-skill rule, without the two removed passages [R5]', () => {
    const live = read('.claude/skills/aidlc-loop/card-loop.md');
    const template = read('templates/claude/skills/aidlc-loop/card-loop.md');
    assert.equal(live, template, 'both card-loop.md copies are identical');
    assert.ok(Buffer.byteLength(template, 'utf8') <= CAPS['card-loop.md']!, `card-loop.md is ${Buffer.byteLength(template, 'utf8')} bytes > cap ${CAPS['card-loop.md']}`);
    assert.ok(!/[^\x00-\x7F]/.test(template), 'card-loop.md is ASCII');
    const flat = template.replace(/\s+/g, ' ');
    assert.ok(flat.includes(RULE), 'card-loop.md carries the verify-skill rule');
    assert.ok(template.includes('\n## SHIP\nVerify skills: '), 'the rule opens ## SHIP');
    assert.ok(!flat.includes('Reasons: card, capability'), 'the STOP reason list is removed');
    assert.ok(flat.includes('- Card: `aidlc cards validate --card <id>`. Registry is authority; board is a view.'), 'the field list after cards validate is removed');
  });

  /** The `## Project verify skills` section of docs/OPERATIONS.md, paragraph by paragraph. */
  const PROJECT_VERIFY_SKILLS = [
    "A project verify skill is `.claude/skills/verify-*/SKILL.md`: one check of this repository's own code, with a coverage record that names every file and function the check covers, and a sync commit, the commit on main at which the check was last confirmed to describe the covered code.",
    "The card-loop rule (`card-loop.md`, SHIP): a card that changes a file a verify skill covers runs that skill's check before SHIP and, at CLOSE, moves the sync commit to the merge commit only after confirming that the check describes the code there, so such a card names the skill in its `doc_sync`. The skill's Keeping in sync section tells whether a change touches covered code and what to do in each of its four outcomes: in sync, updated, bug and blocked.",
    'This repository has one, `verify-card-run-writes`, for the card-run write protocol: the `CardRunner` store writes and goal journal appends that the fault-point check fails in turn (see Fault-point check). Its check is `node --test tests/scenarios/fault-points.test.ts`, which `npm test` and CI also run.',
    '`aidlc init` does not install project verify skills: each names the code of the repository it lives in, so `templates/claude/skills/` holds none. `tests/surface/mirror.test.ts` refuses a `verify-*` directory there and exempts the live ones under `.claude/skills/` from the check that every live skill is shipped by the templates.',
  ];
  const CLAUDE_SENTENCE = "`.claude/skills/verify-*/` holds this repository's own verify skills, which have no copy under `templates/claude/` and which `aidlc init` does not install.";
  const CHANGELOG_ENTRY = "- T1-VERIFY-SKILL: `.claude/skills/verify-card-run-writes/SKILL.md` wraps the fault-point check for the next agent: the property, a coverage record with a sync commit, the run command, bounds, what is not covered, a recorded failure on a real-code break, how to tell a bug from a modelling error, how to report one and how to keep the check in sync. Both `card-loop.md` copies open SHIP with a rule for project verify skills (run the check before SHIP, move the sync commit at CLOSE only after confirming that the check describes the code); to stay under the 6500-byte cap they drop the STOP reason list of DONE / STOP and the field list after `aidlc cards validate --card <id>`. `tests/surface/mirror.test.ts` exempts live `.claude/skills/verify-*/` files from the shipped-by-templates check and refuses a `verify-*` directory under `templates/claude/skills/`.";
  /** The sentences of a paragraph: a split after a full stop that a space and a capital letter or a backtick follow. */
  const sentences = (paragraph: string): string[] => paragraph.split(/(?<=\.)\s+(?=[A-Z`])/);

  /** Whether each doc text this card adds is present whole: the OPERATIONS section exactly, right after Companion skills; the CLAUDE.md sentence in Conventions; the CHANGELOG entry in Unreleased. */
  function docsHold(ops: string, claude: string, changelog: string): boolean {
    const companion = ops.indexOf('\n## Companion skills\n');
    const at = ops.indexOf('\n## Project verify skills\n');
    if (!(companion >= 0 && at > companion && ops.indexOf('\n## ', companion + 1) === at)) return false;
    const end = ops.indexOf('\n## ', at + 1);
    const body = ops.slice(at + '\n## Project verify skills\n'.length, end < 0 ? undefined : end).trim().split('\n\n');
    if (JSON.stringify(body) !== JSON.stringify(PROJECT_VERIFY_SKILLS)) return false;
    const from = claude.indexOf('\n## Conventions\n');
    const to = claude.indexOf('\n## AI-native SDLC (aidlc)\n');
    if (!(from >= 0 && to > from && claude.slice(from, to).replace(/\s+/g, ' ').includes(CLAUDE_SENTENCE))) return false;
    const start = changelog.indexOf('## Unreleased');
    const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
    return unreleased.split('\n').includes(CHANGELOG_ENTRY);
  }

  test('acceptance 8: OPERATIONS carries the Project verify skills section whole, CLAUDE.md Conventions names .claude/skills/verify-*/, the CHANGELOG carries the entry, and removing any sentence fails [R7] [R8] [R9]', () => {
    const docs = [read('docs/OPERATIONS.md'), read('CLAUDE.md'), read('CHANGELOG.md')] as const;
    const [ops, claude, changelog] = docs;
    const whole = PROJECT_VERIFY_SKILLS.join(' ');
    for (const needle of ['`.claude/skills/verify-*/SKILL.md`', '`verify-card-run-writes`', '`node --test tests/scenarios/fault-points.test.ts`', 'sync commit', '`aidlc init` does not install project verify skills']) assert.ok(whole.includes(needle), `the section names ${needle}`);
    assert.ok(claude.replace(/\s+/g, ' ').includes('`.claude/skills/verify-*/`'), 'CLAUDE.md names .claude/skills/verify-*/');
    assert.ok(docsHold(...docs), 'the doc texts this card adds are present whole');
    const removals: [string, () => boolean][] = [
      ...PROJECT_VERIFY_SKILLS.flatMap((p) => sentences(p)).map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), claude, changelog)]),
      ...sentences(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, claude, changelog.replace(s, ''))]),
      [CLAUDE_SENTENCE, () => docsHold(ops, claude.replace(/`\.claude\/skills\/verify-\*\/` holds[^.]*\./, ''), changelog)],
      ['## Project verify skills', () => docsHold(ops.replace('\n## Project verify skills\n', '\n'), claude, changelog)],
    ];
    // 7 section sentences, 3 CHANGELOG sentences, the CLAUDE.md sentence and the heading.
    assert.equal(removals.length, 12);
    for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
  });
});

describe('defect classes in the policy, the reviewer agent and the docs (T1-REVIEW-CLASS-SWEEP)', () => {
  const flat = (text: string) => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  /** The output-contract sentence both REVIEW.md copies add (R12). */
  const REVIEW_CLASS =
    'Give each block reason a defect class with `(class: <slug>)` right after the dimension and before the location: the slug is lowercase letters and digits in dash-separated runs, at most 40 characters, and every site of one class carries the same slug. A `[question]` or `[suggestion]` reason carries no class. For a prior finding that has a class, check every site of that class in the candidate and re-raise the finding with `re:F<n>` once per remaining site, each cited with file:line.';
  /** The procedure step both reviewer agent copies add (R12). */
  const REVIEWER_STEP =
    '9. Give each block reason a defect class, `(class: <slug>)` after the dimension and before the location, with the same slug at every site of one class and no class on a `[question]` or `[suggestion]` reason. For a prior finding that has a class, check every site of that class in the candidate and re-raise it with `re:F<n>` once per remaining site.';
  /** The paragraph docs/OPERATIONS.md adds under Findings and dispositions (R21), pinned whole, one sentence per entry. */
  const OPERATIONS = [
    'Defect classes (card T1-REVIEW-CLASS-SWEEP).',
    'Both prompts, `REVIEW.md` and the reviewer agent ask for a class on each block reason: `(class: <slug>)` right after the dimension and before the `@ <file:line>` location, the slug lowercase letters and digits in dash-separated runs of at most 40 characters, the same slug at every site of one class, and no class on a `[question]` or `[suggestion]` reason.',
    '`findingClass` reads the first tag of a reason (the keyword in any case, at most one space after the colon); a malformed slug, or a reason the advisory-tag rule reads as `[question]` or `[suggestion]`, records no class.',
    'The class is recorded as `ReviewFinding.class` on the finding the reason raises, or on the finding it re-raises when that finding has none, and changes no id, disposition, revision, resolution, counter or decision.',
    "When a formal block returns the card to REVIEW_FIX, each repair directive (the ship path's `review-fix`, the pending-block `review-fix` and the REVIEW_FIX `build`) appends the class list of the block's open findings (an advisory-block finding, never a merge bar, adds none), each class with its finding ids and cited sites, and asks for every site of each class inside the card's `allow_paths`, not only the cited lines; a block without a class appends nothing.",
    'The sweep check: under `## Prior findings` an open finding with a class names it and asks the reviewer to check every site of that class in the candidate and to re-raise the finding with `re:F<n>` once per remaining site; a disputed or deadlocked finding names its class and keeps its instruction.',
    'The class sentence in the output contract moved `reviewPolicyVersion` to `REVIEW.md@4`.',
  ];
  const CHANGELOG = [
    "- T1-REVIEW-CLASS-SWEEP: a block reason names its defect class with `(class: <slug>)` after the dimension, and the finding records it as `ReviewFinding.class` (a re-raise sets it on a finding that has none).",
    "The repair directives of a formal block list each class of the block's open findings with their ids and cited sites and ask for every site inside `allow_paths`, not only the cited lines, and the next round or decision is asked to check every site of the class and re-raise each remaining one with `re:F<n>`.",
    'Both prompts, `REVIEW.md` and the reviewer agent ask for the tag; `reviewPolicyVersion` is `REVIEW.md@4` in both configs.',
    'The R3 stop rule, the decision allowance and the R2 rounds are unchanged.',
  ];
  const ARCHITECTURE = 'findings (ids, dispositions, re-raises, revisions), their defect class (`ReviewFinding.class`) and their first-round misses (`outsideDelta`)';
  const unreleasedOf = (changelog: string) => changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));

  test('acceptance 10: both REVIEW.md copies carry the class sentence in the output contract with the JSON example and reason-format lines as on main, both reviewer agents the class step, both configs REVIEW.md@4 [R12]', () => {
    for (const file of [path.join(tpl, 'REVIEW.md'), path.join(root, 'REVIEW.md')]) {
      const review = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      const contract = review.slice(review.indexOf('## Output contract'));
      assert.ok(contract.split('\n').includes(REVIEW_CLASS), `${file}: the class sentence in the output contract`);
      assert.ok(contract.includes('\n`{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}`\n'), `${file}: the JSON example line`);
      assert.ok(contract.includes('\nBlock reasons are formatted `[spec] <dimension #/name> @ <file:location>: <why it violates> -> <how to fix>`.\n'), `${file}: the reason-format line`);
    }
    for (const file of [path.join(tpl, 'claude', 'agents', 'reviewer.md'), path.join(root, '.claude', 'agents', 'reviewer.md')]) {
      const reviewer = flat(readFileSync(file, 'utf8'));
      assert.ok(reviewer.includes(REVIEWER_STEP), `${file}: the class step`);
      assert.ok(reviewer.indexOf(REVIEWER_STEP) > reviewer.indexOf('8. End your turn'), `${file}: the class step follows step 8`);
    }
    for (const file of [path.join(tpl, 'aidlc.config.json'), path.join(root, 'aidlc.config.json')]) {
      assert.equal((JSON.parse(readFileSync(file, 'utf8')) as { reviewPolicyVersion: string }).reviewPolicyVersion, 'REVIEW.md@4', `${file} policy version`);
    }
  });

  test('acceptance 11: OPERATIONS.md carries the class paragraph whole and REVIEW.md@4, ARCHITECTURE.md the finding class, and the CHANGELOG Unreleased section the entry; removing any one sentence fails the check [R21]', () => {
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
    const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8').replace(/\r\n/g, '\n');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    const opsHolds = (text: string) => text.includes(OPERATIONS.join(' ')) && text.includes('`reviewPolicyVersion` is `REVIEW.md@4` in both configs');
    const changelogHolds = (text: string) => unreleasedOf(text).includes(CHANGELOG.join(' '));
    assert.ok(opsHolds(operations), 'OPERATIONS.md carries the class paragraph and the policy version');
    assert.ok(architecture.includes(ARCHITECTURE), 'ARCHITECTURE.md names the finding class in the persisted-state table');
    assert.ok(changelogHolds(changelog), 'CHANGELOG.md Unreleased carries the T1-REVIEW-CLASS-SWEEP entry');
    for (const sentence of OPERATIONS) assert.equal(opsHolds(operations.replace(sentence, '')), false, `removing this sentence still passes: ${sentence}`);
    for (const sentence of CHANGELOG) assert.equal(changelogHolds(changelog.replace(sentence, '')), false, `removing this sentence still passes: ${sentence}`);
  });
});

describe('dispute kinds and responses in the docs (T1-REVIEW-RESPONSES)', () => {
  /** The paragraph docs/OPERATIONS.md adds under Findings and dispositions (R8), pinned whole, one sentence per entry. */
  const KINDS = [
    'Dispute kinds (card T1-REVIEW-RESPONSES).',
    "`aidlc review dispute <card> <id> --note \"<why>\" --kind <kind>` records the author's response as `kind` on the dispute entry: `wrong` (the finding does not hold), `intentional` (the code does on purpose what the finding reports) or `not-worth-fixing` (the finding holds and its repair is not worth its cost), and `wrong` when `--kind` is absent.",
    'Any other value exits non-zero with a message naming the three kinds before the card run is read or created, so the run and the journal stay unchanged.',
    'The `FINDING_DISPUTED` event carries the kind as `data.kind`, and the `review findings` and `review dispute` line of a disputed finding reads `last note (<kind>): <note>`.',
    'A dispute recorded before this card has no kind: it is written back without one and every reader takes it as `wrong`.',
    'The kind is not shown to the reviewer and changes no rule of the loop: the next round or decision receives the note as before, and a disputed finding of every kind is held the same way.',
  ];
  /** The paragraph docs/OPERATIONS.md adds under Review statistics (R8), pinned whole. */
  const RESPONSES = [
    'Responses (card T1-REVIEW-RESPONSES).',
    "`findings.responses` reports every finding of the card, of each family member and of the family totals by the author's response: `fixed`, resolved with an open disposition; `wrong`, `intentional` and `notWorthFixing`, a disputed disposition, resolved or not, counted by the kind of its latest dispute, an absent kind as `wrong`; and `open`, unresolved with an open disposition.",
    'The five counts partition `total`: `responses.open` equals `open`, the three kinds add up to `disputed` plus the findings resolved while disputed, and `open + disputed + resolved === total` holds as before.',
    '`fixed` also counts a finding that was disputed, then re-raised or withdrawn, and then repaired, and a finding that a later round of its stage dropped without a repair, since the record does not tell a repair from a drop.',
    'The line form ends the findings segment with `; responses: <n> fixed, <n> wrong, <n> intentional, <n> not-worth-fixing, <n> open`, leaving out each zero count, and prints `findings 0` alone for a card with no findings.',
  ];
  const CHANGELOG = [
    '- T1-REVIEW-RESPONSES: `aidlc review dispute` takes `--kind wrong|intentional|not-worth-fixing` (default `wrong`) and records it as `kind` on the dispute, refusing any other value before anything is written; `FINDING_DISPUTED` carries it as `data.kind`, and the findings line reads `last note (<kind>): <note>`.',
    '`aidlc review stats` reports `findings.responses` (`fixed`, `wrong`, `intentional`, `notWorthFixing`, `open`) per card, per family member and in the family totals, and the line form ends the findings segment with the non-zero responses.',
    'A dispute recorded before this card keeps no kind and reads as `wrong`; the reviewer prompt, the hold and stop rules and `reviewPolicyVersion` are unchanged.',
  ];
  const ARCHITECTURE = 'the optional kind of each dispute (`wrong`, `intentional` or `not-worth-fixing`; a dispute recorded before card T1-REVIEW-RESPONSES has none and reads as `wrong`)';
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const sectionOf = (text: string, heading: string) => {
    const start = text.indexOf(`\n${heading}\n`);
    return start < 0 ? '' : text.slice(start, text.indexOf('\n#', start + heading.length + 2));
  };
  const unreleasedOf = (changelog: string) => changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));

  test('acceptance 7: OPERATIONS.md carries the kinds and the responses paragraphs whole in their sections, ARCHITECTURE.md the dispute kind in the card-run row, the CHANGELOG Unreleased section the entry; removing any one sentence fails the check [R8]', () => {
    const operations = lf(readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8'));
    const architecture = lf(readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8'));
    const changelog = lf(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
    const kindsHold = (text: string) => sectionOf(text, '### Findings and dispositions').includes(KINDS.join(' ')) && sectionOf(text, '### Findings and dispositions').includes('--note "<why>" [--kind <kind>]');
    const responsesHold = (text: string) => sectionOf(text, '### Review statistics').includes(RESPONSES.join(' '));
    const changelogHolds = (text: string) => unreleasedOf(text).includes(CHANGELOG.join(' '));
    assert.ok(kindsHold(operations), 'OPERATIONS.md Findings and dispositions carries the kinds paragraph and the --kind option');
    assert.ok(responsesHold(operations), 'OPERATIONS.md Review statistics carries the responses paragraph');
    const row = architecture.split('\n').find((l) => l.startsWith('| `cards/<goalId>/<cardId>.json` |')) ?? '';
    assert.ok(row.includes(ARCHITECTURE), 'ARCHITECTURE.md names the dispute kind in the card-run row');
    assert.ok(changelogHolds(changelog), 'CHANGELOG.md Unreleased carries the T1-REVIEW-RESPONSES entry');
    for (const sentence of KINDS) assert.equal(kindsHold(operations.replace(sentence, '')), false, `removing this sentence still passes: ${sentence}`);
    for (const sentence of RESPONSES) assert.equal(responsesHold(operations.replace(sentence, '')), false, `removing this sentence still passes: ${sentence}`);
    for (const sentence of CHANGELOG) assert.equal(changelogHolds(changelog.replace(sentence, '')), false, `removing this sentence still passes: ${sentence}`);
  });
});
