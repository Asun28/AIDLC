# changelog.d

A card records its behaviour change here, in its own new file
`changelog.d/<card id>.md`, and leaves `CHANGELOG.md` as it is.

## Form

The file name is `<id>.md`, where `<id>` matches `CARD_ID_REGEX`
(`src/core/types.ts`) and is the id of a card in `specs/tasks/` or
`specs/archive/tasks/`. The text is one line followed by one line feed,
with no other line feed and no carriage return:

- `- <id>: <text>`, or
- `- <id> (<qualifier>): <text>`, with no parenthesis inside the qualifier.

The line matches `^- <id>( \([^()\n]+\))?: \S`.

## Checks

`tests/surface/changelog-fragments.test.ts` refuses any other file in
`changelog.d/` except this README. A card's own test reads its line with
`fragmentEntry(root, '<id>')` from `tests/infra/changelog.ts`.

## Unreleased changes

The changes not yet released are the Unreleased section of
`CHANGELOG.md` and the files in `changelog.d/`.
