import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

/** The one reviewed finding: commit, file, rule id, start line, as gitleaks prints it. */
const REVIEWED = ['7265d10642001a051fa36ac3f9c061a72a4540b3:docs/LESSONS.md:generic-api-key:153'];
const FINGERPRINT = /^[0-9a-f]{40}:[^:\s]+:[A-Za-z0-9._-]+:\d+$/;

/** The finding lines of an ignore file: neither blank nor comment. A carriage return ends a line. */
function findings(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '' && !l.startsWith('#'));
}

const readIfPresent = (file: string) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : '');

describe('gitleaks lists', () => {
  test('the ignore list holds exactly the reviewed findings, each a fingerprint', () => {
    const lines = findings(readIfPresent('.gitleaksignore'));
    assert.deepEqual(lines, REVIEWED);
    for (const line of lines) assert.match(line, FINGERPRINT);
  });

  test('the line classifier skips comments, blanks and a trailing carriage return', () => {
    assert.deepEqual(findings('# note\n\n' + REVIEWED[0] + '\r\n'), REVIEWED);
  });

  test('the form check refuses a bare path, a rule id alone and an upper-case commit', () => {
    for (const bad of ['docs/LESSONS.md', 'generic-api-key', REVIEWED[0]!.replace(/^[0-9a-f]+/, (h) => h.toUpperCase())]) {
      assert.doesNotMatch(bad, FINGERPRINT);
    }
  });

  test('the allowlist of .gitleaks.toml is what it was', () => {
    const lines = readFileSync(path.join(root, '.gitleaks.toml'), 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
    assert.deepEqual(lines, [
      '[extend]',
      'useDefault = true',
      '[allowlist]',
      'description = "Placeholder credentials used as fixtures by the secrets-guard hook tests, and the synthetic YAML canary of the intent narration test"',
      String.raw`paths = ['''tests/surface/hooks\.test\.ts''']`,
      "regexes = ['''CANARY-hunter2-SECRET''']",
    ]);
  });
});
