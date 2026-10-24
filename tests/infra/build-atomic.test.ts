// Card T0-BUILD-ATOMIC: `npm run build` writes each output whole, through a temporary sibling renamed onto it, and the
// two compiled entries that bin/resolve-entry.js compares with the sources after every other output.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { EOL } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanup, tmpDir } from './helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const BUILD = path.join(root, 'scripts', 'build.ts');
const ENTRIES = ['cli/main.js', 'hooks/entry.js'];

/**
 * A preload that records, under BUILD_RECORD_OUT, each `openSync` with a write flag, each `writeFileSync` and each
 * `renameSync` onto a path there, one JSON line per call in call order, written to BUILD_RECORD_LOG at exit. It patches
 * the fs module object itself, which tsc (`_fs.openSync(fileName, "w")`) and the ES named imports of node:fs (after
 * `syncBuiltinESMExports`) both call through.
 */
const RECORDER = `
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const out = path.resolve(process.env.BUILD_RECORD_OUT);
const log = process.env.BUILD_RECORD_LOG;
const lines = [];
const under = (p) => {
  if (typeof p !== 'string') return undefined;
  const r = path.relative(out, path.resolve(p));
  return r === '' || r.startsWith('..') || path.isAbsolute(r) ? undefined : r.split(path.sep).join('/');
};
const writes = (flags) => typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0 : /[wa+]/.test(String(flags ?? 'r'));
const { openSync, writeFileSync, renameSync } = fs;
fs.openSync = function (p, flags, ...rest) {
  const r = under(p);
  if (r !== undefined && writes(flags)) lines.push(JSON.stringify(['open', r]));
  return openSync.call(fs, p, flags, ...rest);
};
fs.writeFileSync = function (p, ...rest) {
  const r = under(p);
  if (r !== undefined) lines.push(JSON.stringify(['write', r]));
  return writeFileSync.call(fs, p, ...rest);
};
fs.renameSync = function (from, to) {
  const r = under(to);
  if (r !== undefined) lines.push(JSON.stringify(['rename', r, under(from) ?? String(from)]));
  return renameSync.call(fs, from, to);
};
syncBuiltinESMExports();
process.on('exit', () => writeFileSync.call(fs, log, lines.join('\\n')));
`;

type Call = { op: 'open' | 'write' | 'rename'; file: string; from?: string };

/** The argv of package.json's `build` script after the Node binary: `tsc` is the compiler's own bin, `node` this Node. */
function buildArgv(): string[] {
  const script = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts['build'] ?? '';
  const [cmd, ...args] = script.split(' ');
  if (cmd === 'tsc') return [TSC, ...args];
  if (cmd === 'node') return args.map((a) => (a.endsWith('.ts') ? path.join(root, a) : a));
  throw new Error(`unexpected build script ${JSON.stringify(script)}`);
}

/** Every file under `dir`, relative and with forward slashes, sorted. */
function files(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else found.push(path.relative(dir, abs).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return found.sort();
}

const dir = tmpDir();
const atomicOut = path.join(dir, 'atomic');
const tscOut = path.join(dir, 'tsc');
let record: Call[] = [];
let outputs: string[] = [];

before(() => {
  const recorder = path.join(dir, 'recorder.mjs');
  const log = path.join(dir, 'record.jsonl');
  writeFileSync(recorder, RECORDER);
  const built = spawnSync(process.execPath, ['--import', pathToFileURL(recorder).href, ...buildArgv(), '--outDir', atomicOut], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BUILD_RECORD_OUT: atomicOut, BUILD_RECORD_LOG: log },
    timeout: 240_000,
  });
  assert.equal(built.status, 0, `npm run build failed: ${built.stdout}${built.stderr}`);
  const reference = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--outDir', tscOut], { cwd: root, encoding: 'utf8', timeout: 240_000 });
  assert.equal(reference.status, 0, `tsc failed: ${reference.stdout}${reference.stderr}`);
  record = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [op, file, from] = JSON.parse(l) as [Call['op'], string, string?];
      return { op, file, ...(from === undefined ? {} : { from }) };
    });
  outputs = files(atomicOut);
});

after(() => cleanup(dir));

