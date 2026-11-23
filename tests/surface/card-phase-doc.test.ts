/**
 * T0-CARD-PHASE-DOC (issue 419): the Scaffold phase commands paragraph of docs/OPERATIONS.md names the phase commands
 * and the options the CLI has, and the CLI does what the paragraph says on the scaffold ship path and on the other two.
 * A phase command or option added, removed or changed later fails here until the paragraph follows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCliInProcess } from '../infra/cli-inprocess.ts';
import { tmpDir } from '../infra/helpers.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const LEAD = 'Scaffold phase commands (card T0-CARD-PHASE-DOC, issue 419):';
const BEFORE = 'PREPARE and the card worktree';
/** The four commands R1 names, in the order of the CLI's help. */
const PHASES = ['start', 'red', 'ship', 'cleanup'];
const OPTIONS = ['--base <ref>', '--local'];
const CARD = 'T1-FOO';
const refusal = (shipPath: string): string => `aidlc: ship path is ${shipPath}; task.ps1 phases apply to the scaffold path only`;

/** A `scripts/task.ps1` that writes its parameters to `ran-<phase>.json` in the directory it runs in and exits 7. */
const SCRIPT = [
  'param([string]$TaskId, [string]$Phase, [string]$Base, [switch]$Local)',
  '$record = @{ taskId = $TaskId; phase = $Phase; base = $Base; local = [bool]$Local; extra = @($args) }',
  'Set-Content -LiteralPath (Join-Path (Get-Location) "ran-$Phase.json") -Value (ConvertTo-Json $record -Compress)',
  'exit 7',
  '',
].join('\n');

/** The lines of the `### T0 bugfix` section of docs/OPERATIONS.md, and the index of the paragraph R1 places after the PREPARE one. */
function operations(): { all: string[]; section: string[]; at: number } {
  const all = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').split(/\r?\n/);
  const section = all.slice(all.indexOf('### T0 bugfix'), all.indexOf('### T1 feature'));
  return { all, section, at: section.findIndex((l) => l.startsWith(BEFORE)) + 2 };
}

/** The paragraph, the empty string while it is absent. */
function paragraph(): string {
  const { section, at } = operations();
  const line = section[at] ?? '';
  return line.startsWith(LEAD) ? line : '';
}

/** A git repository with `config` as its aidlc.config.json, the recording `scripts/task.ps1` and a subdirectory to run from. */
function fixture(config: Record<string, unknown>): { repo: string; sub: string; env: NodeJS.ProcessEnv } {
  const repo = tmpDir('aidlc-phase-doc-');
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const sub = path.join(repo, 'sub');
  mkdirSync(path.join(repo, 'scripts'));
  mkdirSync(sub);
  writeFileSync(path.join(repo, 'scripts', 'task.ps1'), SCRIPT);
  writeFileSync(path.join(repo, 'aidlc.config.json'), JSON.stringify(config));
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: tmpDir('aidlc-phase-doc-state-'), AIDLC_SESSION: 'phase-doc' };
  delete env['AIDLC_RUN_NO_SHIP'];
  return { repo, sub, env };
}

/** The records the script left in `dir`, by file name, each removed once read. */
function records(dir: string): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter((n) => n.startsWith('ran-'))) {
    found[name] = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    rmSync(path.join(dir, name));
  }
  return found;
}

/** The entries of a list of a commander help text (`Commands:` or `Options:`), each with its wrapped lines joined by one space. */
function helpList(help: string, heading: string): string[] {
  const lines = help.split(/\r?\n/);
  const entries: string[] = [];
  for (const line of lines.slice(lines.indexOf(heading) + 1)) {
    if (!line.trim()) break;
    if (/^ {2}\S/.test(line) || !entries.length) entries.push(line.trim());
    else entries[entries.length - 1] = `${entries.at(-1)} ${line.trim()}`;
  }
  return entries;
}

