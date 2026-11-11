---
id: T0-GITLEAKS-LESSON-FP
title: The committed-history secret scan passes again - one verified false positive in a lesson line of main is listed by its fingerprint in .gitleaksignore, and a test pins that list and the allowlist
status: todo
branch: T0-GITLEAKS-LESSON-FP
worktree: D:\wt\AIDLC\T0-GITLEAKS-LESSON-FP
allow_paths:
  - .gitleaksignore
  - .gitleaks.toml
  - tests/surface/gitleaks-ignore.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-GITLEAKS-LESSON-FP.md
dod_command: npm run typecheck && node --test tests/surface/gitleaks-ignore.test.ts tests/surface/templates.test.ts tests/core/ci-policy.test.ts tests/core/config.test.ts
dod_exit: 0
requirements:
  - R1. A new file `.gitleaksignore` at the repository root shall hold exactly one finding, the line `7265d10642001a051fa36ac3f9c061a72a4540b3:docs/LESSONS.md:generic-api-key:153` (the fingerprint gitleaks 8.30.1 prints for it, in the form commit, file, rule id, start line), preceded by comment lines that begin with `#` and say what the text is and why it is listed. Every other line is blank or a comment. The file adds no path, rule, commit range or pattern.
  - R2. `.gitleaks.toml` shall keep its rules and its allowlist exactly (the `[extend]` table, the `[allowlist]` description, `paths` and `regexes`); only its header comment changes, where the words "Nothing else" become false once `.gitleaksignore` exists and are replaced by a sentence that names that file and its one entry.
  - R3. A new test shall pin both lists, so that a later entry or a wider allowlist fails the suite until the test is changed with it. It reads `.gitleaksignore` and `.gitleaks.toml` from the repository root and asserts that the lines of `.gitleaksignore` that are neither blank nor comments equal exactly the one fingerprint of R1, that each such line has the form of 40 lower-case hexadecimal digits, a colon, a repository path, a colon, a rule id, a colon and a line number, and that the parsed `.gitleaks.toml` has `extend.useDefault` true and an `allowlist` whose `paths` and `regexes` equal the two values main has.
  - R4. Nothing else changes. `.github/workflows/security-scanners.yml` and its template copy keep the scan command, which reads `.gitleaksignore` from the directory it runs in; docs/LESSONS.md is not edited (the finding is the line as committed at 7265d106; a reworded line would leave the commit in the history and the scan red); no source file changes.
  - R5. docs/OPERATIONS.md shall gain, directly after the paragraph that begins `The gitleaks history scan (`, one paragraph with this text. "A finding of the history scan that is verified not to be a secret and sits in history that cannot be rewritten is listed by its fingerprint in `.gitleaksignore`, one line per finding under a comment that says what the text is; `tests/surface/gitleaks-ignore.test.ts` pins that list and the allowlist of `.gitleaks.toml`, so an entry is added only together with a reviewed test change (card T0-GITLEAKS-LESSON-FP). The one entry is a lesson line of docs/LESSONS.md whose words `keys:` followed by a card id the `generic-api-key` rule reads as a key assignment. A closure commit reaches `main` by a direct push, outside the required checks, which is how that line was merged with the scan red: scan a closure commit with gitleaks before pushing it." CHANGELOG.md, Unreleased, shall gain one entry that names the card and states R1 to R3 and that from the close of T0-CLAUDE-EFFORT-OPT-IN (commit 7265d106) until this card the history scan was red on main and on every pull request.
acceptance:
  - 1. `tests/surface/gitleaks-ignore.test.ts` "the ignore list holds exactly the reviewed findings, each a fingerprint". The non-blank, non-comment lines of `.gitleaksignore` deep-equal the one fingerprint of R1 and each matches the fingerprint form. Fails on main (the file does not exist; the test reads a missing file as an empty list and the deep-equal fails by assertion). Rows on the line classifier, with no file involved, also pass - a comment line, a blank line, a line with a trailing carriage return, and a line of another form (a bare path, a rule id alone, an upper-case commit) which the form check refuses. [R1] [R3] [dod arm 1]
  - 2. Same file, "the allowlist of .gitleaks.toml is what it was". `extend.useDefault` is true, `allowlist.paths` deep-equals the one path pattern main has and `allowlist.regexes` the one canary pattern, read with the TOML the repository can already parse or, if it has no TOML parser, by exact lines of the file. Passes on main and with this card (a pin). [R2] [R3] [dod arm 1]
  - 3. The coordinator runs gitleaks 8.30.1 (the pinned version of the workflow, checksum verified) over the history of the candidate branch before the first review and records both counts in the Attempt evidence - with the candidate's `.gitleaksignore` 0 leaks, and with an empty ignore file 1 leak whose fingerprint is the entry of R1. [R1] [R4]
  - 4. tests/surface/templates.test.ts, tests/core/ci-policy.test.ts and tests/core/config.test.ts pass unchanged; the two workflow files and docs/LESSONS.md are not in the diff (reviewer-verified). [R4] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md hold the texts of R5 and the header comment of `.gitleaks.toml` names `.gitleaksignore` (reviewer-verified against the diff). [R2] [R5]
