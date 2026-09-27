import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeTier, loadCardRegistry, parseCardText, renderCard, validateRegistry, type CardFinding } from '../../src/artifacts/card.ts';

function templateCard(overrides: Partial<Record<string, string>> = {}, extraFm = ''): string {
  const fm: Record<string, string> = {
    id: 'T1-FOO',
    title: 'one-sentence deliverable',
    status: 'todo            # todo | in-progress | in-review | merged',
    branch: 'T1-FOO',
    worktree: 'C:\\wt\\T1-FOO   # = <WorktreeRoot>\\<id>',
    allow_paths: '            # the paths this card may change\n  # A new tool in dod_command means the manifest sits here too.\n  - src/foo.ts',
    dod_command: 'node --test tests/foo.test.ts   # only tools CI already has',
    dod_exit: '0',
    review_gate: 'codex {verdict:pass}   # optional',
    acceptance: '\n  - 1. foo returns bar for baz input. [dod arm 1]\n  - 2. foo rejects null input. [dod arm 2]',
    ...overrides,
  };
  const lines = ['---', '# id naming (machine-checked): T<stage>-<UPPER-KEBAB>'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === '') continue;
    lines.push(v.startsWith('\n') || v.startsWith(' ') ? `${k}:${v}` : `${k}: ${v}`);
  }
  lines.push('# depends_on: []       # prerequisite card ids');
  if (extraFm) lines.push(extraFm);
  lines.push('---', '', `# ${fm['id']}`, '', '## Deliverable', 'The single deliverable.', '', '## Acceptance', '```powershell', 'node --test tests/foo.test.ts', '```', '- Expected exit code: 0', '');
  return lines.join('\n');
}

function blocks(findings: CardFinding[]): string[] {
  return findings.filter((f) => f.severity === 'block').map((f) => f.sentinel);
}

function sentinels(findings: CardFinding[]): string[] {
  return findings.map((f) => f.sentinel);
}

test('scaffold-style card with comment lines parses without blocking findings', () => {
  const r = parseCardText(templateCard(), 'D:/x/specs/tasks/T1-FOO.md');
  assert.ok(!('error' in r), JSON.stringify(r));
  assert.equal(r.card.id, 'T1-FOO');
  assert.equal(r.card.status, 'todo');
  assert.equal(r.card.dod_command, 'node --test tests/foo.test.ts');
  assert.deepEqual(r.card.allow_paths, ['src/foo.ts']);
  assert.equal(r.card.review_gate, 'codex {verdict:pass}');
  assert.equal(r.card.acceptance.length, 2);
  assert.equal(r.card.tdd, true);
  assert.deepEqual(blocks(r.findings), []);
  assert.ok(!sentinels(r.findings).includes('[CARD-FM-GARBAGE]'));
  assert.ok(r.body.includes('## Deliverable'));
});

test('no front matter is an error', () => {
  const r = parseCardText('# T1-FOO\nno front matter');
  assert.ok('error' in r);
  assert.equal(r.findings[0]?.sentinel, '[CARD-FM-MISSING]');
});

test('garbage front-matter line is blocking', () => {
  const r = parseCardText(templateCard({}, 'this line has no colon'), 'T1-FOO.md');
  assert.ok(!('error' in r));
  assert.ok(blocks(r.findings).includes('[CARD-FM-GARBAGE]'));
});

test('id must equal file name', () => {
  const r = parseCardText(templateCard(), 'D:/x/T1-BAR.md');
  assert.ok(!('error' in r));
  assert.ok(blocks(r.findings).includes('[CARD-ID-FILENAME]'));
});

test('branch and worktree drift are blocking', () => {
  const b = parseCardText(templateCard({ branch: 'T1-OTHER' }), 'T1-FOO.md');
  assert.ok(!('error' in b));
  assert.ok(blocks(b.findings).includes('[CARD-BRANCH-DRIFT]'));
  const w = parseCardText(templateCard({ worktree: 'C:\\wt\\OTHER' }), 'T1-FOO.md');
  assert.ok(!('error' in w));
  assert.ok(blocks(w.findings).includes('[CARD-WORKTREE-DRIFT]'));
});

