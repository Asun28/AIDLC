import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHookCommand } from '../../src/scaffold/init.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tpl = path.join(root, 'templates', 'claude');
const live = path.join(root, '.claude');

/** Relative paths (posix separators) of every file under `dir`, sorted. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

// A project verify skill (`.claude/skills/verify-*/`) names this repository's code, so the templates never ship it (CLAUDE.md, Conventions).
const projectVerifySkill = (rel: string): boolean => /^skills\/verify-[^/]+\//.test(rel);

/**
 * `.claude/` is the live copy of what `aidlc init` installs from `templates/claude/`
 * (CLAUDE.md, Conventions). Nothing else keeps the two trees equal, so this test does.
 */
describe('mirror (templates/claude == .claude)', () => {
  test('every template skill and agent file has a byte-identical live copy', () => {
    const files = walk(tpl).filter((rel) => rel !== 'settings.json');
    assert.ok(files.length > 0, 'templates/claude is empty');
    for (const rel of files) {
      const liveFile = path.join(live, rel);
      assert.ok(existsSync(liveFile), `.claude/${rel} missing: copy templates/claude/${rel}`);
      assert.ok(readFileSync(path.join(tpl, rel)).equals(readFileSync(liveFile)), `.claude/${rel} differs from templates/claude/${rel}`);
    }
  });

  test('every live skill and agent file is shipped by the templates', () => {
    for (const sub of ['skills', 'agents']) {
      for (const rel of walk(path.join(live, sub), live)) {
        if (projectVerifySkill(rel)) continue;
        assert.ok(existsSync(path.join(tpl, rel)), `templates/claude/${rel} missing: .claude/${rel} would not be installed by aidlc init`);
      }
    }
  });

  test('project verify skills live only under .claude/skills/verify-*/, each with a SKILL.md, and templates/claude/skills/ has none (T1-VERIFY-SKILL)', () => {
    for (const rel of ['skills/verify-x/SKILL.md', 'skills/verify-card-run-writes/notes/a.md']) assert.equal(projectVerifySkill(rel), true, rel);
    for (const rel of ['skills/verifyx/SKILL.md', 'skills/tdd/verify-x/SKILL.md', 'agents/verify-x/a.md', 'skills/verify-x', 'skills/aidlc-loop/verify-x.md']) assert.equal(projectVerifySkill(rel), false, rel);
    const shipped = readdirSync(path.join(tpl, 'skills')).filter((name) => name.startsWith('verify-'));
    assert.deepEqual(shipped, [], 'a project verify skill under templates/claude/skills/ would be installed downstream by aidlc init');
    const verify = readdirSync(path.join(live, 'skills'), { withFileTypes: true }).filter((e) => e.name.startsWith('verify-'));
    assert.ok(verify.length > 0, 'this repository carries its verify skill under .claude/skills/verify-*/');
    for (const e of verify) {
      assert.ok(e.isDirectory(), `.claude/skills/${e.name} is a directory`);
      assert.ok(existsSync(path.join(live, 'skills', e.name, 'SKILL.md')), `.claude/skills/${e.name}/SKILL.md missing`);
    }
  });

  test('settings.json differs from its template only by the hook command', () => {
    const template = readFileSync(path.join(tpl, 'settings.json'), 'utf8');
    const expected: unknown = JSON.parse(template.split('npx --no-install aidlc hook auto').join(resolveHookCommand(root)));
    const actual: unknown = JSON.parse(readFileSync(path.join(live, 'settings.json'), 'utf8'));
    assert.deepEqual(actual, expected);
  });

  test('REVIEW.md and the CLAUDE.md aidlc section match their templates', () => {
    assert.ok(readFileSync(path.join(root, 'REVIEW.md')).equals(readFileSync(path.join(root, 'templates', 'REVIEW.md'))), 'REVIEW.md differs from templates/REVIEW.md');
    const section = readFileSync(path.join(root, 'templates', 'CLAUDE.aidlc.md'), 'utf8').trim();
    const claude = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.ok(claude.endsWith(section + '\n'), 'CLAUDE.md must end with templates/CLAUDE.aidlc.md verbatim (aidlc init appends it)');
  });
});
