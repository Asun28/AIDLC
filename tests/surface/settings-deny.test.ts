import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function denyList(file: string): string[] {
  return (JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { permissions: { deny: string[] } }).permissions.deny;
}

/** The 18 secret-file rules both settings files held before card T0-DENY-IRREVERSIBLE-GIT, in their order. */
const SECRET_READS = [
  'Read(./.env)',
  'Read(./.env.local)',
  'Read(**/*.env)',
  'Read(**/.env.local)',
  'Read(**/.env.production)',
  'Read(**/.env.staging)',
  'Read(./auth/**)',
  'Read(**/.secrets/**)',
  'Read(**/*.key)',
  'Read(**/*.pem)',
  'Read(**/*.pfx)',
  'Read(**/*.p12)',
  'Read(**/*.keystore)',
  'Read(**/id_rsa*)',
  'Read(**/*credentials*.json)',
  'Read(**/service-account*.json)',
  'Read(**/*.secret)',
  'Read(**/*storage_state*.json)',
];

const GIT_PATTERNS = [
  'git reset --hard',
  'git reset --hard *',
  'git push --force*',
  'git push -f*',
  'git push * --force*',
  'git push * -f',
  'git push * -f *',
  'git clean -*f*',
  'git checkout -- *',
  'git checkout .',
  '* --no-verify*',
];

const EXPECTED = [...SECRET_READS, 'Read(~/.ssh/**)', ...GIT_PATTERNS.map((p) => `Bash(${p})`), ...GIT_PATTERNS.map((p) => `PowerShell(${p})`)];

/**
 * The matching the Claude Code permissions page documents, as far as these rows need it: a rule matches the whole command,
 * `*` matches any text (spaces and empty text included), and PowerShell rules ignore case. It models the documented rules;
 * it is not Claude Code's matcher.
 */
function matches(rule: string, tool: 'Bash' | 'PowerShell', command: string): boolean {
  const prefix = `${tool}(`;
  if (!rule.startsWith(prefix) || !rule.endsWith(')')) return false;
  const pattern = rule.slice(prefix.length, -1);
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, tool === 'PowerShell' ? 'i' : '').test(command);
}

const DENIED = [
  'git reset --hard',
  'git reset --hard HEAD~1',
  'git push --force',
  'git push --force-with-lease origin T0-X',
  'git push -f origin main',
  'git push origin main --force',
  'git push origin main -f',
  'git clean -f',
  'git clean -fdx',
  'git clean -d -f',
  'git checkout -- src/a.ts',
  'git checkout .',
  'git commit --no-verify -m x',
  'git push --no-verify origin T0-X',
];

const ALLOWED = [
  'git push origin main',
  'git push -u origin T0-X',
  'git push --follow-tags origin main',
  'git push origin feature-f',
  'git checkout --conflict=diff3 -- CHANGELOG.md',
  'git checkout main',
  'git checkout -b T0-X origin/main',
  'git reset --soft HEAD~1',
  'git reset HEAD src/a.ts',
  'git clean -n',
  'git restore --staged src/a.ts',
  'git commit -m fix',
];

describe('T0-DENY-IRREVERSIBLE-GIT: the settings deny lists', () => {
  test('acceptance 1: the live and template deny lists are the same 41 rules, the 18 secret reads first [R1] [R2]', () => {
    const live = denyList('.claude/settings.json');
    const template = denyList('templates/claude/settings.json');
    assert.deepEqual(live, template);
    assert.deepEqual(template, EXPECTED);
    assert.equal(template.length, 41);
  });

  test('acceptance 2: each denied row matches a Bash and a PowerShell rule, and no allowed row matches any rule [R3]', () => {
    const rules = denyList('templates/claude/settings.json');
    for (const command of DENIED) {
      for (const tool of ['Bash', 'PowerShell'] as const) {
        assert.ok(rules.some((r) => matches(r, tool, command)), `${tool} denies: ${command}`);
      }
    }
    assert.ok(rules.some((r) => matches(r, 'PowerShell', 'GIT PUSH --FORCE')), 'PowerShell denies: GIT PUSH --FORCE');
    for (const command of ALLOWED) {
      for (const tool of ['Bash', 'PowerShell'] as const) {
        const hit = rules.filter((r) => matches(r, tool, command));
        assert.deepEqual(hit, [], `${tool} allows: ${command}`);
      }
    }
  });
});