test('dod_command traps: no-op, block scalar, nested pwsh variable', () => {
  const noop = parseCardText(templateCard({ dod_command: 'echo ok' }), 'T1-FOO.md');
  assert.ok(!('error' in noop));
  assert.ok(blocks(noop.findings).includes('[CARD-DOD-NOOP]'));
  const block = parseCardText(templateCard({ dod_command: '|' }), 'T1-FOO.md');
  assert.ok(!('error' in block));
  assert.ok(blocks(block.findings).includes('[CARD-DOD-BLOCK-SCALAR]'));
  const nested = parseCardText(templateCard({ dod_command: 'pwsh -Command "node run.js $Target"' }), 'T1-FOO.md');
  assert.ok(!('error' in nested));
  assert.ok(blocks(nested.findings).includes('[CARD-DOD-NESTED-VAR]'));
});

test('more than five allow_paths requires a sweep', () => {
  const six = '\n  - a/1\n  - a/2\n  - a/3\n  - a/4\n  - a/5\n  - a/6';
  const r = parseCardText(templateCard({ allow_paths: six }), 'T1-FOO.md');
  assert.ok(!('error' in r));
  assert.ok(blocks(r.findings).includes('[CARD-SWEEP]'));
  const ok = parseCardText(templateCard({ allow_paths: six, sweep: '"grep -r foo; found 3 faces"' }), 'T1-FOO.md');
  assert.ok(!('error' in ok));
  assert.ok(!blocks(ok.findings).includes('[CARD-SWEEP]'));
});

test('template token literal and missing acceptance with review_gate are blocking', () => {
  const tok = parseCardText(templateCard({ title: 'deliver {{PROJECT_NAME}}' }), 'T1-FOO.md');
  assert.ok(!('error' in tok));
  assert.ok(blocks(tok.findings).includes('[CARD-TOKEN-LITERAL]'));
  const acc = parseCardText(templateCard({ acceptance: '' }), 'T1-FOO.md');
  assert.ok(!('error' in acc));
  assert.ok(blocks(acc.findings).includes('[CARD-ACCEPTANCE]'));
});

test('dangling [R<n>] citation blocks; declared requirement passes', () => {
  const dangling = parseCardText(templateCard({ requirements: '\n  - R1. The system shall store the record.', acceptance: '\n  - 1. record is stored. [R2]' }), 'T1-FOO.md');
  assert.ok(!('error' in dangling));
  assert.ok(blocks(dangling.findings).includes('[CARD-REQ-DANGLING]'));
  const ok = parseCardText(templateCard({ requirements: '\n  - R1. The system shall store the record.', acceptance: '\n  - 1. record is stored. [R1]' }), 'T1-FOO.md');
  assert.ok(!('error' in ok));
  assert.ok(!blocks(ok.findings).includes('[CARD-REQ-DANGLING]'));
});

test('tier value outside S/1/0 is refused', () => {
  const r = parseCardText(templateCard({ tier: '2' }), 'T1-FOO.md');
  assert.ok(!('error' in r));
  assert.ok(blocks(r.findings).includes('[CARD-TIER-BADVALUE]'));
  assert.equal(r.card.tier, undefined);
});

test('placeholder and instruction-shaped acceptance are warnings', () => {
  const ph = parseCardText(templateCard({ allow_paths: '\n  - path/to/thing' }), 'T1-FOO.md');
  assert.ok(!('error' in ph));
  const w = ph.findings.find((f) => f.sentinel === '[CARD-PLACEHOLDER]');
  assert.equal(w?.severity, 'warn');
  const verb = parseCardText(templateCard({ acceptance: '\n  - 1. Verify the thing works. [dod arm 1]' }), 'T1-FOO.md');
  assert.ok(!('error' in verb));
  assert.equal(verb.findings.find((f) => f.sentinel === '[CARD-ACC-VERB]')?.severity, 'warn');
});

