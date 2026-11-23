---
id: T0-LIMIT-RESET-IANA-NAMES
title: "The reset zone of a CLI limit message is read only when its full name is a tzdata 2026a zone or link name, so `US/Pacific-New` and `Canada/East-Saskatchewan`, which ICU still accepts and IANA removed, read no delay (issue 398)"
status: todo
branch: T0-LIMIT-RESET-IANA-NAMES
worktree: D:\wt\AIDLC\T0-LIMIT-RESET-IANA-NAMES
allow_paths:
  - src/core/iana-zones.ts
  - src/core/limit-reset.ts
  - tests/core/iana-zones.test.ts
  - tests/core/limit-reset.test.ts
  - tests/surface/pre-review-limit-reset.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-LIMIT-RESET-IANA-NAMES.md
  - specs/tasks/T0-LIMIT-RESET-IANA-NAMES.md
dod_command: npm run typecheck && node --test tests/core/iana-zones.test.ts tests/core/limit-reset.test.ts tests/surface/pre-review-limit-reset.test.ts tests/core/parse-guard.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. A new pure module src/core/iana-zones.ts shall export `IANA_ZONE_NAMES: ReadonlySet<string>`, the names of tzdata release 2026a that a `Zone` line (field 2) or a `Link` line (field 3) defines in the files africa, antarctica, asia, australasia, europe, northamerica, southamerica, etcetera and backward, each once, in tzdata's letter case: 597 names. Its header comment names the release, the nine files and the two line kinds. It does no I/O and imports nothing.
  - R2. `limitResetMs` (src/core/limit-reset.ts) shall read a delay only when the zone in the phrase, compared without letter case, is a name of `IANA_ZONE_NAMES`, and Intl accepts it as before. `IANA_AREAS`, `IANA_BARE` and the area rule are removed. Every other rule of the function (the phrase, the time range, the strict-after instant, the gap and fold rules) stays as on main.
  - R3. docs/OPERATIONS.md, in the sentence of the quota paragraph that defines `<zone>`, shall say that the zone is an IANA zone or link name of tzdata 2026a, and name `US/Pacific-New` as a name IANA removed that reads no delay, beside the existing `+05:00` and `PST` examples, with issue 398. docs/ARCHITECTURE.md, Module map, names src/core/iana-zones.ts.
acceptance:
  - "1. tests/core/limit-reset.test.ts: `resets 1pm (US/Pacific-New)`, `resets 1pm (us/pacific-new)`, `resets 1pm (Canada/East-Saskatchewan)` and `resets 1pm (CANADA/EAST-SASKATCHEWAN)` at 2026-11-20T00:00:00.000Z return `undefined`. RED on main at fcc91cd8, where each returns a delay (21 h for the first two, 19 h for the others). [R2]"
  - "2. tests/core/limit-reset.test.ts: at the same instant `resets 1pm (<zone>)` returns a delay for the links `America/Godthab`, `Antarctica/South_Pole`, `Asia/Calcutta`, `ROC` and `Etc/GMT+12`, and for the zones `Europe/Kyiv` and `America/Ciudad_Juarez`; every existing test of the file passes with no line changed, among them the ICU-only aliases (`ACT`, `PST`, `SystemV/AST4`) and `Pacific/Nowhere` that read no delay and the IANA names that do. [R2]"
  - "3. tests/core/iana-zones.test.ts: `IANA_ZONE_NAMES` has 597 names; no two differ only in letter case; it holds `Pacific/Auckland`, `US/Pacific`, `America/Argentina/Buenos_Aires`, `EST5EDT`, `UTC`, `Etc/GMT-5`, `W-SU` and `NZ-CHAT`; it does not hold `US/Pacific-New`, `Canada/East-Saskatchewan`, `Factory`, `SystemV/AST4` or `PST`; and Intl accepts every name of it as a `timeZone`. RED on main, where the module does not exist. [R1]"
  - "4. tests/surface/pre-review-limit-reset.test.ts: docs/OPERATIONS.md holds `US/Pacific-New`, `2026a` and `issue 398` in the paragraph that names `resets <time> (<zone>)`, none of the three being on main in docs/OPERATIONS.md; docs/ARCHITECTURE.md names `iana-zones.ts`. The existing tests of the file pass with no line changed. [R3]"
  - "5. The list in src/core/iana-zones.ts equals the R1 extraction run on the nine files of tzdata 2026a (reviewer-verified: the card's hygiene names the source and the extraction), the typecheck reports no error, tests/core/parse-guard.test.ts passes unchanged, and changelog.d/T0-LIMIT-RESET-IANA-NAMES.md says what changed in the form of changelog.d/README.md. [R1] [dod arms 1, 5, 6, 7]"
