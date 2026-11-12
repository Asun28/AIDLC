// Card T0-CLI-CWD-FILE-ARGS-2: with -C, every file argument the CLI opens resolves against the -C directory when relative and is
// used as given when fully qualified; an empty, drive-relative or incomplete UNC value, or a -C that names no directory, is refused
// before the command reads or writes anything.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { cleanup, tmpDir } from '../infra/helpers.ts';
import * as cli from '../../src/cli/main.ts';

const main = path.resolve(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');
const temps: string[] = [];
/**
 * A new directory under the OS temporary directory, created by `tmpDir` of tests/infra/helpers.ts and removed by `cleanup` in the
 * after hook, also when a test fails; returned canonical (realpathSync.native), as the card's hygiene asks.
 */
function tempDir(prefix: string): string {
  const dir = tmpDir(`aidlc-cwd-${prefix}-`);
  temps.push(dir);
  return realpathSync.native(dir);
}
after(() => {
  for (const dir of temps) cleanup(dir);
});

/** The directory every fixture is created in: repository discovery of a child stops below it, also when it lies inside a git checkout. */
const CEILING = realpathSync.native(tmpdir());
/** An empty git configuration file, the global configuration of every child, so that no git call reads the caller's. */
const GIT_CONFIG = path.join(tempDir('gitconfig'), 'empty.gitconfig');
writeFileSync(GIT_CONFIG, '');

/**
 * The environment of every child the tests start: no inherited variable whose upper-cased name starts with GIT_, AIDLC_ or NODE_, no
 * session variable, GIT_CEILING_DIRECTORIES at the fixtures' parent, and no system or global git configuration. `source` is the inherited environment, so a row can check it.
 */
function childEnv(extra: NodeJS.ProcessEnv = {}, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('GIT_') || upper.startsWith('AIDLC_') || upper.startsWith('NODE_') || upper === 'CLAUDE_CODE_SESSION_ID') continue;
    env[k] = v;
  }
  return { ...env, GIT_CEILING_DIRECTORIES: CEILING, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_CONFIG, ...extra };
}

function gitInit(repo: string): void {
  const r = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8', env: childEnv(), windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
}

interface Fixture {
  root: string;
  caller: string;
  target: string;
  third: string;
  state: string;
  run: (args: string[], input?: string, cwd?: string) => SpawnSyncReturns<string>;
}

/** A caller directory the CLI starts in, a -C target, a third directory for fully qualified values and a state directory. */
function fixture(): Fixture {
  const root = tempDir('fx');
  const sub = (name: string) => {
    const dir = path.join(root, name);
    mkdirSync(dir);
    return dir;
  };
  const [caller, target, third, state] = [sub('caller'), sub('target'), sub('third'), sub('state')];
  const env = childEnv({ AIDLC_STATE_DIR: state, AIDLC_SESSION: 'cwd-paths-test' });
  const run = (args: string[], input?: string, cwd = caller) => spawnSync(process.execPath, [main, ...args], { cwd, env, input, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { root, caller, target, third, state, run };
}

/** Every file under `dir` with its bytes, so a refusal can be shown to have written nothing. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files[path.relative(dir, p)] = readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return files;
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

const PLAN = ['# Plan', '', '## 7. Task split (dependencies and parallel windows)', '', '| ID | P | Output | Deps | Window | Freeze |', '|---|---|---|---|---|---|', '| T0-CWD-ROW | MUST | the target row | - | - | no |', ''].join('\n');
const BANDS = ['metric: error_rate', 'direction: above', 'min_samples: 8', 'tiers:', '  1sigma: { action: log }', '  2sigma: { action: diagnose, tools: "Read" }', '  3sigma: { action: propose, routes: [pull_request] }', 'dedupe_window_ms: 21600000', ''].join('\n');
const DATA = JSON.stringify({ baseline: [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11], recent: [{ at: '2026-09-11T00:00:00.000Z', value: 14 }] });
/** A saved bench report that passes every rule of `bench compare`. */
function benchReport(): string {
  const reason = (id: string) => `[spec] 1 defect @ src/${id}.ts:1: x -> y`;
  const cases = ['a', 'b'].map((id) => ({ id, kind: 'bug', confirmed: true, outcome: 'hit', runStatus: 'success', cited: [reason(id)], matched: { reason: reason(id), file: `src/${id}.ts`, line: 1 }, durationMs: 0 }));
  const totals = { bugCases: 2, hits: 2, misses: 0, recall: 1, cleanCases: 0, cleanPasses: 0, falseBlocks: 0, falseBlockRate: null, noVerdict: 0, errors: 0, skippedUnconfirmed: 0 };
  return JSON.stringify({ stage: 'formal', reviewer: 'r', rules: 'newest', policyHash: 'p', leftCheckouts: [], cases, totals, trialResults: [1, 2, 3].map(() => ({ cases, totals })), summary: { trials: 3, recall: { median: 1, min: 1, max: 1 }, falseBlockRate: null, noVerdict: 0, errors: 0 } });
}

/** The single goal of the fixture state directory. */
function goalOf(fx: Fixture): string {
  const [file] = readdirSync(path.join(fx.state, 'goals')).filter((f) => f.endsWith('.json'));
  assert.ok(file, 'the fixture holds a goal');
  return file.slice(0, -'.json'.length);
}

function newGoal(fx: Fixture): string {
  const r = fx.run(['-C', fx.target, 'goal', 'new', 'a small change']);
  assert.equal(r.status, 0, r.stderr);
  return goalOf(fx);
}

/** `p` with its drive letter in the other case (Windows). */
function swapCase(p: string): string {
  return (p[0] === p[0]!.toUpperCase() ? p[0]!.toLowerCase() : p[0]!.toUpperCase()) + p.slice(1);
}

/** The 8.3 short form of an existing Windows path, or undefined when the volume keeps no short names. */
function shortName(p: string): string | undefined {
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], { encoding: 'utf8', env: childEnv(), windowsHide: true, windowsVerbatimArguments: true });
  const short = r.status === 0 ? r.stdout.trim() : '';
  return short && short.toLowerCase() !== p.toLowerCase() ? short : undefined;
}

interface RepoFixture {
  root: string;
  repo: string;
  src: string;
  caller: string;
  /** The CLI with `AIDLC_SESSION` set and no other AIDLC_ variable: the repository and its state directory come from the working directory alone. */
  run: (args: string[], cwd: string, input?: string, extraEnv?: NodeJS.ProcessEnv) => SpawnSyncReturns<string>;
}

