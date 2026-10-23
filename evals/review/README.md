# evals/review/ (reviewer bench cases)

`aidlc review bench run --stage pre|formal` scores a stage's configured reviewer on the confirmed cases in this directory (docs/OPERATIONS.md, Reviewer bench). Each case is one JSON file named `<id>.json`, and `aidlc evals run` never reads it.

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

The `class` is `dim-<n>`, where `<n>` is the REVIEW.md dimension number the finding's reason cites.

The `base` is `git merge-base <base> <candidate>`, where `<base>` is the card run's `base.oid`, else its `base.ref`; read both, and the candidate, with `aidlc card status <card> --json`.

A hand-written case pins its candidate so that git never collects it: `git update-ref refs/aidlc/bench/<id> <candidate>`.

To confirm a case, check out the candidate (`git worktree add --detach <dir> <candidate>`), find the defect at the expected lines (for a clean case, check that the candidate has none), then set `confirmed` to true and `confirmedBy` to your name.