test('T0-BUILD-ATOMIC acceptance 1: npm run build writes every output only by a rename from a temporary sibling, and opens or writes no output in place [R1]', () => {
  assert.ok(outputs.includes('hooks/entry.js') && outputs.includes('hooks/entry.js.map') && outputs.includes('hooks/entry.d.ts') && outputs.includes('hooks/entry.d.ts.map'), outputs.slice(0, 8).join(', '));
  const inPlace = record.filter((c) => c.op !== 'rename' && outputs.includes(c.file)).map((c) => `${c.op} ${c.file}`);
  assert.deepEqual(inPlace.slice(0, 5), [], `${inPlace.length} outputs opened or written in place`);
  const unrenamed = outputs.filter((f) => !record.some((c) => c.op === 'rename' && c.file === f && c.from !== undefined && c.from !== f && path.posix.dirname(c.from) === path.posix.dirname(f)));
  assert.deepEqual(unrenamed.slice(0, 5), [], `${unrenamed.length} outputs not renamed onto from a sibling`);
});

test('T0-BUILD-ATOMIC acceptance 2: the outputs are the files tsc -p tsconfig.json emits, with the same bytes, and no temporary file is left [R1]', () => {
  assert.deepEqual(outputs, files(tscOut));
  assert.deepEqual(outputs.filter((f) => /\.tmp-/.test(f)), []);
  const differ = outputs.filter((f) => !readFileSync(path.join(atomicOut, f)).equals(readFileSync(path.join(tscOut, f))));
  assert.deepEqual(differ, []);
});

test('T0-BUILD-ATOMIC acceptance 3: the last write onto hooks/entry.js and onto cli/main.js comes after the last write onto every other output [R2]', () => {
  const last = new Map<string, number>();
  record.forEach((c, i) => last.set(c.file, i));
  for (const entry of ENTRIES) {
    const at = last.get(entry);
    assert.ok(at !== undefined, `${entry} is written`);
    const later = outputs.filter((f) => !ENTRIES.includes(f) && (last.get(f) ?? -1) > at);
    assert.deepEqual(later.slice(0, 5), [], `${later.length} outputs written after ${entry}`);
  }
});

/** A fixture project with one file, `a.ts`, holding `source`, compiled with `options` over a base that writes to `out/` (a null option is left out). */
function fixture(name: string, source: string, options: Record<string, unknown> = {}): string {
  const project = path.join(dir, name);
  mkdirSync(project);
  writeFileSync(path.join(project, 'a.ts'), source);
  const compilerOptions = Object.fromEntries(Object.entries({ target: 'ES2022', strict: true, outDir: 'out', types: [], ...options }).filter(([, v]) => v !== null));
  writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['a.ts'] }));
  return project;
}

const TYPE_ERROR = "const x: number = 'a';\nexport { x };\n";
const CLEAN = 'const x: number = 1;\nexport { x };\n';
const TS2322 = /^[^\n]*[\\/]a\.ts\(1,7\): error TS2322: Type 'string' is not assignable to type 'number'\.\r?\n$/;