/** A git repository with `src/sub`, a frozen path in its config and a caller directory outside it. */
function repoFixture(): RepoFixture {
  const root = tempDir('repo');
  const repo = path.join(root, 'repo');
  const src = path.join(repo, 'src');
  const caller = path.join(root, 'caller');
  mkdirSync(path.join(src, 'sub'), { recursive: true });
  mkdirSync(caller);
  write(path.join(repo, 'aidlc.config.json'), JSON.stringify({ provider: 'mock', hooks: { frozenPaths: ['frozen/'] } }));
  // The default session token is read from the process directory's state directory, with or without -C (a non-goal): every call sets AIDLC_SESSION.
  const env = childEnv({ AIDLC_SESSION: 'cwd-paths-test' });
  gitInit(repo);
  const run = (args: string[], cwd: string, input?: string, extraEnv: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [main, ...args], { cwd, env: { ...env, ...extraEnv }, input, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { root, repo, src, caller, run };
}

/** Every value refused as `-C` for each command, exit 2 under a hook and 1 otherwise, naming `--cwd` and the reason, with nothing written under the fixture. */
function assertCwdRefused(fx: Fixture, values: Array<[string, string]>): void {
  const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: fx.caller, session_id: 'cwd-paths-test' });
  const commands: Array<[string[], number, string | undefined]> = [
    [['spec', 'validate', 'spec.md'], 1, undefined],
    [['review', 'bench', 'compare', 'before.json', 'after.json'], 1, undefined],
    [['review', 'bench', 'run', '--stage', 'formal'], 1, undefined],
    [['hook', 'auto'], 2, event],
    [['hook', 'protect-paths'], 2, event],
  ];
  const before = snapshot(fx.root);
  for (const [value, reason] of values) {
    for (const [args, code, input] of commands) {
      const r = fx.run(['-C', value, ...args], input);
      const label = `-C ${JSON.stringify(value)} ${args.join(' ')}`;
      assert.equal(r.status, code, `${label}: ${r.stderr}`);
      assert.ok(r.stderr.startsWith(`aidlc: --cwd ${JSON.stringify(value)}: ${reason}`), `${label}: ${r.stderr}`);
      assert.deepEqual(snapshot(fx.root), before, `${label} writes nothing`);
    }
  }
}

/** A use of `chdir`, `process` or `process.env` that acceptance 13 does not allow, by its rule and line. */
interface EnvViolation { rule: 'a' | 'b' | 'c' | 'd'; line: number; text: string }

/** The ten properties of `process` that rule (b) allows: those src/cli/main.ts uses. */
const PROCESS_PROPERTIES = new Set(['argv', 'cwd', 'env', 'exit', 'exitCode', 'once', 'platform', 'stderr', 'stdout', 'version']);
/** The identifiers of rule (d): each reaches the process object or runs code without naming it. */
const HIDDEN_ACCESS = new Set(['eval', 'Function', 'globalThis', 'global', 'Reflect']);

/** The operators of the second shape of rule (c): a read of the environment compared or defaulted. */
const ENV_READ_OPERATORS = new Set<ts.SyntaxKind>([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);

/** An object literal that is the target of a destructuring assignment (`({ ...x } = o)`, `for ({ ...x } of a)`), where a spread writes. */
function isAssignedPattern(literal: ts.ObjectLiteralExpression): boolean {
  for (let at: ts.Node = literal; ; ) {
    const p = at.parent;
    if (ts.isBinaryExpression(p)) return p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === at;
    if (ts.isForOfStatement(p) || ts.isForInStatement(p)) return p.initializer === at;
    const nested = ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p) || (ts.isPropertyAssignment(p) && p.initializer === at);
    if (!nested) return false;
    at = p;
  }
}

/** Whether `once`, a `process.once` node, is the callee of a call that is a whole expression statement: the object it returns is discarded. */
function isDiscardedCall(once: ts.PropertyAccessExpression): boolean {
  const call = once.parent;
  return ts.isCallExpression(call) && call.expression === once && ts.isExpressionStatement(call.parent) && call.parent.expression === call;
}

/** The name a variable read of the second shape must have. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** The variable an access to `process.env` names: its property name, or a string or substitution-free template key; else undefined. */
function variableName(access: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(access)) return access.name.text;
  const arg = access.argumentExpression;
  return ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : undefined;
}

/** Whether `env`, a `process.env` node, has one of the three shapes of rule (c). */
function allowedEnvShape(env: ts.PropertyAccessExpression): boolean {
  const p = env.parent;
  // 1. The operand of a spread in an object literal that is read, not assigned to.
  if (ts.isSpreadAssignment(p)) return !isAssignedPattern(p.parent);
  // 2. The object of a property or element access that reads a variable by its name and is a direct operand of ||, &&, ??, === or !==.
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === env) {
    const b = p.parent;
    const name = variableName(p);
    return name !== undefined && ENV_NAME.test(name) && ts.isBinaryExpression(b) && ENV_READ_OPERATORS.has(b.operatorToken.kind) && (b.left === p || b.right === p);
  }
  // 3. An argument of a call whose callee is the identifier renewSessionCardLeases.
  return ts.isCallExpression(p) && p.arguments.some((a) => a === env) && ts.isIdentifier(p.expression) && p.expression.text === 'renewSessionCardLeases';
}

/**
 * The violations of acceptance 13 in a source text, parsed with the TypeScript compiler API: (a) an identifier `chdir` or a string
 * literal that is exactly `chdir`; (b) an identifier `process` that is not the object of a property access to one of the ten
 * properties (`once` only as a discarded call), or a string literal that is exactly `process` or `node:process`; (c) a `process.env` in none of the three shapes; (d) a
 * `this` expression or an identifier of HIDDEN_ACCESS. Comments are not nodes, so they never count.
 */
function envViolations(text: string): EnvViolation[] {
  const sf = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: EnvViolation[] = [];
  const report = (rule: EnvViolation['rule'], node: ts.Node) => found.push({ rule, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.getText(sf) });
  // The walk keeps its own stack of nodes, so the nesting depth of a source does not reach the call stack.
  const pending: ts.Node[] = [sf];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isIdentifier(node)) {
      if (node.text === 'chdir') report('a', node);
      if (node.text === 'process') {
        const p = node.parent;
        if (!(ts.isPropertyAccessExpression(p) && p.expression === node && PROCESS_PROPERTIES.has(p.name.text)) || (p.name.text === 'once' && !isDiscardedCall(p))) report('b', node);
        else if (p.name.text === 'env' && !allowedEnvShape(p)) report('c', p);
      }
      if (HIDDEN_ACCESS.has(node.text)) report('d', node);
    } else if (node.kind === ts.SyntaxKind.ThisKeyword) {
      report('d', node);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text === 'chdir') report('a', node);
      if (node.text === 'process' || node.text === 'node:process') report('b', node);
    }
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  return found.sort((x, y) => x.line - y.line);
}

