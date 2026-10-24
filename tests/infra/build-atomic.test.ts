// Card T0-BUILD-ATOMIC: `npm run build` writes each output whole, through a temporary sibling renamed onto it, and the
// two compiled entries that bin/resolve-entry.js compares with the sources after every other output.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/** A fixture project with one file, `a.ts`, holding `source`, and the given extra compiler options. */
function fixture(name: string, source: string, options: Record<string, unknown> = {}): string {
  const project = path.join(dir, name);
  mkdirSync(project);
  writeFileSync(path.join(project, 'a.ts'), source);
  writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true, outDir: 'out', types: [], ...options }, files: ['a.ts'] }));
  return project;
}

test('T0-BUILD-ATOMIC acceptance 4: node scripts/build.ts prints a type error as tsc does and exits 2 with outputs, 1 with the emit skipped, 0 with no error [R3]', () => {
  const cases = [
    { name: 'error', source: "const x: number = 'a';\nexport { x };\n", options: {}, status: 2, out: true },
    { name: 'error-no-emit', source: "const x: number = 'a';\nexport { x };\n", options: { noEmitOnError: true }, status: 1, out: false },
    { name: 'clean', source: 'const x: number = 1;\nexport { x };\n', options: {}, status: 0, out: true },
  ];
  for (const c of cases) {
    const ours = fixture(`${c.name}-build`, c.source, c.options);
    const theirs = fixture(`${c.name}-tsc`, c.source, c.options);
    const r = spawnSync(process.execPath, [BUILD, '-p', path.join(ours, 'tsconfig.json')], { cwd: root, encoding: 'utf8' });
    const t = spawnSync(process.execPath, [TSC, '-p', path.join(theirs, 'tsconfig.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, c.status, `${c.name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.status, t.status, c.name);
    assert.equal(existsSync(path.join(ours, 'out', 'a.js')), c.out, c.name);
    assert.equal(r.stderr, '', c.name);
    if (c.status === 0) assert.equal(r.stdout, '', c.name);
    else assert.match(r.stdout, /(^|[\\/])a\.ts\(1,7\): error TS2322: Type 'string' is not assignable to type 'number'\.\r?\n$/, c.name);
    assert.equal(r.stdout.replaceAll(`${c.name}-build`, '<fixture>'), t.stdout.replaceAll(`${c.name}-tsc`, '<fixture>'), c.name);
  }
});

const OPERATIONS_SENTENCES = [
  '`npm run build` runs `scripts/build.ts` (card T0-BUILD-ATOMIC), which compiles the program of `tsconfig.json` as `tsc -p tsconfig.json` does and writes each file of dist/ to a temporary sibling renamed onto it, `hooks/entry.js` and `cli/main.js` last, so a hook or CLI process started during a build loads the whole earlier module or the whole new one.',
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
  const hookProcess = paragraphs.findIndex((p) => p.startsWith('One hook process per event.'));
  if (hookProcess < 0 || paragraphs[hookProcess + 1] !== OPERATIONS_SENTENCES.join(' ')) missing.push('OPERATIONS');
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