depends_on: []
budget: 140
tdd: true
diagnosis:
  root_cause: "The close of T0-CLAUDE-EFFORT-OPT-IN (commit 7265d106, 2026-11-11T23:20Z) appended a lesson to docs/LESSONS.md whose text holds the words `unknown keys:` followed by the card id. The default `generic-api-key` rule of gitleaks reads a keyword such as `key` followed by a separator and a token of enough entropy as a key assignment, so the history scan reports one leak at docs/LESSONS.md:153 of that commit. The text is prose and names no credential. A closure commit is pushed to main directly, with the repository admin bypass of the required checks (docs/OPERATIONS.md, `main required checks`), so the red scan did not stop it; from then on the scan of the committed history is red on main and on every pull request, and the ship of T0-OP-TIMESTAMP-NOW stopped with STOP risk on PR 285."
  repro: "gitleaks 8.30.1 in WSL, `gitleaks git --redact --no-banner --log-opts=origin/main .` at main 43a919f6 - 1 leak, fingerprint 7265d10642001a051fa36ac3f9c061a72a4540b3:docs/LESSONS.md:generic-api-key:153, match `keys:` and a redacted token. The Gitleaks check of PR 285 (run 43120762701) reports the same finding; the three runs of security-scanners.yml on main after 7265d106 are red."
  same_class: "Every text a closure commit writes to main without the required checks - the lesson line of docs/LESSONS.md and the status line of a card. Validating a lesson's text in `aidlc card close --lesson` is a card of its own; this card restores the gate and documents the local scan."
sweep: "git grep -n -i gitleaks -- .github templates docs tests src - the scan command at .github/workflows/security-scanners.yml:42 and its template copy (unchanged, R4); the comment at :40 of both names the allowlist of .gitleaks.toml and stays true; docs/OPERATIONS.md, the paragraph that begins `The gitleaks history scan (` (R5 adds a paragraph after it); tests/core/ci-policy.test.ts, tests/core/config.test.ts, tests/infra/github-ship.test.ts, tests/scenarios/ci-rerun.test.ts and tests/surface/templates.test.ts name gitleaks as a check name or read the workflow copy, none reads .gitleaks.toml or an ignore file. No .gitleaksignore exists on main."
forbid:
  - weakening or skipping a test to go green
  - any entry in .gitleaksignore other than the one fingerprint of R1, or any path, rule, commit range, regex or stopword added to .gitleaks.toml
  - a change to the scan command, to either workflow file or to docs/LESSONS.md
  - rewriting, amending or force-pushing history
  - printing or committing the redacted token as anything but the card id it is
  - editing .aidlc state by hand
non_goals:
  - validating the text of a lesson or of any closure write before it is committed (`aidlc card close --lesson`)
  - putting closure commits under the required checks
  - a second finding that exists only on a local branch without a pull request (tests/scenarios/t0-flow.test.ts at commit de7b91f7), which is not in main's history
hygiene: "Insert the CHANGELOG entry directly above the entry that begins `- T0-R3-SECOND-PASS-ROOM`, followed by a blank line. The test file starts no process and writes nothing. Before the first review the coordinator runs every test file that reads a document this card changes and records the counts in the Attempt evidence, and runs the scan of acceptance 3; the full suite runs in CI. The Gitleaks check of this card's own pull request reads the candidate's .gitleaksignore, so it is the first green run of the scan since 7265d106; nothing in the evidence depends on that run."
doc_sync: docs/OPERATIONS.md (the paragraph after the gitleaks history scan), CHANGELOG.md
---

# T0-GITLEAKS-LESSON-FP

## Deliverable
The committed-history secret scan is green again. The one finding in main's history, a lesson line that the generic key rule misreads, is listed by its exact fingerprint in `.gitleaksignore`; the scanner's rules and allowlist are unchanged, and a test pins both lists.

## Why
Since the close of T0-CLAUDE-EFFORT-OPT-IN on 2026-11-11 the Gitleaks check is red on main and on every pull request, so no card can ship (T0-OP-TIMESTAMP-NOW stopped on it). The flagged text is prose in docs/LESSONS.md, not a credential, and it is in pushed history of main, which is never rewritten. Gitleaks' own mechanism for a verified false positive is a fingerprint in `.gitleaksignore`: it names one commit, file, rule and line and loosens nothing else.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/gitleaks-ignore.test.ts tests/surface/templates.test.ts tests/core/ci-policy.test.ts tests/core/config.test.ts
```
- Expected exit code: 0
- Assertion: the ignore list and the allowlist are exactly the pinned values, and the other files pass unchanged.
