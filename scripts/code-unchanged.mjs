// Card T0-BASE-SYNC-JSDOC only: its dod_command runs this, never npm test; on any later branch that changes these files' code it fails by design.
// Usage: node scripts/code-unchanged.mjs <file>...
// Compares each file's TypeScript code, printed with comments removed, between HEAD and `git merge-base HEAD origin/main`.
// Exit 0: identical code. Exit 1: a code change. Exit 2: origin/main, the merge base or a file cannot be read; an error
// never passes. Local git only, no fetch.
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const files = process.argv.slice(2);
const unreadable = (what, err) => {
  process.stderr.write(`code-unchanged: cannot read ${what}: ${String(err?.stderr || err?.message || err).trim()}\n`);
  process.exit(2);
};
if (files.length === 0) unreadable('the file list', 'no file given');
const git = (args, what) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return unreadable(what, err);
  }
};
git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], 'origin/main');
const base = git(['merge-base', 'HEAD', 'origin/main'], 'the merge base of HEAD and origin/main').trim();
const printer = ts.createPrinter({ removeComments: true });
const code = (file, text) => printer.printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
let changed = false;
for (const file of files) {
  const before = code(file, git(['show', `${base}:${file}`], `${file} at the merge base ${base.slice(0, 7)}`));
  const after = code(file, git(['show', `HEAD:${file}`], `${file} at HEAD`));
  const a = before.split('\n');
  const b = after.split('\n');
  const line = a.findIndex((l, i) => l !== b[i]);
  if (before === after) console.log(`${file}: code identical at HEAD and the merge base ${base.slice(0, 7)} (${a.length} printed lines, comments removed)`);
  else {
    changed = true;
    console.log(`${file}: code CHANGED against the merge base ${base.slice(0, 7)}, first at printed line ${(line < 0 ? Math.min(a.length, b.length) : line) + 1}`);
  }
}
process.exit(changed ? 1 : 0);
