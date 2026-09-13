import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** Characters the writing rule (CLAUDE.md, Writing density) bans in prose: the em dash and the CJK corner brackets. */
const BANNED = /[—「」]/u;

/** 1-based line numbers of `text` that carry a banned character. */
export function bannedProse(text: string): number[] {
  const hits: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (BANNED.test(line)) hits.push(i + 1);
  });
  return hits;
}

/** Markdown files under `dir`, one level or recursive; a missing directory yields none. */
function markdownFiles(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...markdownFiles(abs, true));
    } else if (entry.name.endsWith('.md')) out.push(abs);
  }
  return out.sort();
}

/** Tracked prose. `docs/plans/**` (archived plan documents) is out of scope. Planning scratch files at the root are gitignored and not listed. */
const SCOPE: string[] = [
  ...['CLAUDE.md', 'README.md', 'REVIEW.md', 'CHANGELOG.md'].map((f) => path.join(root, f)),
  ...markdownFiles(path.join(root, 'docs'), false),
  ...markdownFiles(path.join(root, 'docs', 'adr'), true),
  ...markdownFiles(path.join(root, 'docs', 'references'), true),
  ...markdownFiles(path.join(root, 'templates'), true),
  ...markdownFiles(path.join(root, '.claude'), true),
  ...markdownFiles(path.join(root, 'specs'), true),
  ...markdownFiles(path.join(root, 'intent'), false),
  ...markdownFiles(path.join(root, 'plans'), false),
];

describe('prose (writing density)', () => {
  test('bannedProse flags an em dash and corner brackets and passes plain punctuation', () => {
    assert.deepEqual(bannedProse('a — b'), [1]);
    assert.deepEqual(bannedProse('first\n「quoted」\nthird'), [2]);
    assert.deepEqual(bannedProse('plain, with a hyphen - a colon: and "quotes"'), []);
  });

  test('tracked prose carries no em dash and no corner brackets', () => {
    assert.ok(SCOPE.length >= 20, `scope resolved to ${SCOPE.length} files`);
    const offenders: string[] = [];
    for (const file of SCOPE) {
      const lines = bannedProse(readFileSync(file, 'utf8'));
      if (lines.length) offenders.push(`${path.relative(root, file).split(path.sep).join('/')}:${lines.join(',')}`);
    }
    assert.deepEqual(offenders, [], `banned characters (em dash or corner brackets) in: ${offenders.join(' ')}`);
  });
});
