---
id: T0-INCIDENT-CI-RECIPE
title: docs/OPERATIONS.md, Incident -> intent, gives an opt-in recipe for running `aidlc monitor check --file-intent` on a schedule in a project's own CI, with what a fresh runner loses and how to keep it
status: merged
branch: T0-INCIDENT-CI-RECIPE
worktree: D:\wt\AIDLC\T0-INCIDENT-CI-RECIPE
allow_paths:
  - docs/OPERATIONS.md
  - changelog.d/T0-INCIDENT-CI-RECIPE.md
  - specs/tasks/T0-INCIDENT-CI-RECIPE.md
dod_command: npm run typecheck && node --test tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
acceptance:
  - 1. `docs/OPERATIONS.md`, `### Incident -> intent`, gains one subsection on scheduling the check in the project's own CI, stating that it is opt-in, that `aidlc init` installs no schedule, watcher or daemon, and that the filed intent enters the loop only by a person's `aidlc goal new`. (reviewer-verified against the diff) [dod arm 1]
  - 2. The subsection names how the job supplies `--data` (the samples file form already documented in the section) and that collecting the samples is the project's own step. (reviewer-verified against the diff)
  - 3. The subsection states that the command writes the intent file, `.aidlc/incidents/incidents.json` and the journal and publishes none of them, so a fresh runner that discards them loses the intent and the dedupe across runs; it names one way to keep each (the ledger kept between runs, the intent kept as an artifact or a pull request) and that two scheduled runs must not overlap. (reviewer-verified against the diff)
  - 4. The subsection states that the job needs no model credential and that reading the project's telemetry or keeping its outputs may need permissions the CI token does not have. (reviewer-verified against the diff)
  - 5. `changelog.d/T0-INCIDENT-CI-RECIPE.md` holds the entry under this card id followed by one line feed; `git diff --numstat origin/main...HEAD -- src templates .claude` is empty. [dod arm 1]
tdd: false
budget: 60
forbid: [any change under src/, templates/ or .claude/, a workflow file added to this repository]
non_goals: [a change to `aidlc init` or the templates, a scheduled job in this repository's own CI, a watcher or waker of any kind (intent/always-on-agent-study.md, outcomes 3 and 4), a change to the behaviour of `aidlc monitor check`]
hygiene: "Docs only. No test reads the Incident -> intent section (grep of tests/ for 'Incident -> intent' and 'file-intent' on 2026-11-23: tests/surface/incident.test.ts and tests/surface/cli-cwd-paths.test.ts exercise the command, not the document), so the text is reviewer-verified. The no-hidden-watcher contract in src/maintain/incident.ts stands: the recipe is explicit and installed by the project's owner."
doc_sync: changelog.d/T0-INCIDENT-CI-RECIPE.md
---

# T0-INCIDENT-CI-RECIPE

From `intent/always-on-agent-study.md`, outcome 5, accepted by the owner on 2026-11-23.

## Deliverable
A downstream project that already runs CI can schedule the deterministic control-band check without a model and without a background service, and knows what it must keep between runs so the filed intents and the dedupe survive.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: the prose, changelog-fragment and command-line checks pass on the changed documents; items 1 to 4 are judged by R3 against the diff.