describe('T0-CLI-CWD-FILE-ARGS-2', () => {
  test('every child starts without the GIT_ variables of the test process, and repository discovery stops at the ceiling', () => {
    const repo = path.join(tempDir('leak'), 'repo');
    gitInit(repo);
    const set: Record<string, string> = { GIT_DIR: path.join(repo, '.git'), git_work_tree: repo, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: repo };
    const saved = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
    try {
      Object.assign(process.env, set);
      const dump = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.entries(process.env).filter(([k]) => /^git_/i.test(k))))'], { encoding: 'utf8', env: childEnv(), windowsHide: true });
      assert.equal(dump.status, 0, dump.stderr);
      assert.deepEqual(Object.fromEntries(JSON.parse(dump.stdout) as Array<[string, string]>), { GIT_CEILING_DIRECTORIES: CEILING, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_CONFIG });
      // The CLI in a directory outside any repository does not reach the repository GIT_DIR names in the test process.
      const fx = fixture();
      const r = fx.run(['doctor', '--json']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal((JSON.parse(r.stdout) as { repository: string }).repository, `${fx.caller} (not a git repository)`);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    // The ceiling: a fixture inside a checkout finds that checkout without it and no repository with it at the fixture's parent.
    const outer = tempDir('outer');
    gitInit(outer);
    const caller = path.join(outer, 'fx', 'caller');
    mkdirSync(caller, { recursive: true });
    const doctor = (extra: NodeJS.ProcessEnv) => spawnSync(process.execPath, [main, 'doctor', '--json'], { cwd: caller, env: childEnv({ AIDLC_SESSION: 'cwd-paths-test', AIDLC_STATE_DIR: path.join(outer, 'state'), ...extra }), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const without = doctor({});
    assert.equal((JSON.parse(without.stdout) as { repository: string }).repository, outer, without.stderr);
    const capped = doctor({ GIT_CEILING_DIRECTORIES: outer });
    assert.equal((JSON.parse(capped.stdout) as { repository: string }).repository, `${caller} (not a git repository)`, capped.stderr);
  });

  test('every child starts without the NODE_ variables of the test process, in any letter case, and reads no system or global git configuration', () => {
    // A --require of a relative path in NODE_OPTIONS fails a child started in another directory (pre-review of f9b50cf1); NODE_DEBUG
    // adds diagnostics to its stderr, and the caller's git configuration can fail a fixture's git call (second pre-review).
    const source = { NODE_OPTIONS: 'a', node_options: 'b', NODE_DEBUG: 'f', node_path: 'g', NODE_V8_COVERAGE: 'h', GIT_DIR: 'c', AIDLC_SESSION: 'd', CLAUDE_CODE_SESSION_ID: 'e', PATH: 'p' };
    assert.deepEqual(childEnv({}, source), { PATH: 'p', GIT_CEILING_DIRECTORIES: CEILING, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_CONFIG });
  });

  test('every child starts without the NODE_ variables of the test process: a refusal prints the same stderr with NODE_DEBUG set', () => {
    const fx = fixture();
    const runWith = (source: NodeJS.ProcessEnv) => spawnSync(process.execPath, [main, '-C', fx.target, 'spec', 'validate', ''], { cwd: fx.caller, env: childEnv({ AIDLC_STATE_DIR: fx.state, AIDLC_SESSION: 'cwd-paths-test' }, source), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const plain = runWith(process.env);
    assert.equal(plain.status, 1, plain.stderr);
    assert.ok(plain.stderr.startsWith('aidlc: <file> "": '), plain.stderr);
    const debug = runWith({ ...process.env, NODE_DEBUG: 'module' });
    assert.deepEqual({ status: debug.status, stderr: debug.stderr }, { status: plain.status, stderr: plain.stderr });
  });

  test('the path function by input class [R3]', () => {
    const resolve = (cli as { resolvePathArg?: (value: string, option: string, base: string, flavour?: path.PlatformPath) => { ok: true; path: string } | { ok: false; message: string } }).resolvePathArg;
    assert.equal(typeof resolve, 'function', 'src/cli/main.ts exports resolvePathArg');
    // `isAbsolute` alone would accept these two under win32; the function still treats them as R3 says.
    assert.equal(path.win32.isAbsolute('\\x'), true);
    assert.equal(path.win32.isAbsolute('\\\\x'), true);
    const WS = ['', ' ', '\t', ' \n ', '\u00a0', '\ufeff', '\u2028'];
    const win32: Array<[string, string | null]> = [
      ...WS.map((v): [string, null] => [v, null]),
      // A drive letter, either case, then no separator: the current directory of that drive.
      ['C:', null], ['c:', null], ['C:x', null], ['c:x', null], ['C:x\\y', null], ['C:x/y', null],
      // Two separators without a server and a share (Node reads `\\?\` alone as `D:\?`, so it is no device path).
      ['\\\\x', null], ['//x', null], ['\\\\server', null], ['\\\\server\\', null], ['//server/', null], ['\\\\\\x', null], ['\\\\?\\', null],
      // Fully qualified: used as given, separators normalized, the base never read.
      ['C:\\x', 'C:\\x'], ['c:/x', 'c:\\x'], ['\\\\server\\share', '\\\\server\\share\\'], ['\\\\server\\share\\x', '\\\\server\\share\\x'], ['//server/share/x', '\\\\server\\share\\x'],
      ['\\\\?\\C:\\x', '\\\\?\\C:\\x'], ['\\\\?\\UNC\\server\\share\\x', '\\\\?\\UNC\\server\\share\\x'], ['\\\\.\\C:\\x', '\\\\.\\C:\\x'],
      // One leading separator: the root of the base's drive.
      ['\\x', 'D:\\x'], ['/x', 'D:\\x'],
      // Everything else: against the base, no tilde expansion.
      ['x', 'D:\\base\\x'], ['.\\x', 'D:\\base\\x'], ['./x', 'D:\\base\\x'], ['..\\x', 'D:\\x'], ['~\\x', 'D:\\base\\~\\x'],
    ];
    const posix: Array<[string, string | null]> = [
      ...WS.map((v): [string, null] => [v, null]),
      ['/x', '/x'], ['//x', '/x'],
      ['x', '/base/x'], ['./x', '/base/x'], ['~/x', '/base/~/x'], ['C:\\x', '/base/C:\\x'], ['C:/x', '/base/C:/x'], ['C:x', '/base/C:x'], ['\\x', '/base/\\x'], ['\\\\server\\share\\x', '/base/\\\\server\\share\\x'], ['\\\\?\\C:\\x', '/base/\\\\?\\C:\\x'],
    ];
    // Used as given: a fully qualified win32 value gives path.win32.resolve of the value alone, whatever the base.
    for (const value of ['C:\\x', 'c:/x', '\\\\server\\share', '\\\\server\\share\\x', '//server/share/x', '\\\\?\\C:\\x', '\\\\?\\UNC\\server\\share\\x', '\\\\.\\C:\\x']) {
      for (const base of ['D:\\base', 'E:\\other']) assert.deepEqual(resolve!(value, '--plan', base, path.win32), { ok: true, path: path.win32.resolve(value) }, `${JSON.stringify(value)} with base ${base}`);
    }
    for (const [flavour, base, table] of [[path.win32, 'D:\\base', win32], [path.posix, '/base', posix]] as const) {
      for (const [value, expected] of table) {
        const r = resolve!(value, '--plan', base, flavour);
        const label = `${flavour === path.win32 ? 'win32' : 'posix'} ${JSON.stringify(value)}`;
        if (expected === null) {
          assert.equal(r.ok, false, `${label} is refused`);
          if (!r.ok) {
            assert.ok(r.message.startsWith(`--plan ${JSON.stringify(value)}: `), `${label} names the option and quotes the value: ${r.message}`);
            assert.match(r.message, /; pass /, `${label} says what to pass: ${r.message}`);
          }
        } else assert.deepEqual(r, { ok: true, path: expected }, label);
      }
    }
  });

  test('each file argument resolves against -C [R1] [R4]', () => {
    const fx = fixture();
    // One case per command; bench compare and monitor check give both of their values the same way, so a second value is
    // reached only when the first was read from the same directory.
    const cases: Array<{ name: string; status: number; files: Record<string, string>; args: (at: (rel: string) => string) => string[]; check: (r: SpawnSyncReturns<string>, dir: string) => void }> = [
      {
        name: 'init [dir]',
        status: 0,
        files: { 'sub/aidlc.config.json': '{}\n' },
        args: (at) => ['init', at('sub'), '--dry-run', '--json'],
        check: (r) => {
          const report = JSON.parse(r.stdout) as { created: string[]; skipped: string[] };
          assert.ok(report.skipped.includes('aidlc.config.json') && !report.created.includes('aidlc.config.json'), r.stdout);
        },
      },
      { name: 'cards project --plan', status: 0, files: { 'plans/p.md': PLAN }, args: (at) => ['cards', 'project', '--plan', at('plans/p.md')], check: (r) => assert.match(r.stdout, /<!-- T0-CWD-ROW -->/) },
      { name: 'intent validate <file>', status: 1, files: { 'intent.md': 'no front matter\n' }, args: (at) => ['intent', 'validate', at('intent.md'), '--json'], check: (r) => assert.deepEqual((JSON.parse(r.stdout) as { problems: string[] }).problems, ['missing front matter']) },
      { name: 'spec validate <file>', status: 1, files: { 'spec.md': 'no front matter\n' }, args: (at) => ['spec', 'validate', at('spec.md'), '--json'], check: (r) => assert.ok((JSON.parse(r.stdout) as { problems: string[] }).problems.includes('missing front matter'), r.stdout) },
      { name: 'plan check <file>', status: 1, files: { 'plan.md': 'no front matter\n' }, args: (at) => ['plan', 'check', at('plan.md'), '--json'], check: (r) => assert.equal((JSON.parse(r.stdout) as { overall: string }).overall, 'needs-clarification') },
      {
        name: 'review bench compare <before.json> <after.json>',
        status: 1,
        files: { 'before.json': benchReport(), 'after.json': '{"x":1}' },
        args: (at) => ['review', 'bench', 'compare', at('before.json'), at('after.json')],
        check: (r, dir) => assert.ok(r.stderr.includes(`${path.join(dir, 'after.json')}: rule (a)`), r.stderr),
      },
      { name: 'ci classify --log', status: 0, files: { 'ci.log': 'AssertionError [ERR_ASSERTION]: the target log\n' }, args: (at) => ['ci', 'classify', '--log', at('ci.log'), '--json'], check: (r) => assert.equal((JSON.parse(r.stdout) as { class: string }).class, 'code-defect') },
      { name: 'migrate assess --diff', status: 0, files: { 'c.diff': '+ALTER TABLE users ADD COLUMN x int;\n' }, args: (at) => ['migrate', 'assess', '--paths', 'src/a.ts', '--diff', at('c.diff'), '--json'], check: (r) => assert.equal((JSON.parse(r.stdout) as { strong: boolean }).strong, true) },
      { name: 'monitor check --bands --data', status: 0, files: { 'bands.yaml': BANDS, 'data.json': DATA }, args: (at) => ['monitor', 'check', '--bands', at('bands.yaml'), '--data', at('data.json'), '--json'], check: (r) => assert.ok((JSON.parse(r.stdout) as { breaches: unknown[] }).breaches.length > 0, r.stdout) },
    ];
    for (const c of cases) {
      for (const [dir, at] of [[fx.target, (rel: string) => rel], [fx.third, (rel: string) => path.join(fx.third, rel)]] as const) {
        for (const [rel, text] of Object.entries(c.files)) write(path.join(dir, rel), text);
        const r = fx.run(['-C', fx.target, ...c.args(at)]);
        const label = `${c.name} (${dir === fx.target ? 'relative to -C' : 'fully qualified'})`;
        assert.equal(r.status, c.status, `${label}: ${r.stderr}`);
        c.check(r, dir);
      }
    }
    // evidence retain --file: the bytes of the file the value names go into a goal of the fixture state directory.
    const goal = newGoal(fx);
    write(path.join(fx.target, 'out.txt'), 'bytes of the target');
    write(path.join(fx.third, 'out.txt'), 'bytes of the third directory');
    for (const [id, value, bytes] of [['e1', 'out.txt', 'bytes of the target'], ['e2', path.join(fx.third, 'out.txt'), 'bytes of the third directory']] as const) {
      const r = fx.run(['-C', fx.target, 'evidence', 'retain', '--id', id, '--kind', 'log', '--file', value]);
      assert.equal(r.status, 0, `evidence retain --file ${value}: ${r.stderr}`);
      assert.equal(readFileSync(path.join(fx.state, 'evidence', goal, id), 'utf8'), bytes);
    }
  });

  test('supplied values are refused before the command context is built [R4]', () => {
    const fx = fixture();
    // ctx() refuses this configuration, so a refusal naming the option shows that the value was checked first.
    write(path.join(fx.target, 'aidlc.config.json'), '{ not json');
    const ctxBuilt = fx.run(['-C', fx.target, 'spec', 'validate', 'spec.md']);
    assert.equal(ctxBuilt.status, 1, ctxBuilt.stderr);
    assert.ok(ctxBuilt.stderr.startsWith('aidlc: ') && !ctxBuilt.stderr.includes('<file>'), `the fixture's configuration fails ctx(): ${ctxBuilt.stderr}`);
    // The eight of the twelve values whose command builds a context; the two commands with two inputs with the empty value first and second.
    const slots: Array<[string, string[]]> = [
      ['--plan', ['cards', 'project', '--plan', '']],
      ['<file>', ['intent', 'validate', '']],
      ['<file>', ['spec', 'validate', '']],
      ['<file>', ['plan', 'check', '']],
      ['--log', ['ci', 'classify', '--log', '']],
      ['--diff', ['migrate', 'assess', '--paths', 'x', '--diff', '']],
      ['--file', ['evidence', 'retain', '--id', 'e1', '--kind', 'log', '--file', '']],
      ['--bands', ['monitor', 'check', '--bands', '', '--data', 'data.json']],
      ['--data', ['monitor', 'check', '--bands', 'bands.yaml', '--data', '']],
      ['<before.json>', ['review', 'bench', 'compare', '', 'after.json']],
      ['<after.json>', ['review', 'bench', 'compare', 'before.json', '']],
    ];
    for (const [option, args] of slots) {
      const r = fx.run(['-C', fx.target, ...args]);
      assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
      assert.ok(r.stderr.startsWith(`aidlc: ${option} "": `), `${args.slice(0, 2).join(' ')} ${option}: ${r.stderr}`);
    }
  });

  test('supplied values are refused before any read or write [R3] [R4] [R6]', () => {
    const fx = fixture();
    newGoal(fx);
    // Every other value names a file that does not exist: a refusal must name the empty option, not ENOENT of another value.
    const slots: Array<[string, (v: string) => string[]]> = [
      ['[dir]', (v) => ['init', v]],
      ['--plan', (v) => ['cards', 'project', '--plan', v, '--write']],
      ['<file>', (v) => ['intent', 'validate', v]],
      ['<file>', (v) => ['spec', 'validate', v]],
      ['<file>', (v) => ['plan', 'check', v]],
      ['<before.json>', (v) => ['review', 'bench', 'compare', v, 'after.json']],
      ['<after.json>', (v) => ['review', 'bench', 'compare', 'before.json', v]],
      ['--log', (v) => ['ci', 'classify', '--log', v]],
      ['--diff', (v) => ['migrate', 'assess', '--paths', 'x', '--diff', v]],
      ['--file', (v) => ['evidence', 'retain', '--id', 'e1', '--kind', 'log', '--file', v]],
      ['--bands', (v) => ['monitor', 'check', '--bands', v, '--data', 'data.json', '--file-intent']],
      ['--data', (v) => ['monitor', 'check', '--bands', 'bands.yaml', '--data', v, '--file-intent']],
    ];
    const before = snapshot(fx.root);
    for (const [option, args] of slots) {
      for (const value of ['', '  ']) {
        const r = fx.run(['-C', fx.target, ...args(value)]);
        const label = `${args(value).slice(0, 2).join(' ')} ${option} ${JSON.stringify(value)}`;
        assert.equal(r.status, 1, `${label}: ${r.stderr}`);
        assert.ok(r.stderr.startsWith(`aidlc: ${option} ${JSON.stringify(value)}: `), `${label}: ${r.stderr}`);
        assert.deepEqual(snapshot(fx.root), before, `${label} writes nothing`);
      }
    }
  });

  test('supplied values: a value under a regular file fails with the error of main naming the resolved path [R6]', () => {
    const fx = fixture();
    newGoal(fx);
    write(path.join(fx.target, 'a-file'), 'x');
    const value = path.join('a-file', 'child');
    const resolved = path.join(fx.target, value);
    // Every path value of a command gets the same value, so the first one read is the one named. `init` is left out: on main,
    // a target that does not exist is no error.
    const commands = [
      ['cards', 'project', '--plan', value],
      ['intent', 'validate', value],
      ['spec', 'validate', value],
      ['plan', 'check', value],
      ['review', 'bench', 'compare', value, value],
      ['ci', 'classify', '--log', value],
      ['migrate', 'assess', '--paths', 'x', '--diff', value],
      ['evidence', 'retain', '--id', 'e1', '--kind', 'log', '--file', value],
      ['monitor', 'check', '--bands', value, '--data', value],
    ];
    // init [dir] is the exception: it names a directory init may create, so a missing one is no error (as on main).
    const init = fx.run(['-C', fx.target, 'init', 'missing', '--dry-run', '--json']);
    assert.equal(init.status, 0, init.stderr);
    const before = snapshot(fx.root);
    for (const args of commands) {
      const r = fx.run(['-C', fx.target, ...args]);
      assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
      assert.ok(r.stderr.startsWith('aidlc: ') && r.stderr.includes(resolved), `${args.join(' ')}: ${r.stderr}`);
      assert.deepEqual(snapshot(fx.root), before, `${args.join(' ')} writes nothing`);
    }
  });

  test('supplied values: a drive-relative or incomplete UNC value is refused and a leading separator means the root of the -C drive [R3] [R6]', { skip: process.platform !== 'win32' && 'win32 path forms need a Windows file system; the path function test covers the rule on every host' }, () => {
    const fx = fixture();
    write(path.join(fx.target, 'plans', 'p.md'), PLAN);
    const before = snapshot(fx.root);
    for (const value of ['C:plan.md', '\\\\x']) {
      const r = fx.run(['-C', fx.target, 'cards', 'project', '--plan', value, '--write']);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stderr.startsWith(`aidlc: --plan ${JSON.stringify(value)}: `), r.stderr);
      assert.deepEqual(snapshot(fx.root), before, `--plan ${value} writes nothing`);
    }
    const rooted = `${fx.target.slice(path.parse(fx.target).root.length - 1)}\\plans\\p.md`;
    const r = fx.run(['-C', fx.target, 'cards', 'project', '--plan', rooted]);
    assert.equal(r.status, 0, `${rooted}: ${r.stderr}`);
    assert.match(r.stdout, /<!-- T0-CWD-ROW -->/);
  });

  test('an invalid -C is refused for every command [R2] [R6]', () => {
    const fx = fixture();
    write(path.join(fx.root, 'a-file'), 'x');
    // Under a regular file Windows reports no entry and POSIX ENOTDIR; both are the same refusal.
    const [nothing, file, child] = [path.join(fx.root, 'nothing'), path.join(fx.root, 'a-file'), path.join(fx.root, 'a-file', 'child')];
    assertCwdRefused(fx, [
      ['', 'the value is empty'],
      ['  ', 'the value is empty'],
      [nothing, `no directory at ${nothing} (`],
      [file, `no directory at ${file} (a file)`],
      [child, `no directory at ${child} (`],
      ...(process.platform === 'win32' ? ([['C:wt', 'a drive letter without a separator'], ['\\\\x', 'a network path needs a server and a share']] as Array<[string, string]>) : []),
    ]);
  });

  test('an invalid -C is refused for every command: a parent that cannot be read [R2] [R6]', { skip: (process.platform === 'win32' && 'mode 0o000 does not deny a read on Windows') || (process.getuid?.() === 0 && 'root reads a directory of mode 0o000') }, () => {
    const fx = fixture();
    const locked = path.join(tempDir('locked'), 'locked');
    mkdirSync(path.join(locked, 'inner'), { recursive: true });
    chmodSync(locked, 0o000);
    try {
      // A directory under a parent that cannot be read: its stat fails EACCES, so -C is refused (exit 1, exit 2 under a hook).
      assertCwdRefused(fx, [[path.join(locked, 'inner'), `no directory at ${path.join(locked, 'inner')} (`]]);
      // The mode-000 directory itself: its stat needs search permission on the parent only, so it names an existing directory and
      // R2 accepts it; the command then fails with its own error when it opens spec.md there.
      const r = fx.run(['-C', locked, 'spec', 'validate', 'spec.md']);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stderr.startsWith('aidlc: ') && !r.stderr.includes('--cwd') && r.stderr.includes(locked), r.stderr);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test('absent optional values [R5]', () => {
    const fx = fixture();
    write(path.join(fx.target, 'aidlc.config.json'), '{}\n');
    const init = fx.run(['-C', fx.target, 'init', '--dry-run', '--json']);
    assert.equal(init.status, 0, init.stderr);
    assert.ok((JSON.parse(init.stdout) as { skipped: string[] }).skipped.includes('aidlc.config.json'), init.stdout);
    const migrate = fx.run(['-C', fx.target, 'migrate', 'assess', '--paths', 'x', '--json']);
    assert.equal(migrate.status, 0, migrate.stderr);
    assert.deepEqual(JSON.parse(migrate.stdout), { impacted: false, strong: false, signals: [] });
    const goal = newGoal(fx);
    const retain = fx.run(['-C', fx.target, 'evidence', 'retain', '--id', 'kept', '--kind', 'note', '--content', 'kept']);
    assert.equal(retain.status, 0, retain.stderr);
    assert.equal(readFileSync(path.join(fx.state, 'evidence', goal, 'kept'), 'utf8'), 'kept');
  });

  test('plan_ref is the same with and without -C [R7]', () => {
    const fx = fixture();
    const repo = path.join(fx.root, 'repo');
    write(path.join(repo, 'plans', 'p.md'), PLAN);
    gitInit(repo);
    // A -C through a directory link to the repository differs from the canonical path.
    const link = path.join(fx.root, 'link');
    symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    const runs: Array<[string, string[], string]> = [
      ['from inside the repository', ['cards', 'project', '--plan', 'plans/p.md'], repo],
      ['-C the repository', ['-C', repo, 'cards', 'project', '--plan', 'plans/p.md'], fx.caller],
      ['-C a link to the repository', ['-C', link, 'cards', 'project', '--plan', 'plans/p.md'], fx.caller],
    ];
    if (process.platform === 'win32') runs.push(['-C in another drive-letter case', ['-C', swapCase(repo), 'cards', 'project', '--plan', 'plans/p.md'], fx.caller]);
    for (const [label, args, cwd] of runs) {
      const r = fx.run(args, undefined, cwd);
      assert.equal(r.status, 0, `${label}: ${r.stderr}`);
      assert.match(r.stdout, /^plan_ref: plans\/p\.md#7$/m, `${label}: ${r.stdout}`);
    }
  });

  test('plan_ref is the same with and without -C: an 8.3 short name [R7]', { skip: process.platform !== 'win32' && '8.3 short names exist on Windows only' }, (t) => {
    const fx = fixture();
    const repo = path.join(fx.root, 'a long repository name');
    write(path.join(repo, 'plans', 'p.md'), PLAN);
    gitInit(repo);
    const short = shortName(repo);
    if (!short) return t.skip('this volume keeps no 8.3 short names');
    const r = fx.run(['-C', short, 'cards', 'project', '--plan', 'plans/p.md']);
    assert.equal(r.status, 0, `${short}: ${r.stderr}`);
    assert.match(r.stdout, /^plan_ref: plans\/p\.md#7$/m, `${short}: ${r.stdout}`);
  });

  test('-C selects the same repository and state directory in every form of the same directory [R1]', () => {
    const fx = repoFixture();
    // [label, process directory, -C value]; each names fx.src.
    const forms: Array<[string, string, string]> = [
      ['the plain absolute path', fx.caller, fx.src],
      ['missing/../src from the checkout', fx.repo, 'missing/../src'],
      ['a trailing separator', fx.caller, fx.src + path.sep],
      ['.', fx.src, '.'],
      ['sub/..', fx.src, 'sub/..'],
      ['a relative path against the process directory', fx.repo, 'src'],
    ];
    if (process.platform === 'win32') {
      forms.push(['missing\\..\\src from the checkout', fx.repo, 'missing\\..\\src'], ['another drive-letter case', fx.caller, swapCase(fx.src)]);
      const short = shortName(fx.src);
      if (short) forms.push(['an 8.3 short name', fx.caller, short]);
    }
    const before = { src: snapshot(fx.src), caller: snapshot(fx.caller) };
    for (const [label, cwd, value] of forms) {
      const r = fx.run(['-C', value, 'doctor', '--json'], cwd);
      assert.equal(r.status, 0, `${label}: ${r.stderr}`);
      const checks = JSON.parse(r.stdout) as { repository: string; stateDir: string };
      assert.deepEqual({ repository: checks.repository, stateDir: checks.stateDir }, { repository: fx.repo, stateDir: path.join(fx.repo, '.aidlc') }, label);
    }
    // review bench run takes its checkout root from the -C directory (R4): its refusal names the checkout.
    for (const [cwd, value] of [[fx.repo, 'missing/../src'], [fx.repo, 'src']] as const) {
      const r = fx.run(['-C', value, 'review', 'bench', 'run', '--stage', 'formal'], cwd);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stderr.includes(`no REVIEW.md in ${fx.repo}`), `-C ${value} review bench run: ${r.stderr}`);
    }
    // Two commands that write state: their goals and journals go to the checkout's state directory.
    for (const [cwd, value] of [[fx.repo, 'missing/../src'], [fx.caller, fx.src]] as const) {
      const r = fx.run(['-C', value, 'goal', 'new', 'a small change'], cwd);
      assert.equal(r.status, 0, `-C ${value} goal new: ${r.stderr}`);
    }
    assert.equal(readdirSync(path.join(fx.repo, '.aidlc', 'goals')).filter((f) => f.endsWith('.json')).length, 2);
    assert.deepEqual({ src: snapshot(fx.src), caller: snapshot(fx.caller) }, before, 'nothing is written under src or the caller directory');
  });

  test('-C selects the same repository and state directory in every form: a hook runs its guards in the -C directory [R1]', () => {
    const fx = repoFixture();
    // The event names another directory: with -C the guards read the configuration of the -C directory's repository.
    const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'frozen/a.ts' }, cwd: fx.caller, session_id: 'cwd-paths-test' });
    for (const name of ['auto', 'protect-paths']) {
      const plain = fx.run(['-C', fx.src, 'hook', name], fx.caller, event);
      assert.match(plain.stdout, /FROZEN/, `hook ${name} with -C <src>: ${plain.status} ${plain.stdout} ${plain.stderr}`);
      const dotted = fx.run(['-C', 'missing/../src', 'hook', name], fx.repo, event);
      assert.deepEqual({ status: dotted.status, stdout: dotted.stdout, stderr: dotted.stderr }, { status: plain.status, stdout: plain.stdout, stderr: plain.stderr }, `hook ${name} with -C missing/../src`);
      // Without -C the hook keeps the event's cwd, else the process directory, as on main.
      const fromEvent = fx.run(['hook', name], fx.caller, JSON.stringify({ ...(JSON.parse(event) as object), cwd: fx.src }));
      assert.match(fromEvent.stdout, /FROZEN/, `hook ${name} with the event cwd: ${fromEvent.stdout} ${fromEvent.stderr}`);
      const { cwd: _cwd, ...noCwd } = JSON.parse(event) as { cwd: string };
      const fromProcess = fx.run(['hook', name], fx.src, JSON.stringify(noCwd));
      assert.match(fromProcess.stdout, /FROZEN/, `hook ${name} with the process directory: ${fromProcess.stdout} ${fromProcess.stderr}`);
    }
  });

  test('-C leaves the process directory and the environment as they are [R1] [R8]', () => {
    const fx = repoFixture();
    // A relative AIDLC_STATE_DIR is read against the process directory, with or without -C: the CLI neither changes directory nor rewrites it.
    for (const args of [['-C', fx.src, 'doctor', '--json'], ['doctor', '--json']]) {
      const r = fx.run(args, fx.caller, undefined, { AIDLC_STATE_DIR: 'rel-state' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal((JSON.parse(r.stdout) as { stateDir: string }).stateDir, path.join(fx.caller, 'rel-state'), args.join(' '));
    }
    // A relative -C selects the checkout's repository and state directory for doctor, goal new and hook auto (R3 decision 3).
    const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'frozen/a.ts' }, cwd: fx.caller, session_id: 'cwd-paths-test' });
    const before = snapshot(fx.src);
    for (const value of ['src', 'missing/../src']) {
      const doctor = fx.run(['-C', value, 'doctor', '--json'], fx.repo);
      assert.equal(doctor.status, 0, doctor.stderr);
      const checks = JSON.parse(doctor.stdout) as { repository: string; stateDir: string };
      assert.deepEqual({ repository: checks.repository, stateDir: checks.stateDir }, { repository: fx.repo, stateDir: path.join(fx.repo, '.aidlc') }, `-C ${value} doctor`);
      const goal = fx.run(['-C', value, 'goal', 'new', 'a small change'], fx.repo);
      assert.equal(goal.status, 0, `-C ${value} goal new: ${goal.stderr}`);
      const hook = fx.run(['-C', value, 'hook', 'auto'], fx.repo, event);
      assert.match(hook.stdout, /FROZEN/, `-C ${value} hook auto: ${hook.status} ${hook.stdout} ${hook.stderr}`);
    }
    assert.equal(readdirSync(path.join(fx.repo, '.aidlc', 'goals')).filter((f) => f.endsWith('.json')).length, 2);
    assert.deepEqual(snapshot(fx.src), before, 'nothing is written under src');
    // Removed directly, not by the after hook: that the -C directory can be removed once the CLI has exited is what this assertion
    // checks. It is no check of the process directory; the relative AIDLC_STATE_DIR above is.
    const gone = path.join(fx.root, 'gone');
    mkdirSync(gone);
    assert.equal(fx.run(['-C', gone, 'doctor', '--json'], fx.caller).status, 0);
    rmSync(gone, { recursive: true });
    assert.equal(existsSync(gone), false);
  });

  test('plan_ref is canonical when the plan is given through a link [R7]', () => {
    const fx = fixture();
    const repo = path.join(fx.root, 'repo');
    write(path.join(repo, 'plans', 'p.md'), PLAN);
    gitInit(repo);
    // links/link names the repository; links/ is not the repository's parent, so a lexical and a canonical base differ.
    mkdirSync(path.join(fx.root, 'links'));
    const link = path.join(fx.root, 'links', 'link');
    symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    const runs: Array<[string, string[]]> = [
      ['--plan <link>/plans/p.md', ['-C', repo, 'cards', 'project', '--plan', path.join(link, 'plans', 'p.md')]],
      // The base stays the -C directory as typed: `../link/plans/p.md` from links/link is links/link/plans/p.md, which only a lexical base reaches.
      ['-C <link> --plan ../link/plans/p.md', ['-C', link, 'cards', 'project', '--plan', '../link/plans/p.md']],
    ];
    for (const [label, args] of runs) {
      const r = fx.run(args);
      assert.equal(r.status, 0, `${label}: ${r.stderr}`);
      assert.match(r.stdout, /^plan_ref: plans\/p\.md#7$/m, `${label}: ${r.stdout}`);
    }
  });

  test('plan_ref without -C is the one main drafts, and with -C both sides are canonical [R7] [R9]', () => {
    const fx = fixture();
    // Without -C, from inside a repository, a plan typed through a directory link to it: main drafts `../link/plans/p.md#7` (its output
    // is recorded in the card), the relative path of the value as typed.
    const repo = path.join(fx.root, 'repo');
    write(path.join(repo, 'plans', 'p.md'), PLAN);
    gitInit(repo);
    const link = path.join(fx.root, 'link');
    symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    const plain = fx.run(['cards', 'project', '--plan', path.join(link, 'plans', 'p.md')], undefined, repo);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /^plan_ref: \.\.\/link\/plans\/p\.md#7$/m, plain.stdout);
    // With -C through a link to a directory that is no repository, where the context root is the lexical -C directory.
    const dir = path.join(fx.root, 'plain');
    write(path.join(dir, 'plans', 'p.md'), PLAN);
    const dirLink = path.join(fx.root, 'plain-link');
    symlinkSync(dir, dirLink, process.platform === 'win32' ? 'junction' : 'dir');
    const viaLink = fx.run(['-C', dirLink, 'cards', 'project', '--plan', 'plans/p.md']);
    assert.equal(viaLink.status, 0, viaLink.stderr);
    assert.match(viaLink.stdout, /^plan_ref: plans\/p\.md#7$/m, viaLink.stdout);
  });

  test('the CLI changes neither the process directory nor the environment [R1] [R8]', () => {
    // An allowlist on the parsed source: a change of directory together with an absolute rewrite of AIDLC_STATE_DIR passes every
    // behaviour test that reads AIDLC_STATE_DIR, and a list of forbidden forms is never complete.
    assert.deepEqual(envViolations(readFileSync(main, 'utf8')), [], 'src/cli/main.ts');
  });

  test('the CLI changes neither the process directory nor the environment: the table of source texts [R1] [R8]', () => {
    const passing = [
      'const e = { ...process.env, A: 1 }',
      "const s = a || process.env['A'] || process.env['B']",
      "const n = process.env['A'] !== '1'",
      "if (p === 'x' && process.env.A === '1') {}",
      "const d = process.env.A ?? 'd'",
      'renewSessionCardLeases(event, cwd, process.env)',
      'process.exitCode = 1',
      'process.argv.slice(2)',
      'process.cwd()',
      // Each of the ten properties of rule (b) in the form main.ts uses it.
      "process.once('SIGINT', () => stop.abort())",
      // process.once as main.ts has it the second time: a whole statement inside an if without braces.
      "if (o.all || o.cleanup) process.once('exit', () => sweepAfter(c))",
      // The second shape of rule (c) reads a variable by a name of /^[A-Z][A-Z0-9_]*$/ (third pre-review).
      "process.env.A1_B === '1'",
      "process.env['AIDLC_SESSION'] || x",
      'process.env[`AIDLC_SESSION`] || x',
      'process.version',
      'process.platform',
      'process.stderr.write(s)',
      'process.stdout.write(s)',
      'process.exit(1)',
      '// process.env.X = v',
      "const m = 'run process.chdir here'",
    ];
    for (const text of passing) assert.deepEqual(envViolations(text), [], JSON.stringify(text));
    const failing: Array<[string, Array<EnvViolation['rule']>]> = [
      // chdir is not one of the ten properties of rule (b), so the call breaks (a) and (b).
      ['process.chdir(at)', ['a', 'b']],
      ["process['chdir'](at)", ['a', 'b']],
      ['process.env.X = v', ['c']],
      ['process.env.X\n  = v', ['c']],
      ["process.env['X'] ??= v", ['c']],
      ["process.env['X'] ||= v", ['c']],
      ['process.env.X += v', ['c']],
      ['delete process.env.X', ['c']],
      ['process.env.X++', ['c']],
      ['[process.env.X] = a', ['c']],
      ['({ a: process.env.X } = o)', ['c']],
      ['for (process.env.X of a) {}', ['c']],
      // A spread on the left of a destructuring assignment writes the rest of `o` into the environment.
      ['({ ...process.env } = o)', ['c']],
      ['Object.assign(process.env, x)', ['c']],
      ['Object.assign(\n  process.env, x)', ['c']],
      ['Object.assign\n(process.env, x)', ['c']],
      ['Object.assign (process.env, x)', ['c']],
      ["Object.defineProperty(process.env, 'X', d)", ['c']],
      ["Object.defineProperty (process.env, 'X', d)", ['c']],
      ["Reflect.set(process.env, 'X', v)", ['c', 'd']],
      ['fn(process.env)', ['c']],
      ['const e = process.env', ['c']],
      ['function f() { return process.env }', ['c']],
      ['process.env', ['c']],
      ["process['env'].X = v", ['b']],
      ['const { env } = process', ['b']],
      ['const p = process', ['b']],
      ['globalThis.process.env.X = v', ['b', 'd']],
      ['fn(process)', ['b']],
      ["import p from 'node:process'", ['b']],
      ["require('process')", ['b']],
      // Rulings after the pre-review of f9b50cf1: a property outside the ten, and the names of rule (d).
      ['const p = process.valueOf()', ['b']],
      ['process.valueOf().env.X = v', ['b']],
      ['process.mainModule', ['b']],
      ["process.binding('fs')", ['b']],
      ["process.emit('x')", ['b']],
      ["process.once('exit', function () { this.env.X = v; })", ['d']],
      ["eval('process.env.X = 1')", ['d']],
      ["new Function('return process')()", ['d']],
      ['globalThis.process', ['b', 'd']],
      ['global.process', ['b', 'd']],
      ['Reflect.get(o, k)', ['d']],
      // process.once returns the process object: it is allowed only as a call that is a whole expression statement (second pre-review).
      ["process.once('beforeExit', () => {}).env.X = 'v'", ['b']],
      ["const p = process.once('exit', f)", ['b']],
      ["fn(process.once('exit', f))", ['b']],
      ['const o = process.once', ['b']],
      // A member of the object, or a key whose name cannot be read from the source, is no variable read (third pre-review).
      ['process.env.__proto__ || {}', ['c']],
      ["process.env['__proto__'] || {}", ['c']],
      ['process.env.constructor === Object', ['c']],
      ['process.env.valueOf === f', ['c']],
      ["process.env[k] === '1'", ['c']],
      ["process.env[`${'A'}`] === '1'", ['c']],
      ["process.env.lower === '1'", ['c']],
    ];
    for (const [text, rules] of failing) assert.deepEqual([...new Set(envViolations(text).map((v) => v.rule))].sort(), rules, JSON.stringify(text));
  });

  test('the CLI changes neither the process directory nor the environment: the default session token stays with the process directory [R1] [R8]', () => {
    // The behaviour row: with -C <repository> from a caller directory and no AIDLC_STATE_DIR or session variable, the default session
    // token is created under the caller directory's state directory (as on main, recorded in the card) and not under the repository's.
    const root = tempDir('session');
    const repo = path.join(root, 'repo');
    const caller = path.join(root, 'caller');
    mkdirSync(repo);
    mkdirSync(caller);
    gitInit(repo);
    const r = spawnSync(process.execPath, [main, '-C', repo, 'goal', 'new', 'a small change'], { cwd: caller, env: childEnv(), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readdirSync(path.join(repo, '.aidlc', 'goals')).filter((f) => f.endsWith('.json')).length, 1);
    assert.equal(existsSync(path.join(caller, '.aidlc', 'session-default')), true, 'the session token is under the caller directory');
    assert.match(readFileSync(path.join(caller, '.aidlc', 'session-default'), 'utf8'), /^default-/);
    assert.equal(existsSync(path.join(repo, '.aidlc', 'session-default')), false, 'no session token under the repository');
  });

  test('plan_ref without -C is the one main drafts, and with -C both sides are canonical: a plan file that is a link [R7] [R9]', (t) => {
    const fx = fixture();
    const repo = path.join(fx.root, 'repo');
    write(path.join(repo, 'plans', 'real.md'), PLAN);
    gitInit(repo);
    try {
      symlinkSync('real.md', path.join(repo, 'plans', 'link.md'), 'file');
    } catch (err) {
      return t.skip(`this host cannot create a file link: ${(err as NodeJS.ErrnoException).code}`);
    }
    // With -C the plan is named by its target; without -C by the value as typed, as main drafts it.
    const withC = fx.run(['-C', repo, 'cards', 'project', '--plan', 'plans/link.md']);
    assert.equal(withC.status, 0, withC.stderr);
    assert.match(withC.stdout, /^plan_ref: plans\/real\.md#7$/m, withC.stdout);
    const plain = fx.run(['cards', 'project', '--plan', 'plans/link.md'], undefined, repo);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /^plan_ref: plans\/link\.md#7$/m, plain.stdout);
  });

  test('without -C a value is passed as given [R6] [R9]', () => {
    const fx = fixture();
    // On every host: a relative value that names no file fails without -C with the error of main, and with -C names the resolved path.
    // Main's error names the value as typed on POSIX; on Windows Node's error names the file in the process directory (recorded in the card).
    const plain = fx.run(['spec', 'validate', 'nofile.md'], undefined, fx.target);
    assert.equal(plain.status, 1, plain.stderr);
    if (process.platform === 'win32') assert.ok(plain.stderr.startsWith('aidlc: ') && plain.stderr.includes(path.join(fx.target, 'nofile.md')), plain.stderr);
    else assert.equal(plain.stderr, "aidlc: ENOENT: no such file or directory, open 'nofile.md'\n");
    const withC = fx.run(['-C', fx.target, 'spec', 'validate', 'nofile.md']);
    assert.equal(withC.status, 1, withC.stderr);
    assert.ok(withC.stderr.includes(path.join(fx.target, 'nofile.md')), withC.stderr);
    // An error the command writes itself names the value as typed without -C on every host, and the resolved path with -C.
    const bench = fx.run(['review', 'bench', 'compare', 'nofile.json', 'other.json'], undefined, fx.target);
    assert.equal(bench.status, 1, bench.stderr);
    assert.equal(bench.stderr, 'aidlc: nofile.json: no such file\n');
    const benchC = fx.run(['-C', fx.target, 'review', 'bench', 'compare', 'nofile.json', 'other.json']);
    assert.ok(benchC.stderr.startsWith(`aidlc: ${path.join(fx.target, 'nofile.json')}: `), benchC.stderr);
    // Without -C the refusals of R3 still apply.
    const empty = fx.run(['spec', 'validate', ''], undefined, fx.target);
    assert.equal(empty.status, 1, empty.stderr);
    assert.ok(empty.stderr.startsWith('aidlc: <file> "": '), empty.stderr);
  });

  test('without -C a value is passed as given: missing/../spec.md on POSIX [R9]', { skip: process.platform === 'win32' && 'Windows reads missing\\..\\spec.md lexically, so only a POSIX file system shows the difference' }, () => {
    const fx = fixture();
    write(path.join(fx.target, 'spec.md'), 'no front matter\n');
    // Without -C the file system reads the value: `missing` does not exist, so the open fails, as on main.
    const plain = fx.run(['spec', 'validate', 'missing/../spec.md'], undefined, fx.target);
    assert.equal(plain.status, 1, plain.stderr);
    assert.equal(plain.stderr, "aidlc: ENOENT: no such file or directory, open 'missing/../spec.md'\n");
    assert.equal(plain.stdout, '');
    // With -C, R3 resolves it lexically: it names spec.md under the -C directory.
    const withC = fx.run(['-C', fx.target, 'spec', 'validate', 'missing/../spec.md', '--json']);
    assert.equal(withC.status, 1, withC.stderr);
    assert.deepEqual((JSON.parse(withC.stdout) as { problems: string[] }).problems, ['missing front matter']);
  });
});
