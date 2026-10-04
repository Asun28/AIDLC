# Run driver core

## Design

Under the user's 2026-10-05 delegation of all decisions and authorization for multiple PRs, split the independent run loop from T1-RUN-DRIVER. Telemetry and init surface remain owned by their existing sessions. Start from remote main containing T1-RUN-CONTEXT-PACK-2.

Add a thin async driver in src/loop/run-driver.ts and wire `aidlc run --goal <id> --max-steps <n>` in src/cli/main.ts. The controller selects work and owns state. The command-capable provider executes exactly one directive through existing CLI operations. The driver never parses model prose into a report, approves a gate, or merges. Human directives, persisted review blocks and quota holds return to the caller. Ordinary waits poll with bounded delays. The driver limits each invocation to the goal/card deadline and counts both dispatch and wait steps. A changed generation ends the invocation.

The production CLI supports the existing Claude Code provider. Text-only providers cannot execute project commands and are refused, rather than silently simulating progress. Tests inject a scripted provider and a fixed clock, exercise real controller/state boundaries and compare writes with the same commands without the driver. The provider prompt carries explicit identity and a single directive, treats context as data, and forbids continuing past review/human gates.

The original watch view still needs telemetry's Bounds line and a read-only next-directive projection; it stays on T1-RUN-DRIVER. A watch-only split was rejected because it depends on APIs owned by the active telemetry session. Running the whole parent now was rejected because its prerequisite has not merged.

## Budget decision

The prior plan's latest shared source envelope was +1100, and the merged context pack costs +140. The obsolete +158 W5 figure cannot fit the remaining runtime safely. Under delegated authority, reserve up to +260 net source lines for this independent driver and expand the shared W2/W4/W5 envelope to +1360. Record the actual delta at close. No test, review, deadline, authorization or ownership gate changes. The parent must measure the combined actual total before integrated closure; this split does not claim the parent complete.

## Verification

Behavioral RED before implementation, targeted scenarios, full npm run check, npm run build, R2 and R3, required CI, verified feature merge and retained closure evidence. No production or package release.