test('T0-BUILD-ATOMIC acceptance 4: node scripts/build.ts prints each diagnostic as tsc does and exits 2 with outputs, 1 with the emit skipped, 0 with none [R3]', () => {
  // `out` is the one compiled file the run leaves, relative to the fixture; `args` gives the project argument.
  const cases: { name: string; source: string; options?: Record<string, unknown>; args?: (project: string) => string[]; status: number; out?: string; stdout: RegExp | '' }[] = [
    { name: 'error', source: TYPE_ERROR, status: 2, out: 'out/a.js', stdout: TS2322 },
    { name: 'error-no-emit', source: TYPE_ERROR, options: { noEmitOnError: true }, status: 1, stdout: TS2322 },
    { name: 'clean', source: CLEAN, status: 0, out: 'out/a.js', stdout: '' },
    { name: 'clean-dir', source: CLEAN, args: (p) => ['--project', p], status: 0, out: 'out/a.js', stdout: '' },
    { name: 'no-outdir', source: CLEAN, options: { outDir: null }, status: 0, out: 'a.js', stdout: '' },
    { name: 'bom', source: CLEAN, options: { emitBOM: true }, status: 0, out: 'out/a.js', stdout: '' },
    // tsc reports a syntax error alone, without the type error on line 1 or an options error.
    { name: 'syntax', source: "const x: number = 'a';\nconst y = ;\n", status: 2, out: 'out/a.js', stdout: /^[^\n]*[\\/]a\.ts\(2,11\): error TS1109: Expression expected\.\r?\n$/ },
    { name: 'syntax-options', source: "const x: number = 'a';\nconst y = ;\n", options: { declarationMap: true }, status: 2, out: 'out/a.js', stdout: /^[^\n]*[\\/]a\.ts\(2,11\): error TS1109: Expression expected\.\r?\n$/ },
    // tsc reports an options error without the type error.
    { name: 'options-type', source: TYPE_ERROR, options: { declarationMap: true }, status: 2, out: 'out/a.js', stdout: /^[^\n]*[\\/]tsconfig\.json\(1,\d+\): error TS5069: [^\n]*\r?\n$/ },
    { name: 'options', source: CLEAN, options: { declarationMap: true }, status: 2, out: 'out/a.js', stdout: /^[^\n]*[\\/]tsconfig\.json\(1,\d+\): error TS5069: Option 'declarationMap' cannot be specified without specifying option 'declaration' or option 'composite'\.\r?\n$/ },
    { name: 'config', source: CLEAN, options: { notAnOption: true }, status: 2, out: 'out/a.js', stdout: /^[^\n]*[\\/]tsconfig\.json\(1,\d+\): error TS5023: Unknown compiler option 'notAnOption'\.\r?\n$/ },
  ];
  for (const c of cases) {
    const ours = fixture(`${c.name}-build`, c.source, c.options);
    const theirs = fixture(`${c.name}-tsc`, c.source, c.options);
    const r = spawnSync(process.execPath, [BUILD, ...(c.args ?? ((p: string) => ['-p', path.join(p, 'tsconfig.json')]))(ours)], { cwd: root, encoding: 'utf8' });
    const t = spawnSync(process.execPath, [TSC, '-p', path.join(theirs, 'tsconfig.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, c.status, `${c.name}: ${r.stdout}${r.stderr}`);
    assert.equal(t.status, c.status, `${c.name} (tsc): ${t.stdout}`);
    assert.equal(r.stderr, '', c.name);
    if (c.stdout === '') assert.equal(r.stdout, '', c.name);
    else assert.match(r.stdout, c.stdout, c.name);
    assert.equal(r.stdout.replaceAll(`${c.name}-build`, '<fixture>'), t.stdout.replaceAll(`${c.name}-tsc`, '<fixture>'), c.name);
    const js = (p: string) => files(p).filter((f) => f.endsWith('.js'));
    assert.deepEqual(js(ours), c.out === undefined ? [] : [c.out], c.name);
    assert.deepEqual(js(theirs), c.out === undefined ? [] : [c.out], `${c.name} (tsc)`);
    if (c.out !== undefined) assert.ok(readFileSync(path.join(ours, c.out)).equals(readFileSync(path.join(theirs, c.out))), c.name);
  }
  assert.deepEqual([...readFileSync(path.join(dir, 'bom-build', 'out', 'a.js')).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('T0-BUILD-ATOMIC acceptance 4: a tsconfig that cannot be read and an argument the build does not take exit 1 [R3]', () => {
  const missing = path.join(dir, 'missing', 'tsconfig.json');
  const r = spawnSync(process.execPath, [BUILD, '-p', missing], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, `error TS5083: Cannot read file '${missing}'.${EOL}`);
  assert.equal(r.stderr, '');
  const w = spawnSync(process.execPath, [BUILD, '--watch'], { cwd: root, encoding: 'utf8' });
  assert.equal(w.status, 1);
  assert.equal(w.stdout, '');
  assert.equal(w.stderr, 'build: unknown argument "--watch"; takes -p <tsconfig> and --outDir <dir>\n');
});

/**
 * A preload that makes `renameSync` onto a path ending in BUILD_FAIL_RENAME throw an error with code BUILD_FAIL_CODE, for
 * the first BUILD_FAIL_TIMES tries (every try when unset).
 */
const FAULT = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const suffix = process.env.BUILD_FAIL_RENAME;
const code = process.env.BUILD_FAIL_CODE;
let left = process.env.BUILD_FAIL_TIMES === undefined ? Infinity : Number(process.env.BUILD_FAIL_TIMES);
const { renameSync } = fs;
fs.renameSync = function (from, to) {
  if (String(to).split('\\\\').join('/').endsWith(suffix) && left-- > 0) throw Object.assign(new Error(code + ': injected rename failure'), { code });
  return renameSync.call(fs, from, to);
};
syncBuiltinESMExports();
`;

/** A fixture whose two entries come before `core/a.ts` in emit order, so a build that wrote them unheld would write them before the failed one. */
function entriesFixture(name: string): string {
  const project = path.join(dir, name);
  for (const rel of ['hooks/entry.ts', 'cli/main.ts', 'core/a.ts']) {
    mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    writeFileSync(path.join(project, rel), `export const ${path.basename(rel, '.ts')} = 1;\n`);
  }
  writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true, rootDir: '.', outDir: 'out', types: [] }, files: ['hooks/entry.ts', 'cli/main.ts', 'core/a.ts'] }));
  return project;
}

/** The build of a fresh entries fixture, with the rename onto `out/<fault.file>` (default `core/a.js`) failing as `fault` says (no fault when undefined). */
function entriesBuild(name: string, fault?: { code: string; times?: number; file?: string }): { status: number | null; stdout: string; stderr: string; out: string } {
  const preload = path.join(dir, 'fault.mjs');
  if (!existsSync(preload)) writeFileSync(preload, FAULT);
  const project = entriesFixture(name);
  const env: NodeJS.ProcessEnv = { ...process.env, BUILD_FAIL_RENAME: `/out/${fault?.file ?? 'core/a.js'}`, BUILD_FAIL_CODE: fault?.code ?? '' };
  if (fault?.times !== undefined) env['BUILD_FAIL_TIMES'] = String(fault.times);
  const argv = [...(fault ? ['--import', pathToFileURL(preload).href] : []), BUILD, '-p', path.join(project, 'tsconfig.json')];
  const r = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: path.join(project, 'out') };
}

test('T0-BUILD-ATOMIC acceptance 6: a write that fails stops the build there with exit 1, so no entry follows a failed write of another output; a rename refused while a file is open is retried [R1] [R2]', () => {
  const failed = entriesBuild('entries-eio', { code: 'EIO' });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.equal(failed.stdout, '');
  assert.equal(failed.stderr, 'build: EIO: injected rename failure\n');
  assert.equal(existsSync(path.join(failed.out, 'hooks', 'entry.js')), false);
  assert.equal(existsSync(path.join(failed.out, 'cli', 'main.js')), false);
  assert.deepEqual(files(failed.out), []);
  // Only the codes of a rename onto an open file are retried: EIO fails at its first try.
  const once = entriesBuild('entries-eio-1', { code: 'EIO', times: 1 });
  assert.equal(once.status, 1, once.stdout + once.stderr);
  assert.equal(once.stderr, 'build: EIO: injected rename failure\n');
  assert.deepEqual(files(once.out), []);
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const retried = entriesBuild(`entries-${code.toLowerCase()}-3`, { code, times: 3 });
    assert.equal(retried.status, 0, `${code}: ${retried.stdout}${retried.stderr}`);
    assert.equal(retried.stderr, '', code);
    assert.deepEqual(files(retried.out), ['cli/main.js', 'core/a.js', 'hooks/entry.js'], code);
    assert.equal(readFileSync(path.join(retried.out, 'core', 'a.js'), 'utf8'), 'export const a = 1;\n', code);
  }
  const refused = entriesBuild('entries-eperm', { code: 'EPERM' });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(refused.stderr, 'build: EPERM: injected rename failure\n');
  assert.deepEqual(files(refused.out), []);
  // A failed entry stops the build there: the entry written before it stays, whole, and every module either loads was written first.
  const main = entriesBuild('entries-main', { code: 'EIO', file: 'cli/main.js' });
  assert.equal(main.status, 1, main.stdout + main.stderr);
  assert.equal(main.stderr, 'build: EIO: injected rename failure\n');
  assert.deepEqual(files(main.out), ['core/a.js', 'hooks/entry.js']);
  assert.equal(readFileSync(path.join(main.out, 'hooks', 'entry.js'), 'utf8'), 'export const entry = 1;\n');
  assert.equal(readFileSync(path.join(main.out, 'core', 'a.js'), 'utf8'), 'export const a = 1;\n');
  const entry = entriesBuild('entries-entry', { code: 'EIO', file: 'hooks/entry.js' });
  assert.equal(entry.status, 1, entry.stdout + entry.stderr);
  assert.equal(entry.stderr, 'build: EIO: injected rename failure\n');
  assert.deepEqual(files(entry.out), ['core/a.js']);
  const clean = entriesBuild('entries-clean');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.deepEqual(files(clean.out), ['cli/main.js', 'core/a.js', 'hooks/entry.js']);
});

const OPERATIONS_SENTENCES = [
  '`npm run build` runs `scripts/build.ts` (card T0-BUILD-ATOMIC), which compiles the program of `tsconfig.json` as `tsc -p tsconfig.json` does and writes each file of dist/ to a temporary sibling renamed onto it, `hooks/entry.js` and `cli/main.js` last, so a hook or CLI process started during a build loads the whole earlier module or the whole new one.',
  'A rename Windows refuses while another process reads the file is retried for up to 2 s, and a write that still fails stops the build there, so an entry is written only after every module it loads.',
  'Under `tsc` a hook could load a module emptied for its rewrite: a PreToolUse guard then exited 1 with no deny and the routing guard printed nothing.',
  'A bare `tsc` still writes dist/ in place.',
];
const CHANGELOG_SENTENCES = [
  '- T0-BUILD-ATOMIC (bugfix): `npm run build` runs `scripts/build.ts`, which emits the files `tsc -p tsconfig.json` emits with the same bytes, each written to a temporary sibling and renamed onto it, and the two compiled entries last.',
  'Before, tsc emptied each file of dist/ before writing it, so a hook started during a build could load an empty module and run no guard: a denied write went ahead, and a typed request got no routing line.',
];
const CLAUDE_LINE = 'npm run build                  # scripts/build.ts: tsc -> dist/, each file written whole (rewrites .ts imports to .js)';
const README_LINE = 'npm run build        # scripts/build.ts: tsc -> dist/, each file written whole';

type Docs = { operations: string; changelog: string; claude: string; readme: string };

/** The doc texts of the card missing from `docs`, by name. */
function missingDocText(docs: Docs): string[] {
  const missing: string[] = [];
  const paragraphs = docs.operations.split(/\n\s*\n/);
  const hookLoading = paragraphs.findIndex((p) => p.startsWith('What a hook process loads'));
  if (hookLoading < 0 || paragraphs[hookLoading + 1] !== OPERATIONS_SENTENCES.join(' ')) missing.push('OPERATIONS');
  const start = docs.changelog.indexOf('## Unreleased');
  const unreleased = start < 0 ? '' : docs.changelog.slice(start, docs.changelog.indexOf('\n## ', start + 1));
  if (!unreleased.includes(`\n${CHANGELOG_SENTENCES.join(' ')}\n`)) missing.push('CHANGELOG');
  if (!docs.claude.split('\n').includes(CLAUDE_LINE)) missing.push('CLAUDE.md');
  if (!docs.readme.split('\n').includes(README_LINE)) missing.push('README.md');
  return missing;
}

test('T0-BUILD-ATOMIC acceptance 5: npm run build is scripts/build.ts, the typecheck covers scripts/, and the docs carry every text this card adds; removing any one fails [R4]', () => {
  assert.equal((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts['build'], 'node scripts/build.ts');
  assert.ok(((JSON.parse(read('tsconfig.test.json')) as { include: string[] }).include).includes('scripts/**/*.ts'));
  const docs: Docs = { operations: read('docs/OPERATIONS.md'), changelog: read('CHANGELOG.md'), claude: read('CLAUDE.md'), readme: read('README.md') };
  assert.deepEqual(missingDocText(docs), []);
  const cut = (text: string, piece: string): string => {
    assert.ok(text.includes(piece), piece);
    return text.replace(piece, '');
  };
  for (const s of OPERATIONS_SENTENCES) assert.deepEqual(missingDocText({ ...docs, operations: cut(docs.operations, s) }), ['OPERATIONS'], s);
  for (const s of CHANGELOG_SENTENCES) assert.deepEqual(missingDocText({ ...docs, changelog: cut(docs.changelog, s) }), ['CHANGELOG'], s);
  assert.deepEqual(missingDocText({ ...docs, claude: cut(docs.claude, CLAUDE_LINE) }), ['CLAUDE.md']);
  assert.deepEqual(missingDocText({ ...docs, readme: cut(docs.readme, README_LINE) }), ['README.md']);
});
