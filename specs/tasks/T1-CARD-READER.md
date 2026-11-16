---
id: T1-CARD-READER
title: src/review/card-reader.ts holds the card reader's prompt, its result schema in zod and in JSON Schema, and one run of a reader argv through an injected runner that returns the items of a card the checkout does not support, or the reason there is no result
status: todo
branch: T1-CARD-READER
worktree: D:\wt\AIDLC\T1-CARD-READER
plan_ref: plans/card-preflight.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/review/card-reader.ts
  - tests/surface/card-reader.test.ts
  - docs/ARCHITECTURE.md
  - specs/tasks/T1-CARD-READER.md
dod_command: npm run typecheck && node --test tests/surface/card-reader.test.ts tests/surface/module-map.test.ts
dod_exit: 0
requirements:
  - R1. `src/review/card-reader.ts` (new) shall export the zod schema `CardReaderResult` for `{ unsupported: [{ item, sentence, file, line, why }] }`, where `item` matches `^(R[1-9][0-9]*|acceptance [1-9][0-9]*|body)$`, `sentence` and `why` are non-empty strings, `file` is a string that may be empty, `line` is an integer of 0 or more, and a key outside these at either level fails the parse; and the constant `CARD_READER_SCHEMA`, a JSON Schema of the same document that uses only `type`, `properties`, `items`, `required` and `additionalProperties`, the keywords of `VERDICT_SCHEMA` without `enum` (src/review/pre-review.ts:315-332), with every property required and `additionalProperties: false` at both levels, `line` of type `integer` and the four other fields of type `string`.
  - R2. The module shall export `buildCardReaderPrompt(cardId, cardText)`, which returns the lines of body section Prompt joined by line feeds, with the card id in the first line and `cardText` unchanged as the last part.
  - R3. The module shall export `runCardReader(o)`, with `o` of `{ runner, command, timeoutMs, cwd, cardId, cardText, schemaDir }` and `runner` a `Runner` (src/probes/exec.ts:47), which returns a promise of `{ ok: true, result }` with `result` a parsed `CardReaderResult`, or of `{ ok: false, reason, detail }` with `reason` one of `not-configured`, `exit`, `timeout`, `no-json` and `schema`, by the steps of body section Run, and which never throws for a failure of the reader command.
  - R4. docs/ARCHITECTURE.md shall name the new file in its Module map section, in the one-line paragraph of body section Module map paragraph, placed directly after the paragraph that begins with `src/review/bench.ts` in a code span (docs/ARCHITECTURE.md:32), with one blank line before and after it and no other line of the document changed.
acceptance:
  - 1. `tests/surface/card-reader.test.ts` (new), test "T1-CARD-READER acceptance 1: the prompt names the card, asks for the two kinds, states the result line and ends with the card text, and its hash is pinned". For `buildCardReaderPrompt('T1-X', 'CARD\nTEXT')`: the first line holds `task card T1-X`; two lines start with `(a) ` and `(b) `; one line is the result line of body section Prompt; the text ends with a line `## Card` followed by `CARD` and `TEXT`; and the sha256 of the text equals a literal in the test, which the worker computes once from the text of body section Prompt and records in the Attempt evidence. That the text is the one of body section Prompt, character for character, is reviewer-verified against the diff. Fails on main (no module). [R2] [dod arm 1]
  - 2. Same file, test "T1-CARD-READER acceptance 2: CardReaderResult accepts the three item forms and an empty list and refuses each malformed document, and the JSON Schema requires every field and allows no other". Accepted: items `R1`, `acceptance 12` and `body`, a `file` of `''` with `line` 0, and `{ unsupported: [] }`. Refused, one row each: items `R0`, `r1`, `acceptance 0`, `Acceptance 1`, and `body` with a trailing blank; an empty `sentence`; a missing `why`; `line` of -1, of 1.5 and of `'3'`; a sixth key in an entry; a second key beside `unsupported`; `unsupported` that is not an array. `CARD_READER_SCHEMA` has `required` of `['unsupported']` and `additionalProperties` false at the top, and for an entry `required` of the five field names, `additionalProperties` false, `line` of type `integer` and the four others of type `string`. Fails on main. [R1] [dod arm 1]
  - 3. Same file, test "T1-CARD-READER acceptance 3: runCardReader writes the schema file, expands the argv, sends the prompt on stdin and returns the parsed result of the last non-blank line". The cases of body section Run cases, rows 1 to 4, with a recording runner that starts no process. Fails on main. [R3] [dod arm 1]
  - 4. Same file, test "T1-CARD-READER acceptance 4: an empty command, a runner that throws, a non-zero exit, a missing exit code, a timeout, a last line that is not JSON and a document that fails the schema each return their reason". The cases of body section Run cases, rows 5 to 12: each returns `ok: false` with the stated `reason` and a `detail` that holds the stated text, and for the empty command the runner was not called and the schema directory was not created. Fails on main. [R3] [dod arm 1]
  - 5. `tests/surface/module-map.test.ts` passes with no line changed; its first test lists every `.ts` file under `src/` and fails for `src/review/card-reader.ts` until docs/ARCHITECTURE.md names it in a code span. The wording of the paragraph is that of body section Module map paragraph (reviewer-verified against the diff). [R4] [dod arm 1]
