# 0001 TypeScript orchestrator with Markdown skills as its driver

- Status: Accepted
- Date: 2026-09-11
- Decider: project owner (request of 2026-09-10), implemented by the AIDLC session
- Related: docs/plans/PLAN-aidlc-loop.md (v5), docs/plans/REVIEW-claude-session-lifecycle.md

## Context

Plan v5 specified five Markdown skill files over the PowerShell scaffold and deliberately excluded a new engine, while requiring enforced shared-session ownership, review admission, durable deadlines and an honest audit boundary. The independent review (REVIEW-claude-session-lifecycle.md) found that prose alone cannot provide durable clocks, fencing, idempotent operation reconciliation or a verifiable evidence chain: "Markdown journals describe facts but do not implement atomic leases/fencing by themselves."

The owner then asked for the whole system to be refactored to TypeScript, with designs and text copied from the references where useful.

## Decision

1. Implement the loop as a TypeScript library and CLI (`aidlc`) that owns state, clocks, leases, admission queues, operation intents, evidence and audit; the five skill files remain, but as drivers that call the CLI and act on exactly one typed directive per call.
2. Keep the scaffold's contracts (card schema, verdict schema, ship chain and sentinels, merge token) as adapters rather than replacing them; add a native GitHub ship path and a dry-run path for qualification fixtures.
3. Persist all runtime facts under `<main checkout>/.aidlc/` (shared by every worktree, never committed); the accepted plan and cards stay the requirement authority.
4. Report audit level honestly (`none`, `recorded`, `traceable`, `independently-verified`) and treat "fully audited" as `BLOCKED/capability` until a host capture boundary is asserted and verified.

## Consequences

- Positive: deadlines, attempt counters, review allowances and ownership generations persist across compaction, restarts and window changes; two windows on one machine coordinate through atomic leases and a persisted review queue; every external mutation has a recorded intent and a reconciled result.
- Negative: a Node >= 22.18 runtime is now a dependency of the delivery loop; the scaffold and GitHub ship paths still need live qualification (plan Q3/Q4/Q23/Q24) before the loop is advertised as run-verified.
- Neutral: skill-file caps from plan v5 are kept and asserted by a test; the character budgets are ASCII bytes.

## Alternatives considered

- Markdown-only skills over the existing PowerShell scripts (plan v5 as written): rejected because the required controls (fencing, admission, reconciliation, audit verification) cannot be enforced by instructions.
- Adopting an external engine (AWS AI-DLC, specs.md FIRE, ai-sdlc): rejected for this release; their state, task and lifecycle models would compete with the scaffold's card authority (SDLC-CAPABILITY-REVIEW §8). Their proven patterns were borrowed instead (docs/references/README.md).
- Extending the PowerShell scripts in place: rejected because the owner asked for TypeScript and the coordination package (S) needs a testable, cross-platform runtime.
