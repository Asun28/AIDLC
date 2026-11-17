// Card T0-RELEASE-0-2-0: the part of CHANGELOG.md a test reads for its entry, from the Unreleased heading down to the 0.1.0 heading.
// Card T1-CHANGELOG-FRAGMENTS: the form of a fragment `changelog.d/<card id>.md` and the entry it holds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CARD_ID_REGEX } from '../../src/core/types.ts';

/** The heading of the first release; every entry written after it stands above it. */
export const FIRST_RELEASE_HEADING = '## 0.1.0 - 2026-09-11';

const UNRELEASED_HEADING = '## Unreleased';

/** The index of every line of `text` that equals `heading`, ended by a line feed, a carriage return and a line feed, or the end of the text. */
function headingLines(text: string, heading: string): number[] {
  const found: number[] = [];
  for (let i = text.indexOf(heading); i !== -1; i = text.indexOf(heading, i + 1)) {
    const after = i + heading.length;
    const atLineStart = i === 0 || text[i - 1] === '\n';
    const atLineEnd = after === text.length || text[after] === '\n' || text.startsWith('\r\n', after);
    if (atLineStart && atLineEnd) found.push(i);
  }
  return found;
}

/**
 * The text from the heading line `## Unreleased` up to the line feed before the heading line `FIRST_RELEASE_HEADING`, unchanged; the
 * empty string when either heading line is absent or stands more than once, or when the second does not stand after the first.
 */
export function changelogSince010(text: string): string {
  const [start, ...moreStarts] = headingLines(text, UNRELEASED_HEADING);
  const [end, ...moreEnds] = headingLines(text, FIRST_RELEASE_HEADING);
  if (start === undefined || end === undefined || moreStarts.length > 0 || moreEnds.length > 0 || end < start) return '';
  return text.slice(start, end - 1);
}

/**
 * The problems of the file `name` of `changelog.d/` with the text `text`, in this order: a name that is not `<card id>.md` (and no
 * other problem), an id not in `cardIds`, a text that is not one line ended by one line feed, and a line that does not match
 * `^- <id>( \([^()\n]+\))?: \S`. The empty array for a well-formed fragment of a registered card.
 */
export function fragmentProblems(name: string, text: string, cardIds: ReadonlySet<string>): string[] {
  const id = name.endsWith('.md') ? name.slice(0, -'.md'.length) : '';
  if (!CARD_ID_REGEX.test(id)) return [`${name}: the file name is not <card id>.md`];
  const problems: string[] = [];
  if (!cardIds.has(id)) problems.push(`${name}: no card ${id} in specs/tasks or specs/archive/tasks`);
  const line = text.slice(0, -1);
  if (!text.endsWith('\n') || line.includes('\n') || text.includes('\r')) {
    problems.push(`${name}: the text is not one line ended by one line feed`);
  } else if (!new RegExp(String.raw`^- ${id}( \([^()\n]+\))?: \S`).test(line)) {
    problems.push(`${name}: the line does not start with "- ${id}: " or "- ${id} (<qualifier>): "`);
  }
  return problems;
}

/** The text of `<root>/changelog.d/<cardId>.md` without its final line feed. */
export function fragmentEntry(root: string, cardId: string): string {
  return readFileSync(path.join(root, 'changelog.d', `${cardId}.md`), 'utf8').replace(/\n$/, '');
}