depends_on: []
budget: 200
tdd: true
freeze: true
sweep: "Main at 35de54fe. Reviewer run: `runReviewPanel` (src/review/pre-review.ts:1296) is the only function that runs `preReview.command` or `formalReview.command` (its callers: src/loop/card-runner.ts:2147 and :2739, src/review/bench.ts:304 and :310; `git grep -n expandCommand -- src` finds no caller outside pre-review.ts); its inner `runAngle` (:1300-1318) expands the argv with `expandCommand` (:347-351), calls the injected runner with `{ cwd, env: reviewerEnv(), input, timeoutMs, shell }` (:1310) and hands the receipt to `finalizeReview` (:1033), which reads only the frozen verdict document through `readVerdict` (:491) and `parseVerdictDocument`; `runAngle` is not exported, the JSON scan `topLevelDocuments` (:612) is not exported, and `materialiseVerdictSchema` (:335) writes `VERDICT_SCHEMA` only. So no exported function runs an argv and returns a document of another shape: this card reuses `expandCommand` and `reviewerEnv` (:1083) and repeats the runner call of :1310. `expandCommand` leaves an unknown placeholder as it is (:345), so `{effort}` must be given a value. `git grep -n 'card-reader\\|cardReader\\|CardReaderResult' -- src tests bench docs templates .claude README.md CHANGELOG.md`: no hit. Module map: tests/surface/module-map.test.ts:55-59 fails for any `src/**/*.ts` that docs/ARCHITECTURE.md does not name. docs/ARCHITECTURE.md is read by 34 test files (`git grep -l ARCHITECTURE.md -- tests`); the ones found to pin a position pin a sentence inside an existing paragraph (tests/scenarios/op-intent-dup.test.ts:353, tests/infra/stray-processes.test.ts:661) or the order of two names (tests/surface/mutants.test.ts:1055), and a new paragraph on its own line changes neither. The R3 run of 2026-11-15 (state evidence of T0-R3-POOL-WAIT-2, read on 2026-11-16) shows Codex with `--output-schema` printing the document as one stdout line, which is why the result is read from the last non-blank line. tests/surface/module-map.test.ts took 10 s on 2026-11-16 at 39dc7121. Budget estimate: the module about 90 lines (the prompt is 16 of them), the test about 90, the document 2."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test file
  - a new CLI command or option in this card; T1-CARD-READER-CLI adds the one option
  - a gate, a card state, a stop, a review rule or a ship rule that reads the reader's result; the reader gates nothing in this goal
  - a model call, a network call or a started process in the tests of this card
  - a change to src/review/pre-review.ts, src/review/bench.ts, src/cli/main.ts, src/config.ts or either aidlc.config.json
  - an import of `src/loop/`, `src/state/` or `src/coordination/` in src/review/card-reader.ts
  - a reader command run through a shell string; the command is the argv array of the configuration
  - in the test file `Date.now()`, a temporary directory that does not come from `tmpDir` of tests/infra/helpers.ts, or a process left running
