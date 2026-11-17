// Card T1-XHIGH-COORDINATOR-EFFORT: the router skill's Effort section starts helpers as named agents at medium, and docs/OPERATIONS.md says who sets the coordinator's effort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = ['templates/claude/skills/aidlc-loop/SKILL.md', '.claude/skills/aidlc-loop/SKILL.md'];
const CARD_LOOPS = ['templates/claude/skills/aidlc-loop/card-loop.md', '.claude/skills/aidlc-loop/card-loop.md'];

const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

test('acceptance 1: both router skill copies hold the Effort section of Acceptance detail, equal, ASCII, at most 4500 bytes [R4] [R5]', () => {
  const section = [
    '## Effort (MA1/MA2)',
    'Assess each task alone (uncertainty, scope, risk, verification burden),',
    "never by the coordinator's effort; start helpers (search, fetch) as named",
    'agents at `medium`, not as forks. At most 4 counted attempts: baseline + 2',
    'repairs + 1 justified escalation to the next supported level. Same cause',
    'twice with no progress => stop early. Quota, expected RED, tool outage and',
    'env setup do not count.',
    '',
  ].join('\n');
  const bodies = SKILLS.map((rel) => readFileSync(path.join(root, rel)));
  for (const [i, body] of bodies.entries()) {
    const text = body.toString('utf8');
    const start = text.indexOf('## Effort (MA1/MA2)\n');
    const end = text.indexOf('\n## Output', start);
    assert.ok(start >= 0 && end > start, `${SKILLS[i]} has an Effort section before Output`);
    assert.equal(text.slice(start, end), section, `${SKILLS[i]} Effort section`);
    assert.ok(body.every((b) => b < 0x80), `${SKILLS[i]} is ASCII`);
    assert.ok(body.length <= 4500, `${SKILLS[i]} is ${body.length} bytes, cap 4500`);
  }
  assert.ok(bodies[0]!.equals(bodies[1]!), 'the two router skill copies are byte-identical');
});

test('acceptance 2: the router skill drops the attempt sentence that card-loop.md BUILD states [R5]', () => {
  for (const rel of SKILLS) {
    assert.ok(!read(rel).includes('records every attempt'), `${rel} no longer says records every attempt`);
  }
  for (const rel of CARD_LOOPS) {
    const folded = read(rel).replace(/\s+/g, ' ');
    assert.ok(folded.includes('Attempts (MA2): `aidlc card attempt <id>'), `${rel} states Attempts (MA2)`);
    assert.ok(folded.includes('no fifth from another session or card'), `${rel} states no fifth attempt`);
  }
});

test("acceptance 3: docs/OPERATIONS.md states the coordinator's effort two lines after the Claude Code effort paragraph [R6]", () => {
  const paragraph = "Coordinator effort (card T1-XHIGH-COORDINATOR-EFFORT). The coordinator's effort is the effort of the Claude Code session that runs the loop: the owner sets it with the session, and aidlc neither sets nor records it. On Claude Opus 5.5 a higher level means more thinking per turn, and the Effort guide says it can also mean more tool calls, a plan stated before acting and longer summaries, so at `xhigh` a coordinator turn takes longer and costs more than at `medium`, the model's default. The Opus 5.5 guides list `xhigh` for agentic work of over 30 minutes and reserve `xhigh` and `max` for work where a quality gain was measured; this repository has measured none for the coordinator and recommends no level. To shorten coordinator turns, lower the session's effort: that reduces thinking more reliably than prose does, and the loop's agent, skill and instruction files carry no line that asks the model to think more or less or to hold back its updates (`tests/surface/prose.test.ts`). A helper subagent the coordinator starts for a search or a fetch is a named agent type at `medium` (the router skill, Effort), since a fork runs at the session's effort; an implementer runs at the `run-card` directive's effort, and the other agent files name their own.";
  const lines = read('docs/OPERATIONS.md').split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('Claude Code effort (card T0-CLAUDE-EFFORT-OPT-IN)'));
  assert.ok(i >= 0, 'docs/OPERATIONS.md has the Claude Code effort paragraph');
  assert.equal(lines[i + 1], '', 'an empty line before the paragraph');
  assert.equal(lines[i + 2], paragraph, 'the Coordinator effort paragraph');
  assert.equal(lines[i + 3], '', 'an empty line after the paragraph');
});