test('schema violation (bad status) is an error with CARD-SCHEMA findings', () => {
  const r = parseCardText(templateCard({ status: 'done' }), 'T1-FOO.md');
  assert.ok('error' in r);
  assert.ok(r.findings.some((f) => f.sentinel === '[CARD-SCHEMA]' && f.message.startsWith('status')));
});

// BUG: inline flow lists (`depends_on: [T1-A]`) parse to [] because blockList returns an empty
// array (not undefined) when the key exists, so `?? parseInlineList(...)` never runs. The scaffold
// template itself documents the inline form (`depends_on: []`, `parallelizable_with: []`).
test('inline depends_on list is parsed', () => {
  const r = parseCardText(templateCard({ depends_on: '[T1-A, T1-B]' }), 'T1-FOO.md');
  assert.ok(!('error' in r));
  assert.deepEqual(r.card.depends_on, ['T1-A', 'T1-B']);
});

test('computeTier: S wins, all Tier-0 => 0, else 1, empty TierS list => S, frozen fragment => S', () => {
  const tierPaths = { tierS: ['scripts/task.ps1', '.github/workflows/'], tier0: ['docs/', '*.md'], frozen: ['android/core/src/main/sqldelight/'] };
  assert.equal(computeTier(['scripts/task.ps1'], tierPaths), 'S');
  assert.equal(computeTier(['scripts/'], tierPaths), 'S'); // containment in both directions
  assert.equal(computeTier(['docs/x.md', 'README.md'], tierPaths), '0');
  assert.equal(computeTier(['src/a.ts'], tierPaths), '1');
  assert.equal(computeTier(['src/a.ts', 'docs/x.md'], tierPaths), '1');
  assert.equal(computeTier(['android/core/src/main/sqldelight/Foo.sq'], tierPaths), 'S');
  assert.equal(computeTier(['src/a.ts'], {}), 'S');
});

test('registry: dangling depends_on, parallel overlap, computed tier and declared-lower', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-cards-'));
  const tasks = path.join(dir, 'tasks');
  const archive = path.join(dir, 'archive');
  mkdirSync(tasks);
  mkdirSync(archive);
  writeFileSync(path.join(tasks, '_TEMPLATE.md'), templateCard({ id: 'T?-EXAMPLE' }), 'utf8');
  writeFileSync(path.join(tasks, 'T1-A.md'), templateCard({ id: 'T1-A', branch: 'T1-A', worktree: 'C:\\wt\\T1-A', allow_paths: '\n  - src/a/', parallelizable_with: '\n  - T1-B' }), 'utf8');
  writeFileSync(path.join(tasks, 'T1-B.md'), templateCard({ id: 'T1-B', branch: 'T1-B', worktree: 'C:\\wt\\T1-B', allow_paths: '\n  - src/a/inner.ts', depends_on: '\n  - T1-MISSING' }), 'utf8');
  writeFileSync(path.join(tasks, 'T1-C.md'), templateCard({ id: 'T1-C', branch: 'T1-C', worktree: 'C:\\wt\\T1-C', allow_paths: '\n  - scripts/task.ps1', tier: '0' }), 'utf8');
  writeFileSync(path.join(tasks, 'T1-D.md'), templateCard({ id: 'T1-D', branch: 'T1-D', worktree: 'C:\\wt\\T1-D', allow_paths: '\n  - docs/notes.md' }), 'utf8');
  writeFileSync(path.join(archive, 'T0-OLD.md'), templateCard({ id: 'T0-OLD', branch: 'T0-OLD', worktree: 'C:\\wt\\T0-OLD', status: 'merged', depends_on: '\n  - T0-GONE' }), 'utf8');

  const reg = loadCardRegistry(tasks, archive);
  assert.equal(reg.errors.length, 0, JSON.stringify(reg.errors));
  assert.deepEqual(reg.cards.map((c) => c.card.id).sort(), ['T0-OLD', 'T1-A', 'T1-B', 'T1-C', 'T1-D']);
  const findings = validateRegistry(reg, { tierS: ['scripts/task.ps1'], tier0: ['docs/', '*.md'] });

  const b = findings.get('T1-B')!;
  assert.ok(b.some((f) => f.sentinel === '[CARD-REF-DANGLING]' && f.severity === 'block' && f.message.includes('T1-MISSING')));
  const a = findings.get('T1-A')!;
  assert.ok(a.some((f) => f.sentinel === '[CARD-PARALLEL-OVERLAP]' && f.severity === 'block'));
  const c = findings.get('T1-C')!;
  assert.ok(c.some((f) => f.sentinel === '[CARD-TIER-LOWER]' && f.severity === 'block'));
  const d = findings.get('T1-D')!;
  assert.ok(d.some((f) => f.sentinel === '[CARD-TIER]' && f.message.includes('tier=0')));
  assert.ok(a.some((f) => f.sentinel === '[CARD-TIER]' && f.message.includes('tier=1')));
  // archived cards keep history: no dangling-ref check, no findings
  assert.deepEqual(findings.get('T0-OLD'), []);
});

