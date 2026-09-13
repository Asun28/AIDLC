---
name: diagnose
description: >-
  Diagnosis loop for a routed T0-bugfix card, a card `diagnosis:` field,
  or a DoD/CI failure with no known cause: a red-capable feedback loop
  first, then ranked hypotheses. Use after `aidlc goal new` or `aidlc ci
  classify` has routed the failure; intake stays with aidlc-loop.
---
# diagnose: from failure to named root cause

Delta to `aidlc-loop`: routing, attempt counting and the card fields stay
there. This file owns the method between "failure reported" and
`diagnosis.root_cause`. Redact first: every secret in a command, output
or artifact you show becomes `<REDACTED>`; credentials stay in the
environment.

## 1. Feedback loop (the gate)
One command that goes red on this bug. Build it before reading code for
a theory; a theory without a loop is the failure this skill prevents.
Options, in order: a failing test at the seam that reaches the bug; a
CLI or HTTP call with a fixture, diffed against a known-good output; a
replayed captured input; a throwaway harness around one call; the
trigger looped 100x for a flake; `git bisect run` between two known
states; old versus new output diffed for a regression.
Tighten it: faster (skip unrelated setup), sharper (assert the user's
exact symptom, not "no crash"), deterministic (pin time, seed
randomness, isolate the filesystem; for a flake, a high reproduction
rate).
Done when the command has run once, its output is shown, and it is
red-capable, deterministic, fast and agent-runnable. In this loop it is
the card's RED: `aidlc card attempt <id> --red-receipt "<sha>:<test>"`.
The investigator names the command; the implementer runs it.
No loop: stop, list what was tried, ask for an environment, a redacted
artifact (log, HAR, trace) or permission for temporary instrumentation.

## 2. Reproduce and minimise
The loop must show the reported symptom, not a neighbouring failure.
Then cut inputs, config and steps one at a time, re-running after each
cut, until every remaining element is load-bearing.

## 3. Hypotheses
Write 3-5 ranked, falsifiable hypotheses before probing: "if X is the
cause, changing Y removes the symptom / Z worsens it". No prediction,
no hypothesis. Show the list before probing; proceed with your ranking
if nobody answers.

## 4. Probe
One probe per prediction, one variable at a time. Debugger or REPL
first, then targeted logs at the boundaries that separate hypotheses;
never log everything. Tag every debug line `[DEBUG-<4 hex>]` so cleanup
is one grep. Performance: measure a baseline, then bisect.

## 5. Fix with a regression test
The regression test comes before the fix, at a correct seam: one that
exercises the real bug pattern at its call site. No correct seam is
itself the finding: record it on the card. Fail, fix, pass, then rerun
the phase 1 loop on the original scenario. Check sibling call sites for
the same class (`diagnosis.same_class`).

## 6. Close
Original repro green; regression test in the diff or the seam gap
recorded; `grep DEBUG-` empty; harnesses deleted; `diagnosis.root_cause`
states the confirmed hypothesis (why it broke, not how it showed); the
commit message names it.

Adapted from mattpocock/skills (MIT, (c) 2026 Matt Pocock); notice in
docs/THIRD-PARTY-NOTICES.md.