test('acceptance 1: the paragraph follows the PREPARE paragraph and names exactly the phase commands and the options of the CLI help [R1] [R4]', async () => {
  const { all, section, at } = operations();
  assert.deepEqual([section[at - 1], section[at]?.startsWith(LEAD), section[at + 1]], ['', true, ''], `the paragraph after the one that begins "${BEFORE}" begins "${LEAD}"`);
  assert.equal(all.filter((l) => l.includes(LEAD)).length, 1, 'docs/OPERATIONS.md holds the paragraph once');
  const named = [...paragraph().matchAll(/`aidlc card (\S+) <id>`/g)].map((m) => m[1]);
  assert.deepEqual(named, PHASES, 'the commands the paragraph names');

  const { repo, env } = fixture({ shipPath: 'scaffold' });
  const help = await runCliInProcess(['card', '--help'], { cwd: repo, env });
  assert.equal(help.status, 0, help.stderr);
  const phaseEntries = helpList(help.stdout, 'Commands:').filter((entry) => entry.includes('task.ps1 -Phase'));
  assert.deepEqual(phaseEntries.map((entry) => entry.split(' ')[0]), named, 'the card subcommands whose help line names task.ps1 -Phase');
  for (const [i, entry] of phaseEntries.entries()) assert.ok(entry.includes(`task.ps1 -Phase ${PHASES[i]} `), entry);

  const namedOptions = [...new Set([...paragraph().matchAll(/`(--[^`]+)`/g)].map((m) => m[1]))];
  assert.deepEqual(namedOptions, OPTIONS, 'the options the paragraph names');
  for (const phase of PHASES) {
    const own = await runCliInProcess(['card', phase, '--help'], { cwd: repo, env });
    assert.equal(own.status, 0, own.stderr);
    assert.deepEqual(helpList(own.stdout, 'Options:').filter((entry) => entry.startsWith('--')), namedOptions, `the options of card ${phase}`);
  }
});

test('acceptance 2: on the scaffold ship path each command runs task.ps1 in the main checkout with -TaskId, its own -Phase, -Base and, when asked, -Local, and exits with the script\'s exit code [R2] [R4]', async () => {
  for (const statement of ['`-TaskId <id>`', '`-Phase`', '`-Base`', '`-Local`', '`mode: local`']) assert.ok(paragraph().includes(statement), `the paragraph states ${statement}`);
  const { repo, sub, env } = fixture({ shipPath: 'scaffold' });
  const local = fixture({ shipPath: 'scaffold', mode: 'local' });
  const record = (phase: string, base: string, isLocal: boolean) => ({ [`ran-${phase}.json`]: { taskId: CARD, phase, base, local: isLocal, extra: [] } });
  for (const phase of PHASES) {
    // No option: the configured base (`main` by default), no -Local; the script ran in the main checkout, not in the subdirectory.
    const plain = await runCliInProcess(['card', phase, CARD], { cwd: sub, env });
    assert.deepEqual([plain.status, records(repo), records(sub)], [7, record(phase, 'main', false), {}], `card ${phase}: ${plain.stderr}`);
    const withOptions = await runCliInProcess(['card', phase, CARD, '--base', 'other', '--local'], { cwd: sub, env });
    assert.deepEqual([withOptions.status, records(repo), records(sub)], [7, record(phase, 'other', true), {}], `card ${phase} --base other --local: ${withOptions.stderr}`);
    const configured = await runCliInProcess(['card', phase, CARD], { cwd: local.sub, env: local.env });
    assert.deepEqual([configured.status, records(local.repo), records(local.sub)], [7, record(phase, 'main', true), {}], `card ${phase} under mode local: ${configured.stderr}`);
  }
});

for (const shipPath of ['github', 'dry-run']) {
  test(`acceptance 3: on the ${shipPath} ship path each command exits 1 with the refusal the paragraph quotes and runs nothing [R3] [R4]`, async () => {
    assert.ok(paragraph().includes(`\`${refusal('<path>')}\``), 'the paragraph quotes the refusal');
    const { repo, sub, env } = fixture({ shipPath });
    for (const phase of PHASES) {
      for (const argv of [['card', phase, CARD], ['card', phase, CARD, '--base', 'other', '--local']]) {
        const r = await runCliInProcess(argv, { cwd: sub, env });
        assert.deepEqual([r, records(repo), records(sub)], [{ status: 1, stdout: '', stderr: `${refusal(shipPath)}\n` }, {}, {}], argv.join(' '));
      }
    }
  });
}