test('renderCard output re-parses with zero blocking findings', () => {
  const text = renderCard({
    id: 'T2-NEW',
    title: 'New thing works end to end',
    allowPaths: ['src/new.ts', 'tests/new.test.ts'],
    dodCommand: 'node --test tests/new.test.ts',
    acceptance: ['1. new returns the expected value. [dod arm 1]', '2. rejects bad input. [R1]'],
    requirements: ['R1. The system shall reject malformed input.'],
    dependsOn: ['T1-FOO'],
    planRef: 'docs/plans/PLAN.md#new',
    budget: 200,
    nonGoals: ['no UI'],
    tdd: false,
    freeze: true,
    resources: ['port:8080'],
    deliverable: 'The new module.',
    dodAssert: 'all assertions hold',
  });
  const r = parseCardText(text, 'D:/x/T2-NEW.md');
  assert.ok(!('error' in r), JSON.stringify(r));
  assert.deepEqual(blocks(r.findings), [], JSON.stringify(r.findings));
  assert.equal(r.card.id, 'T2-NEW');
  assert.equal(r.card.branch, 'T2-NEW');
  assert.equal(r.card.budget, 200);
  assert.equal(r.card.tdd, false);
  assert.equal(r.card.freeze, true);
  assert.deepEqual(r.card.depends_on, ['T1-FOO']);
  assert.deepEqual(r.card.resources, ['port:8080']);
  assert.throws(() => renderCard({ id: 'bad-id', title: 't', allowPaths: ['x'], dodCommand: 'node x', acceptance: [], deliverable: 'd' }));
});