non_goals:
  - the `--reader` option, the configuration key `cardReader`, docs/OPERATIONS.md and CHANGELOG.md; T1-CARD-READER-CLI adds the key with the option that reads it and records both
  - a fallback reader, an effort policy, a `shell` key or an answer marker for the reader; `{effort}` expands to the fixed level `medium`, and the run uses a shell only as body section Run states
  - a result spread over several lines or followed by other output; only the last non-blank stdout line is read, and anything else returns `no-json`
  - a retry; one call of the runner per `runCardReader` call, and a quota or billing message of the reader returns `exit` like any other non-zero exit
  - a check that `file` exists or that `sentence` stands in the card; the result is returned as the reader gave it once it passes the schema
  - retention of the reader's output; nothing is written but the schema file, and only when the argv carries the schema placeholder
  - whether Codex accepts `CARD_READER_SCHEMA`; no test of this card calls a model, and the first real run is the arc proof of plans/card-preflight.md
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE (main has since changed src/review/pre-review.ts, src/review/bench.ts and src/cli/main.ts in card T1-BENCH-ORDER-PRE). Tests first. Before the first review run `npm test` once and record the counts: 34 test files read docs/ARCHITECTURE.md, more than the DoD names. Revert rows, each a scratch change restored afterwards: one character of the prompt changed (acceptance 1 red); the entry object made to allow unknown keys (2 red); the whole stdout parsed in place of the last non-blank line (3 red); the schema file written for an argv without the placeholder (3 red); `timedOut` read after the exit code (4 red); the paragraph removed from docs/ARCHITECTURE.md (5 red)."
---

# T1-CARD-READER

## Deliverable
The reader's contract in one module: the prompt, the result schema in zod and in JSON Schema, and one function that runs a reader argv once through an injected runner and returns its result or the reason it has none.

## Why
docs/LESSONS.md records that a second reader of a draft card found blocking points before any code was written (T0-BANDS-RULES-REFUSE, T0-AUDIT-DOC-TRUTH, T0-RELEASE-0-2-0). That check is done by hand. Spec specs/card-preflight.md R3 to R5 make it a command whose result code can read, so that T1-CARD-READER-REPORT can measure it before anything gates on it.

This is the freeze card of the goal: T1-CARD-READER-CLI calls `runCardReader` and prints its result, and T1-CARD-READER-REPORT validates stored results with `CardReaderResult`, so the shape and the five reasons are fixed here. The configuration key `cardReader` and the `--reader` option are in T1-CARD-READER-CLI: with them this card would pass the budget of 200.

Difference from the plan, read in the code: the plan says the reader reuses the reviewer-command runner of src/review/pre-review.ts. That runner (`runReviewPanel`) returns only a review verdict, so the reader reuses its two exported parts and makes the one runner call itself (sweep).

## Prompt
The lines below, joined by line feeds. Only two parts are filled in: `<id>` in the first line is the card id, and the last line `<card text>` is the text given, unchanged. Every other character is literal, the angle brackets of `R<n>`, `acceptance <n>`, `<copied from the card>`, `<path>` and `<one sentence>` included.

```text
You are reading task card <id> before any code for it is written. The working directory is a checkout of the repository at the commit the card was written against. Read files only: change nothing and run nothing that writes.

Report two kinds of problem and nothing else:
(a) a sentence of the card that states a fact about code, tests or documents that already exist, where the checkout does not support the fact: the file, function, line, text or behaviour it names is absent or different;
(b) a requirement or an acceptance item that the checkout does not support as written: it needs a change to a file that no allow_paths entry covers, it names a test or a command that cannot run in this checkout, or a test outside the card's dod_command pins text or behaviour that the item changes.

Do not report style, wording, missing detail or design preferences, and do not report a file, function or test that the card says its own change creates.

For each problem give five fields. item: where the sentence stands, written R<n> for requirement n, acceptance <n> for acceptance item n, or body for any other part of the card. sentence: the sentence, copied from the card. file: the repository-relative path you read, or the path the card names when that file does not exist. line: the line you read, or 0 when the file does not exist. why: one sentence that says what the checkout holds instead.

Reason as much as you need, then output exactly one JSON document as the LAST line of your answer, nothing after it:
{"unsupported":[{"item":"R<n>|acceptance <n>|body","sentence":"<copied from the card>","file":"<path>","line":0,"why":"<one sentence>"}]}
An empty list means the checkout supports the card as written.

## Card
<card text>
```

## Run
`runCardReader(o)` does these steps in order and stops at the first that returns.

