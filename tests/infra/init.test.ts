import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from '../../src/scaffold/init.ts';
import { loadProjectConfig } from '../../src/config.ts';

describe('aidlc init (scaffold)', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('lays the playbook layout over an empty directory and is idempotent', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-'));
    dirs.push(target);
    const first = initProject({ target, shipPath: 'dry-run' });
    for (const rel of ['.claude/settings.json', '.claude/skills/aidlc-loop/SKILL.md', '.claude/skills/aidlc-loop/card-loop.md', '.claude/agents/verifier.md', '.claude/skills/tdd/SKILL.md', '.claude/skills/diagnose/SKILL.md', '.claude/skills/grilling/SKILL.md', '.claude/skills/merge-conflicts/SKILL.md', 'docs/LESSONS.md', 'docs/THIRD-PARTY-NOTICES.md', '.github/workflows/security-scanners.yml', 'REVIEW.md', 'bands.yaml', 'intent/_TEMPLATE.md', 'specs/README.md', 'plans/_TEMPLATE.md', 'specs/tasks/_TEMPLATE.md', 'evals/example-regression.json', '.github/workflows/agent-evals.yml', 'aidlc.config.json', 'aidlc.ops.example.json', 'docs/DELIVERY-OPS.md', 'CLAUDE.md', '.gitignore']) {
      assert.ok(existsSync(path.join(target, rel)), `${rel} not created`);
    }
    assert.ok(first.created.length >= 25);
    const cfg = loadProjectConfig(target);
    assert.equal(cfg.found, true);
    assert.equal(cfg.config.shipPath, 'dry-run');
    assert.equal(cfg.config.cardsDir, 'specs/tasks');
    assert.match(readFileSync(path.join(target, '.gitignore'), 'utf8'), /\.aidlc\//);
    assert.match(readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), /## AI-native SDLC \(aidlc\)/);
    const second = initProject({ target, shipPath: 'dry-run' });
    assert.equal(second.created.length, 0, 'second init must not create files');
    assert.ok(second.skipped.length >= 25);
    assert.ok(!second.merged.includes('.gitignore'), '.gitignore entries are not duplicated');
    assert.ok(second.skipped.includes('CLAUDE.md (section present)'));
  });

  test('merges an existing settings.json (hooks + deny) and appends to an existing CLAUDE.md', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-'));
    dirs.push(target);
    mkdirSync(path.join(target, '.claude'), { recursive: true });
    writeFileSync(path.join(target, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(./secret.txt)'], allow: ['Bash(git *)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-existing-gate' }, { type: 'command', command: 'npx --no-install aidlc hook production-gate' }] }] } }));
    writeFileSync(path.join(target, 'CLAUDE.md'), '# my project\n\n## Commands\n- make test\n');
    const report = initProject({ target, cardsDir: 'cards' });
    assert.ok(report.merged.includes('.claude/settings.json'));
    assert.ok(report.merged.includes('CLAUDE.md'));
    const settings = JSON.parse(readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8')) as { permissions: { deny: string[]; allow: string[] }; hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };
    assert.ok(settings.permissions.deny.includes('Read(./secret.txt)'));
    assert.ok(settings.permissions.deny.some((d) => d.includes('.env')));
    assert.deepEqual(settings.permissions.allow, ['Bash(git *)']);
    const pre = settings.hooks['PreToolUse']!;
    const all = pre.flatMap((h) => h.hooks.map((x) => x.command));
    assert.ok(all.includes('my-existing-gate'), 'foreign hook must survive the merge');
    assert.equal(all.filter((c) => /aidlc hook auto$/.test(c)).length, 1, `dispatcher wired once: ${all.join(', ')}`);
    assert.ok(!all.some((c) => /aidlc hook production-gate$/.test(c)), 'legacy per-guard hook must be replaced by the dispatcher');
    const claude = readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /^# my project/);
    assert.match(claude, /## AI-native SDLC \(aidlc\)/);
    assert.ok(existsSync(path.join(target, 'cards', '_TEMPLATE.md')));
    assert.equal(loadProjectConfig(target).config.cardsDir, 'cards');
  });

  test('dry run reports without writing', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-'));
    dirs.push(target);
    const report = initProject({ target, dryRun: true });
    assert.ok(report.created.length > 0);
    assert.ok(!existsSync(path.join(target, 'REVIEW.md')));
  });
});
