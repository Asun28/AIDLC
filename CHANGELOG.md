# Changelog

## Unreleased

Loop latency (card T0-LOOP-SPEED). Measured on Windows 11, Node 22.23, before -> after:

- Claude Code hooks: one process per event instead of three `npx` starts per tool call. `src/hooks/entry.ts` (`dispatchHook`, `hookNamesFor`) runs every guard that applies to the event; `bin/aidlc-hook.js` loads only the hook modules; `aidlc hook auto` is the CLI form. Per Bash/Edit call: ~4.5 s -> ~0.2 s (direct entry) or ~1.4 s (npx fallback). `aidlc init` wires the fastest entry it can see and replaces 0.1.0 per-guard hooks on re-run.
- Repository identity: `resolveRepoIdentity` is memoised per process and asks git once (`rev-parse --git-common-dir --show-toplevel`) instead of six spawns per CLI call. `aidlc goal list` ~0.8 s -> ~0.3 s; `aidlc next` ~0.4 s.
- `aidlc doctor`: toolchain probes run concurrently (`pwsh -v`). ~1.2 s -> ~0.5 s.
- `npm run typecheck`: one `tsc` pass over src + tests. ~6.7 s -> ~4.0 s. Full suite (414 tests) ~6.9 s -> ~4.1 s.
- New bin `aidlc-hook`; `runHook` accepts a preloaded config.

## 0.1.0 - 2026-09-11

First implementation of the v5 aidlc-loop plan as a TypeScript library and CLI.

- Core engines: request router (T0-bugfix/T0/T1/T2, targets, modules, data impact), admission deadlines (3 h card, 12 h arc, 5 min grace, explicit extensions), effort episodes (three baseline attempts plus one justified escalation, same-cause early stop), review policy (scaffold verdict parsing, two substantive decisions, one no-verdict retry, quota holds), CI policy (classification, one persisted transient rerun), health evaluation (PASS/BREACH/INSUFFICIENT_DATA), authorization binding, arc selection (cap two, resource isolation, freeze cards, contraction ordering), goal/card/release state machines, migration impact and phase graph, amendments, role profiles.
- State: canonical `.aidlc/` under the main checkout, atomic JSON store with interrupted-write recovery, hash-chained journal, goal/card/release store, board view.
- Coordination: leases with generations and fencing, takeover after reconciliation, shared review admission queue, operation ledger with explicit UNKNOWN.
- Delivery: git and gh probes with receipts, worktree start-or-attach, scaffold `task.ps1` ship adapter with sentinel classification, native GitHub ship path (git/gh chain emitting the same sentinels), dry-run ship path, provider operation bindings (`aidlc.ops.json`).
- Session identity: `AIDLC_SESSION` > `CLAUDE_SESSION_ID` > a per-repository default token (`.aidlc/session-default`, interim single-controller mode reported by `doctor`).
- Artifacts: front matter, task cards (parse, validate, tier, render), intent.md, spec.md with EARS classification, plan.md with definition-of-ready gates.
- Providers: Anthropic SDK (adaptive thinking, effort, quota/refusal outcomes), Claude Code CLI, mock.
- Maintain: Western Electric control bands from `bands.yaml`, deduplicated incident ledger that files intents.
- Evals runner with a pass-rate gate; evidence manifest with sealing and an independent audit verifier.
- Claude Code hooks: production-gate, protect-paths, secrets-guard, protect-tests, verify-before-done, route-new-work.
- Loop: typed directives, goal controller (`next`/`report`), card runner, release runner.
- `aidlc init` templates: five aidlc-loop skill files under their byte caps, secure-api-review skill, six agents, settings.json, REVIEW.md, bands.yaml, artifact templates, evals example, CI workflows, delivery-ops contract.
- Tests: 413 node:test cases across core, infra and surface suites.
