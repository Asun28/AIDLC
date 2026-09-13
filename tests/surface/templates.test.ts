import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvalCase } from '../../src/evals/runner.ts';
import { DeliveryOpsConfig } from '../../src/delivery/ops.ts';
import { ProjectConfig } from '../../src/config.ts';
import { parseBandsYaml, DEFAULT_BANDS_YAML } from '../../src/maintain/bands.ts';
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

  test('JSON/YAML templates validate against the runtime schemas', () => {
    EvalCase.parse(JSON.parse(readFileSync(path.join(tpl, 'evals', 'example-regression.json'), 'utf8')));
    DeliveryOpsConfig.parse(JSON.parse(readFileSync(path.join(tpl, 'aidlc.ops.example.json'), 'utf8')));
    ProjectConfig.parse(JSON.parse(readFileSync(path.join(tpl, 'aidlc.config.json'), 'utf8')));
    const bands = parseBandsYaml(readFileSync(path.join(tpl, 'bands.yaml'), 'utf8'));
    assert.equal(bands.metric, parseBandsYaml(DEFAULT_BANDS_YAML).metric);
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
});
