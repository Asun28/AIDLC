import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOOK_CONFIG, runHook, type HookEvent, type HookResult } from '../../src/hooks/index.ts';
import { dispatchHook } from '../../src/hooks/entry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Joined at runtime: the production gate also reads the commands that edit this file.
const VERB = 'deploy';
const PLACE = 'prod';
const PAIR = [VERB, PLACE].join(' ');
const FROZEN = 'contracts/api.yaml';
const NOTE = 'this command references a frozen path';

type Decision = 'exit 2' | 'deny' | 'defer' | 'none';

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function context(frozenPaths?: string[]): { cwd: string; env: NodeJS.ProcessEnv } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-ps-read-'));
  dirs.push(cwd);
  if (frozenPaths) writeFileSync(path.join(cwd, 'aidlc.config.json'), JSON.stringify({ hooks: { frozenPaths } }));
  return { cwd, env: { PATH: process.env['PATH'], AIDLC_STATE_DIR: path.join(cwd, 'state') } };
}

function shell(tool_name: 'Bash' | 'PowerShell', command: string): HookEvent {
  return { hook_event_name: 'PreToolUse', tool_name, tool_input: { command } };
}

function decision(r: HookResult): Decision {
  if (r.exitCode === 2) return 'exit 2';
  const parsed = JSON.parse(r.stdout ?? '{}') as { hookSpecificOutput?: { permissionDecision?: 'deny' | 'defer' } };
  return parsed.hookSpecificOutput?.permissionDecision ?? 'none';
}

function decide(tool: 'Bash' | 'PowerShell', command: string, frozenPaths?: string[]): Decision {
  return decision(dispatchHook(shell(tool, command), context(frozenPaths)));
}

/** Not blocked at the merge of T1-PS-GUARD-WIRE on either tool. */
const NEW_READINGS: Array<[string, string]> = [
  ['the pair split by a backtick and a line feed', `${VERB} \`\n${PLACE}`],
  ['the pair split by a backtick and CRLF', `${VERB} \`\r\n${PLACE}`],
  ['inside Write-Output { ... }', `Write-Output { ${PAIR} }`],
  ['inside Write-Output ( ... )', `Write-Output ( ${PAIR} )`],
  ['inside Write-Output $( ... )', `Write-Output $( ${PAIR} )`],
];

/** Blocked at the merge of T1-PS-GUARD-WIRE on either tool. */
const PINS: Array<[string, string]> = [
  // The default patterns' `[^\n]*` crosses a bare carriage return, so this one matches the unsplit command.
  ['the pair split by a backtick and a carriage return', `${VERB} \`\r${PLACE}`],
  ['inside & { ... } after a read-only command', `Get-ChildItem; & { ${PAIR} }`],
  ['inside Get-Content a.txt | ForEach-Object { ... }', `Get-Content a.txt | ForEach-Object { ${PAIR} }`],
  ['in pwsh -Command after a read-only command', `Get-ChildItem; pwsh -Command "${PAIR}"`],
];

const WRITE_COMMANDS = ['sc', 'ac', 'ni', 'cpi', 'mi', 'rni', 'ren', 'rd', 'rmdir', 'erase', 'clc', 'si', 'copy', 'move', 'epcsv', 'Rename-Item', 'Clear-Content', 'Set-Item', 'Export-Csv', 'Export-Clixml'];

const writeForms = (word: string): Array<[string, string]> => [
  ['alone', `${word} ${FROZEN}`],
  ['in a pipeline', `Get-Content a.txt | ${word} ${FROZEN}`],
  ['in a script block', `Get-ChildItem | ForEach-Object { ${word} ${FROZEN} }`],
];

const OTHER_WRITES: Array<[string, string]> = [
  ['Invoke-WebRequest -OutFile', `Invoke-WebRequest https://example.test/a -OutFile ${FROZEN}`],
  ['-outfile in lower case', `Invoke-WebRequest https://example.test/a -outfile ${FROZEN}`],
  ['[IO.File]::WriteAllText', `[IO.File]::WriteAllText('${FROZEN}', 'x')`],
  ['[IO.File]::AppendAllText', `[IO.File]::AppendAllText('${FROZEN}', 'x')`],
  ['[IO.File]::Delete', `[IO.File]::Delete('${FROZEN}')`],
  ['[IO.File]::Move', `[IO.File]::Move('a.txt', '${FROZEN}')`],
  ['[IO.File]::Copy', `[IO.File]::Copy('a.txt', '${FROZEN}')`],
  ['[io.file]::writealltext in lower case', `[io.file]::writealltext('${FROZEN}', 'x')`],
];

/** One test per case: `title` names it, and the command of that case gets `expected` on `tool`. */
function each(cases: Array<[string, string]>, title: (name: string) => string, tool: 'Bash' | 'PowerShell', expected: Decision, frozenPaths?: string[]): void {
  for (const [name, command] of cases) test(title(name), () => assert.equal(decide(tool, command, frozenPaths), expected));
}