depends_on: []
budget: 120
tdd: true
sweep: "On main at fcc91cd8. The reset zone is read in one place: `RESET` and `isIanaName` in src/core/limit-reset.ts, which `finalizeReview` (src/review/pre-review.ts) is the only caller of. `git grep -n -E 'IANA_AREAS|IANA_BARE|isIanaName'` finds only src/core/limit-reset.ts. Node 22.23.1 here has ICU 78.2 with tz 2026a; CI runs Node 22. Probe on that runtime: Intl accepts `US/Pacific-New` and `Canada/East-Saskatchewan` and both pass `isIanaName` (areas `US`, `Canada`), so each reads a delay. Extraction trial on tzdata 2026a (eggert/tz tag 2026a, the nine R1 files): 597 names; Intl accepts all 597; every name of `Intl.supportedValuesOf('timeZone')` (418) is among them; neither removed name is; every zone of zone1970.tab is. docs/OPERATIONS.md line 387 defines `<zone>`; docs/ARCHITECTURE.md line 12 names limit-reset.ts."
forbid:
  - reading tzdata, a file or the network at run time in src/core/
  - changing src/core/parse-guard.ts, src/review/pre-review.ts or the 15-minute default hold
  - weakening or skipping a test to go green
non_goals:
  - "A script that regenerates the list from a later tzdata release: a zone a later release adds reads no delay, so its hold is the 15-minute default, until a card refreshes the list."
  - "A check of the list against the runtime's ICU canonical names in a test: a Node upgrade with a newer tz would fail it on unrelated cards."
  - "The phrase, time and daylight-saving rules of `limitResetMs`."
diagnosis:
  root_cause: "`isIanaName` (src/core/limit-reset.ts) accepts any `Area/Location` whose area is listed, and Intl (ICU) still accepts `US/Pacific-New` (removed by IANA in 2020b) and `Canada/East-Saskatchewan` (removed in 2017c), so `resets 1pm (US/Pacific-New)` reads a delay where it should fall back to the 15-minute default hold."
  same_class: "Any zone name ICU keeps that IANA removed inside a listed area; the full-name check covers every one, since the zone is read in one place."
hygiene: "Issue 398, follow-up of issue 394 (T0-CLI-LIMIT-RESET R3 decision 3 F3, deferred by owner ruling). Impact is a longer quota hold, never a pass. Source of the list: the files africa, antarctica, asia, australasia, europe, northamerica, southamerica, etcetera and backward of https://github.com/eggert/tz at tag 2026a; extraction: strip `#` comments, split each line on white space, take field 2 of `Zone` lines and field 3 of `Link` lines, sort, dedupe. Tests first: one commit adds tests/core/iana-zones.test.ts and the new rows of the other two test files with src/ and docs/ as on main, then the module, the lookup change, the doc sentences and the fragment."
doc_sync: changelog.d/T0-LIMIT-RESET-IANA-NAMES.md
---

# T0-LIMIT-RESET-IANA-NAMES

## Deliverable
`limitResetMs` reads a delay only for a reset zone whose full name is a tzdata 2026a zone or link name, so the two names ICU still accepts after IANA removed them fall back to the 15-minute default hold.

## Why
Issue 398: the area rule of T0-CLI-LIMIT-RESET lets `US/Pacific-New` and `Canada/East-Saskatchewan` through because ICU still resolves them.