1. `o.command` is empty: return `not-configured` with the detail `the reader command is empty`. The runner is not called and nothing is written.
2. When an argument of `o.command` contains the schema placeholder (`{schema}`): create `o.schemaDir` and write `card-reader.schema.json` in it, `JSON.stringify(CARD_READER_SCHEMA, null, 2)` and one line feed.
3. Expand the argv with `expandCommand(o.command, vars)` (src/review/pre-review.ts:347), `vars` being `schema` (the path of that file; the key is absent when no file was written), `cwd` (`o.cwd`), `card` (`o.cardId`), `effort` (`medium`) and `instructions` (the prompt of R4).
4. Call `o.runner(argv[0], rest, { cwd: o.cwd, env: reviewerEnv(), input, timeoutMs: o.timeoutMs, shell })` once, with `reviewerEnv` of pre-review.ts:1083. When the argv carried the `{instructions}` placeholder, `input` is the empty string and `shell` is false; otherwise `input` is the prompt and `shell` is true on win32 and false elsewhere. This is the call of pre-review.ts:1310 without a `shell` setting.
5. The runner throws: return `exit` with the detail `spawn error: ` and the error's message.
6. The receipt has `timedOut` true: return `timeout` with the detail `no result within <timeoutMs> ms`.
7. The receipt's `exitCode` is not 0: return `exit` with the detail `exit <code>`, or `no exit code` when it is null.
8. Take the last line of the receipt's stdout that is not blank, trimmed. No such line, or `JSON.parse` of it throws: return `no-json` with the detail `the last stdout line is not JSON`.
9. `CardReaderResult.safeParse` of the parsed value fails: return `schema` with the detail of the first issue, its path joined by dots, a colon, a space and its message.
10. Return `{ ok: true, result }`.

## Run cases
The runner of the test records its calls and returns a receipt built in the test; `schemaDir` is a path inside a directory from `tmpDir` that does not exist before the call. `PROMPT` is `buildCardReaderPrompt('T1-X', 'CARD')`.

| Row | Command and receipt | Expected |
|---|---|---|
| 1 | `['reader', '--schema', '{schema}', 'e={effort}', '{card}', '{cwd}']`; exit 0; stdout of a line `thinking`, a line with a valid document of two entries, and two blank lines | `ok: true`, the two entries; one runner call with the arguments `--schema`, the path of the schema file, `e=medium`, `T1-X` and the cwd; options deep-equal `{ cwd, env: reviewerEnv(), input: PROMPT, timeoutMs, shell: process.platform === 'win32' }`; the schema file parses to `CARD_READER_SCHEMA` |
| 2 | `['reader']`; exit 0; stdout of one line `{"unsupported":[]}` | `ok: true`, an empty list; the schema directory does not exist after the call |
| 3 | `['reader', '{instructions}']`; exit 0; a valid document | the second argument equals `PROMPT`; `input` is `''`; `shell` is false |
| 4 | `['reader', '{unknown}']`; exit 0; a valid document | the argument stays `{unknown}` |
| 5 | `[]` | `not-configured`; no runner call; no schema directory |
| 6 | `['reader']`; the runner throws `Error('ENOENT reader')` | `exit`, detail holds `spawn error: ENOENT reader` |
| 7 | `['reader']`; exit 3; stdout holds a valid document | `exit`, detail `exit 3` |
| 8 | `['reader']`; `exitCode` null, `timedOut` false | `exit`, detail `no exit code` |
| 9 | `['reader']`; `timedOut` true, `exitCode` 1, stdout holds a valid document; `timeoutMs` 7 | `timeout`, detail `no result within 7 ms` |
| 10 | `['reader']`; exit 0; stdout empty, then stdout of blank lines only, then stdout whose last non-blank line is `done.` after a line with a valid document | `no-json` each time |
| 11 | `['reader']`; exit 0; last line `{"unsupported":[{"item":"R0","sentence":"s","file":"f","line":1,"why":"w"}]}` | `schema`, detail starts with `unsupported.0.item: ` |
| 12 | `['reader']`; exit 0; last line `[]`, then last line `{"verdict":"pass"}` | `schema` each time |

## Module map paragraph
One line, added to docs/ARCHITECTURE.md as R6 states:

`src/review/card-reader.ts` is the card reader (card T1-CARD-READER): the prompt that asks a read-only reviewer command which sentences of a card about existing code, and which requirements and acceptance items, the checkout does not support; the result schema `{ unsupported: [{ item, sentence, file, line, why }] }`; and `runCardReader`, which expands a reader argv with `expandCommand` of `src/review/pre-review.ts`, runs it once through the injected runner and reads the result from the last non-blank line of stdout. It decides nothing, and it writes one file, the JSON Schema, only when the argv names it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/card-reader.test.ts tests/surface/module-map.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes, and tests/surface/module-map.test.ts passes with no line changed.
