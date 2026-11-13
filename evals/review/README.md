# evals/review/ (reviewer bench cases)

`aidlc review bench run --stage pre|formal` scores a stage's configured reviewer on the confirmed cases in this directory (docs/OPERATIONS.md, Reviewer bench). Each case is one JSON file named `<id>.json`, and `aidlc evals run` never reads it. Every case file of the directory is loaded and checked on each run, `--case` included, so one file that does not load refuses the run.

`--trials <n>` reviews every selected case n times and adds the median and range of recall and of the false-block rate; `aidlc review bench compare <before.json> <after.json>` says whether a change to the review made the scores `better`, `worse`, `no-measurable-difference` or `inconclusive` (docs/OPERATIONS.md, Reviewer bench).

Fields (`ReviewBenchCase` in `src/core/types.ts`; an unknown key is refused):
- `kind`: `bug` (the candidate has a defect at the expected sites) or `clean` (the candidate is correct and a review should pass it).
- `id`: the file name without `.json`; letters, digits, dot, underscore and dash.
- `candidate`: the reviewed commit, 40 lowercase hex characters.
- `base`: the commit the candidate's diff starts from, 40 lowercase hex characters.
- `card`: `id`, the card id, and `path`, the card file's repository path at the candidate commit.
- `confirmed`: true once a person has checked the case; only confirmed cases are scored by default.
- `confirmedBy`: who confirmed the case, required when `confirmed` is true.
- `origin`: where the case came from (a card run and finding id, an incident, a hand-written defect).
- `note`: optional free text.
- `expected` (bug cases only): one or more sites, each a repository `file`, a positive `line`, a `window` of 0 to 50 lines on either side of it, and a `class`.

The `class` is any lowercase kebab-case name (lowercase letters and digits joined by single dashes); by convention it is `dim-<n>`, where `<n>` is the REVIEW.md dimension number the finding's reason cites.

The `base` is `git merge-base <base> <candidate>`, where `<base>` is the card run's `base.oid`, else its `base.ref`; read both, and the candidate, with `aidlc card status <card> --json`.

A hand-written case pins its candidate so that git never collects it: `git update-ref refs/aidlc/bench/<id> <candidate>`.

To confirm a case, check out the candidate (`git worktree add --detach <dir> <candidate>`), find the defect at the expected lines (for a clean case, check that the candidate has none), then set `confirmed` to true and `confirmedBy` to your name.

## Drafting cases with the export

`aidlc review bench export --card <id>` drafts one unconfirmed bug case per R3 finding of that card's runs, and `aidlc review bench export --clean` drafts one unconfirmed clean case per card run whose first R3 decision passed (docs/OPERATIONS.md, Reviewer bench). The export fills in every field above, sets `confirmed` to false and pins each candidate with a ref under `refs/aidlc/bench/`, so a drafted case needs no pin command.

A draft comes from the finding's reason alone, so check it as you would a hand-written case: find the defect at the expected lines and narrow the `window` to it. Running the export again after a card gains findings is safe, since a case that exists keeps its bytes.

`.gitignore` lists `/evals/review/*.json`, so plain `git status` leaves out a case file that is not tracked and `git add` adds it only with `-f`: commit a confirmed case with `git add -f evals/review/<id>.json`. A case file that is tracked stays tracked, and `git status` shows a change to it as before.