describe('[CARD-FM-COMMENT-CUT] (T0-FM-COMMENT-CUT, issue 97)', () => {
  const H = '#';
  /** The three known cases of the issue, as they were written. */
  const KNOWN: Array<[string, string, string]> = [
    ['T1-PARSE-GUARD acceptance 7', `7. Each of the six items of issue ${H}45 has a test with the decided outcome (a timeout with quota text on stderr stays \`timeout\`), and the ${H}41 cases (capitalised abbreviations, the numbered-list branch, capitalised With and Subagent, opening quotes) have prose-lint tests (tests/core/parse-guard.test.ts, tests/surface/prose.test.ts). [R4] [dod arm 1]`, '7. Each of the six items of issue'],
    ['T1-STORE-CAS-2 acceptance 14', `14. Issue ${H}87 item 1: a lock file that cannot be read at the ownership check or the release leaves the change's return value or its thrown error as the result of \`updateJson\` (tests/infra/update-json.test.ts). [R8] [dod arm 1]`, '14. Issue'],
    ['T1-STORE-CAS-2 acceptance 15', `15. Issue ${H}87 item 2: an exclusive create that fails with EPERM while the lock path does not exist propagates the error instead of waiting for \`LOCKED\` (tests/infra/update-json.test.ts). [R9] [dod arm 1]`, '15. Issue'],
  ];
  const cuts = (r: ReturnType<typeof parseCardText>) => ('error' in r ? r.findings : r.findings).filter((f) => f.sentinel === '[CARD-FM-COMMENT-CUT]');
  const message = (key: string, raw: string, kept: string) => {
    const at = raw.length - raw.slice(kept.length).trimStart().length;
    return `${key}: the comment "${raw.slice(at)}" cuts "${raw}" to "${kept}"; write the number without the hash sign, or quote the value`;
  };
  const withItem = (item: string, overrides: Partial<Record<string, string>> = {}, extra = '') => parseCardText(templateCard({ acceptance: `\n  - 1. foo returns bar for baz input. [dod arm 1]\n  - ${item}`, ...overrides }, extra), 'D:/x/specs/tasks/T1-FOO.md');

  test('the three known cases give one finding each, naming the item with its raw and kept text; quoted, they keep the hash and give none [R1] [R2]', () => {
    for (const [label, item, kept] of KNOWN) {
      const r = withItem(item);
      assert.ok(!('error' in r), label);
      assert.deepEqual(cuts(r).map((f) => ({ severity: f.severity, message: f.message })), [{ severity: 'block', message: message('acceptance item 2', item, kept) }], label);
      assert.equal(r.card.acceptance[1], kept, `${label}: the reader keeps what YAML keeps`);
      const quoted = withItem(`"${item.replace(/"/g, '\\"')}"`);
      assert.ok(!('error' in quoted), label);
      assert.deepEqual(cuts(quoted), [], `${label}, quoted: no finding`);
      assert.ok(quoted.card.acceptance[1]!.includes(`${H}87`) || quoted.card.acceptance[1]!.includes(`${H}45`), `${label}, quoted: the hash is kept`);
    }
  });

  test('blocking on a todo, in-progress or in-review card; a warning on a merged or superseded card [R2]', () => {
    const [, item] = KNOWN[1]!;
    for (const status of ['todo', 'in-progress', 'in-review']) assert.deepEqual(cuts(withItem(item, { status })).map((f) => f.severity), ['block'], status);
    assert.deepEqual(cuts(withItem(item, { status: 'merged' })).map((f) => f.severity), ['warn'], 'merged');
    assert.deepEqual(cuts(withItem(item, {}, 'superseded_by: T1-BAR')).map((f) => f.severity), ['warn'], 'superseded');
  });

  test('a title, a nested diagnosis key and an inline flow list are reported under their key; a hash-space comment gives no finding [R2]', () => {
    const title = parseCardText(templateCard({ title: `fix the cut (issue ${H}97)` }), 'D:/x/specs/tasks/T1-FOO.md');
    assert.deepEqual(cuts(title).map((f) => f.message), [message('title', `fix the cut (issue ${H}97)`, 'fix the cut (issue')]);
    const nested = parseCardText(templateCard({}, `diagnosis:\n  root_cause: "the reader cuts at a hash"\n  same_class: see issue ${H}97 and ${H}45`), 'D:/x/specs/tasks/T1-FOO.md');
    assert.deepEqual(cuts(nested).map((f) => f.message), [message('diagnosis.same_class', `see issue ${H}97 and ${H}45`, 'see issue')]);
    const inline = parseCardText(templateCard({}, `non_goals: [the plain item ${H}5, "the quoted item ${H}6"]`), 'D:/x/specs/tasks/T1-FOO.md');
    assert.deepEqual(cuts(inline).map((f) => f.message), [message('non_goals', `[the plain item ${H}5, "the quoted item ${H}6"]`, '[the plain item')]);
    const quotedInline = parseCardText(templateCard({}, `non_goals: ["the quoted item ${H}6", 'another ${H}7']`), 'D:/x/specs/tasks/T1-FOO.md');
    assert.deepEqual(cuts(quotedInline), []);
    assert.ok(!('error' in quotedInline) && quotedInline.card.non_goals?.[0] === `the quoted item ${H}6`, 'a quoted flow-list item keeps its hash');
    assert.deepEqual(cuts(parseCardText(templateCard(), 'D:/x/specs/tasks/T1-FOO.md')), [], 'the scaffold template card annotates its keys with hash-space comments');
  });

  test('a key written without a space after its colon is reported, top-level and nested, as the readers read and cut it [R2]', () => {
    const r = parseCardText(templateCard({}, `sweep:see issue ${H}12\ndiagnosis:\n  root_cause: "the reader cuts at a hash"\n  same_class:see issue ${H}97`), 'D:/x/specs/tasks/T1-FOO.md');
    assert.ok(!('error' in r));
    assert.equal(r.card.sweep, 'see issue', 'the reader reads the top-level key and cuts it');
    assert.equal(r.card.diagnosis?.same_class, 'see issue', 'the reader reads the nested key and cuts it');
    assert.deepEqual(cuts(r).map((f) => f.message), [message('sweep', `see issue ${H}12`, 'see issue'), message('diagnosis.same_class', `see issue ${H}97`, 'see issue')]);
  });

  test('the body of a literal or a folded block scalar is text under a key, a nested key, a list item and a key inside a list item, and the lines after it are read again [R2]', () => {
    for (const header of ['|', '>-', '|2+', `| ${H} a note`, `>- ${H}3`]) {
      const fm = `notes: ${header}\n  - issue ${H}45\n\n  - more ${H}46 text\ndiagnosis:\n  root_cause: "x"\n  same_class: ${header}\n    see ${H}97\nnon_goals:\n  - ${header}\n    see ${H}98\n  - plain ${H}99\n  - note: ${header}\n      - see ${H}100\n    other: x ${H}101\nsweep: see ${H}12`;
      const r = parseCardText(templateCard({}, fm), 'D:/x/specs/tasks/T1-FOO.md');
      assert.deepEqual(cuts(r).map((f) => f.message), [message('non_goals item 2', `plain ${H}99`, 'plain'), message('non_goals.other', `x ${H}101`, 'x'), message('sweep', `see ${H}12`, 'see')], header);
    }
  });

  test('a quoted inline item holding a comma is read whole with its hash and gives no finding [R1] [R2]', () => {
    const r = parseCardText(templateCard({}, `non_goals: ["see issue, ${H}45", 'a, b ${H}46', plain]`), 'D:/x/specs/tasks/T1-FOO.md');
    assert.ok(!('error' in r));
    assert.deepEqual(r.card.non_goals, [`see issue, ${H}45`, `a, b ${H}46`, 'plain']);
    assert.deepEqual(cuts(r), []);
  });

  test('a hash after a non-breaking space is text: the title is read whole and gives no finding [R1] [R2]', () => {
    const r = parseCardText(templateCard({ title: `fix the cut\u00a0${H}97` }), 'D:/x/specs/tasks/T1-FOO.md');
    assert.ok(!('error' in r));
    assert.equal(r.card.title, `fix the cut\u00a0${H}97`);
    assert.deepEqual(cuts(r), []);
  });

  test('this repository loads with no blocking comment cut, and T0-PASS-REASONS-WORDING keeps its issue number [R3]', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const registry = loadCardRegistry(path.join(root, 'specs', 'tasks'));
    const blocking = registry.cards.flatMap((c) => c.findings.filter((f) => f.sentinel === '[CARD-FM-COMMENT-CUT]' && f.severity === 'block').map((f) => `${c.card.id} ${f.message}`));
    assert.deepEqual(blocking, []);
    const wording = registry.cards.find((c) => c.card.id === 'T0-PASS-REASONS-WORDING')!;
    assert.ok(wording.card.title.endsWith('(issue 91)'), wording.card.title);
  });

  test('the CHANGELOG Unreleased section states the comment rule and the report [R4]', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const entry = '- Card front matter comments, card T0-FM-COMMENT-CUT (issue 97): a hash after a space or a tab starts a comment, as YAML reads it, a hash inside a quoted value or a quoted flow-list item is kept, and an inline list splits only at a comma outside a quoted item; `aidlc cards validate` reports as `[CARD-FM-COMMENT-CUT]` every value a comment cuts at a hash directly followed by text (an issue or a PR number), with the raw and the kept text, blocking on a card that is neither merged nor superseded, and reads a block-scalar body as text; T1-PARSE-GUARD acceptance 7 and T1-STORE-CAS-2 acceptance 14 and 15 had reached R2 and R3 cut this way.';
    assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
  });
});