test('the pair matches a default production pattern', () => {
  assert.ok(DEFAULT_HOOK_CONFIG.productionPatterns.some((p) => new RegExp(p, 'i').test(PAIR)));
});

describe('T1-PS-GUARD-READ: production-gate on a PowerShell event', () => {
  each(NEW_READINGS, (name) => `acceptance 1: ${name} is blocked [R1]`, 'PowerShell', 'exit 2');
  each(PINS, (name) => `acceptance 1 pin: ${name} is blocked [R1]`, 'PowerShell', 'exit 2');

  test('acceptance 1: a read-only first word inside a script block still reads [R1]', () => {
    assert.equal(decide('PowerShell', `Write-Output { Write-Output ${PAIR} }; ( Get-Content a.txt )`), 'none');
  });

  test('acceptance 1: the classic pass does not read PowerShell shape [R1]', () => {
    assert.equal(decision(runHook('production-gate', shell('PowerShell', `Write-Output { ${PAIR} }`), { ...context(), classic: true })), 'none');
  });
});

describe('T1-PS-GUARD-READ: protect-paths on a PowerShell event', () => {
  for (const word of WRITE_COMMANDS) {
    each(writeForms(word), (form) => `acceptance 2: ${word} on a frozen path ${form} is denied [R2]`, 'PowerShell', 'deny', ['contracts/']);
  }
  each(OTHER_WRITES, (name) => `acceptance 2: ${name} on a frozen path is denied [R2]`, 'PowerShell', 'deny', ['contracts/']);

  test('acceptance 2: the classic pass does not read PowerShell write commands [R2]', () => {
    assert.equal(decision(runHook('protect-paths', shell('PowerShell', `ni ${FROZEN}`), { ...context(['contracts/']), classic: true })), 'defer');
  });

  test('acceptance 3: Get-Content of the frozen path is deferred with the note [R2]', () => {
    const r = dispatchHook(shell('PowerShell', `Get-Content ${FROZEN}`), context(['contracts/']));
    assert.equal(decision(r), 'defer');
    assert.ok(r.stdout?.includes(NOTE), r.stdout);
  });

  const reads: Array<[string, string]> = [
    ['a forward-slash path', 'Get-Content contracts/ni/api.yaml'],
    ['a backslash path', 'Get-Content contracts\\ni\\api.yaml'],
    ['a script block', 'Get-ChildItem | ForEach-Object { Get-Content contracts/ni/api.yaml }'],
  ];
  each(reads, (name) => `acceptance 3: a path segment spelled ni in a read is not a write: ${name} [R2]`, 'PowerShell', 'defer', ['contracts/']);
  each([['[IO.File]::ReadAllText', `[IO.File]::ReadAllText('${FROZEN}')`]], (name) => `acceptance 3: ${name} of the frozen path is deferred [R2]`, 'PowerShell', 'defer', ['contracts/']);
});

describe('T1-PS-GUARD-READ: a Bash event decides as at the merge of T1-PS-GUARD-WIRE', () => {
  each(NEW_READINGS, (name) => `acceptance 4: ${name} is not blocked on Bash [R3]`, 'Bash', 'none');
  each(PINS, (name) => `acceptance 4: ${name} stays blocked on Bash [R3]`, 'Bash', 'exit 2');
  for (const word of WRITE_COMMANDS) {
    each(writeForms(word), (form) => `acceptance 4: ${word} on a frozen path ${form} is deferred on Bash [R3]`, 'Bash', 'defer', ['contracts/']);
  }
  each(OTHER_WRITES, (name) => `acceptance 4: ${name} on a frozen path is deferred on Bash [R3]`, 'Bash', 'defer', ['contracts/']);
});

test('T1-PS-GUARD-READ acceptance 5: OPERATIONS and the CHANGELOG hold the exact texts [R4] [R5]', () => {
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = operations.indexOf('## Hooks');
  const hooks = operations.slice(start, operations.indexOf('\n## ', start + 1));
  const sentence = 'On a PowerShell event the guards also join a backtick line continuation, split at braces and parentheses, and count PowerShell\'s write commands and aliases as writes (card T1-PS-GUARD-READ); quotes are not read, so a separator inside quotes adds a segment, and `-EncodedCommand` is not decoded.';
  assert.ok(hooks.includes(`\n\n${sentence}\n\n`), `docs/OPERATIONS.md (Hooks) states as its own paragraph: ${sentence}`);
  assert.ok(hooks.indexOf(sentence) > hooks.indexOf('| `route-new-work` |'), 'the sentence comes after the guards table');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  const entry = '- T1-PS-GUARD-READ (bugfix, issue 117): on a PowerShell event `production-gate` joins backtick continuations and tests script blocks and subexpressions as segments, and `protect-paths` counts PowerShell\'s write commands, aliases, `-OutFile` and `[IO.File]` writes; a Bash event decides as before.';
  assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
});
