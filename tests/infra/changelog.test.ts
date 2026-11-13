// Card T0-RELEASE-0-2-0: changelogSince010 returns the part from the Unreleased heading line down to the line feed before the 0.1.0
// heading line, unchanged, and the empty string when a heading line is missing, doubled or out of order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIRST_RELEASE_HEADING, changelogSince010 } from './changelog.ts';

const U = '## Unreleased';
const F = FIRST_RELEASE_HEADING;

test('changelogSince010 on each input class', async (t) => {
  assert.equal(F, '## 0.1.0 - 2026-09-11');
  const rows: [string, string, string][] = [
    ['both headings in order', '# Changelog\n\n' + U + '\n\n- a\n\n' + F + '\n\n- old\n', U + '\n\n- a\n'],
    ['a release heading between the two', U + '\n\n- n\n\n## 0.2.0 - 2026-11-14\n\n- a\n\n' + F + '\n', U + '\n\n- n\n\n## 0.2.0 - 2026-11-14\n\n- a\n'],
    ['carriage returns', U + '\r\n\r\n- a\r\n\r\n' + F + '\r\n', U + '\r\n\r\n- a\r\n\r'],
    ['U at index 0 and F as the last line with no line end', U + '\n- a\n' + F, U + '\n- a'],
    ['a mention inside a line is no heading line', U + '\n\n- see `' + U + '` and `' + F + '`\n\n' + F + '\n', U + '\n\n- see `' + U + '` and `' + F + '`\n'],
    ['no U line', '# Changelog\n\n' + F + '\n', ''],
    ['no F line', U + '\n\n- a\n', ''],
    ['U twice as a line', U + '\n\n- a\n\n' + U + '\n\n- b\n\n' + F + '\n', ''],
    ['F twice as a line', U + '\n\n- a\n\n' + F + '\n\n- b\n\n' + F + '\n', ''],
    ['F before U', F + '\n\n' + U + '\n\n- a\n', ''],
    ['U with a suffix', U + ' (next)\n\n- a\n\n' + F + '\n', ''],
    ['F with a suffix', U + '\n\n- a\n\n' + F + ' (final)\n', ''],
    ['U with a leading blank', ' ' + U + '\n\n- a\n\n' + F + '\n', ''],
    ['F with a leading blank', U + '\n\n- a\n\n ' + F + '\n', ''],
    ['## 0.1.0 alone in place of F', U + '\n\n- a\n\n## 0.1.0\n', ''],
  ];
  for (const [name, text, expected] of rows) {
    await t.test(name, () => {
      assert.equal(changelogSince010(text), expected);
    });
  }
  await t.test("the repository's CHANGELOG.md", () => {
    const file = readFileSync(path.resolve(import.meta.dirname, '..', '..', 'CHANGELOG.md'), 'utf8');
    const part = changelogSince010(file);
    assert.ok(part.startsWith(U + '\n'), 'the part starts with the Unreleased heading line');
    const lines = part.split('\n');
    assert.ok(lines.includes('## 0.2.0 - 2026-11-14'), 'the part holds the release heading line 0.2.0');
    assert.ok(!lines.includes(F), 'the part holds no 0.1.0 heading line');
    const at = file.indexOf(part);
    assert.equal(file.slice(at + part.length, at + part.length + F.length + 1), '\n' + F, 'in the file the part is directly followed by a line feed and the 0.1.0 heading');
  });
});
