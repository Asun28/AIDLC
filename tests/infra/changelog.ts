// Card T0-RELEASE-0-2-0: the part of CHANGELOG.md a test reads for its entry, from the Unreleased heading down to the 0.1.0 heading.

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
