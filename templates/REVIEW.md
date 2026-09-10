# Review instructions

Applies to every PR. The agent that wrote the code cannot approve it; a human
code owner approves through branch protection, informed by these findings.

## Passes
Run three passes and tag each finding with its pass:
- Bugs: logic errors, broken edge cases, subtle regressions.
- Security: injection, authentication/authorization gaps, PII in logs.
- Compliance: the change matches spec.md, plan.md, the card's acceptance list
  and our design principles.

## Two axes, never merged
- `spec`: does the diff do what the card closed? (dimensions 1, 6, 14)
- `standards`: is the code sound? (everything else)
A `spec` block on a Tier-S card stops the ship. `standards` findings are a
second opinion; they never become a silent merge bar.

## Must-block dimensions (any hit blocks)
1. Out of scope: touches paths outside `allow_paths` or beyond the card. [spec]
2. Hard boundaries: network, credentials, frozen contracts, `forbid:` items.
3. Frozen contract or schema changed in place.
4. License non-compliance in added dependencies.
5. Non-original code without attribution/license.
6. Tests missing or fake: no behavioral RED, weakened or deleted tests. [spec]

## Should-flag dimensions
7. Traceability: a line that cannot be traced to a card requirement.
8. Over-engineering / wrong altitude (remedy is removal, not more tests).
9. Error handling: swallowed errors, exit 0 on failure, empty as success.
10. Determinism: time, randomness, ordering, environment leakage.
11. Test organization and hygiene.
12. Structured logging / observability.
13. Data and persistence design; migration compatibility.
14. Scope fidelity / capability over-reach against `non_goals`. [spec]
15. API-version correctness (pinned versions, no invented flags).
16. De-AI-slop: dead abstractions, comment noise, duplicated helpers.
17. Bugfix root cause, not symptom (`diagnosis:` on bugfix cards).

## What Important means here
Reserve Important for findings that would break behavior, leak data or breach
a policy. Style and naming are nits.

## Cap the nits
Report at most five nits per review; summarize the rest as a count.

## Do not report
Generated files (`**/gen/**`, `**/*.generated.*`, lockfiles) and anything CI
already enforces (formatting, lint rules with a gate).

## Output contract
Last line, one JSON document:
`{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}`
Block reasons are formatted `[spec] <dimension #/name> @ <file:location>: <why it violates> -> <how to fix>`.
Timeouts, missing or malformed output are `run_status` failures handled by the
harness: fail-closed, never a pass, never a judgement about the diff.
