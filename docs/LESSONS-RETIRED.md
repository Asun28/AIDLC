# Retired lessons

Append-only: one entry per retirement of a line of LESSONS.md beside this file,
written by `aidlc lessons retire`. An entry that does not resolve retires nothing.

Format: `- <date> RETIRE <old date> <old ref> <old sha256> BY <new date> <new ref> <new sha256>: <reason>`

## Entries
- 2026-11-28 RETIRE 2026-09-20 T0-WORKTREE-ROOT-DEFAULT 0b029ed4919dbc16dbecadcda80e97ac544789623a1471d40a8200884b1ecc47 BY 2026-11-07 T0-CANDIDATE-WITHDRAW b53c4d8127fc9d4d2bf551b486934d6d40eb485cf302e662bc91f956e1f6ea46: The T0-CANDIDATE-WITHDRAW lesson replaces the rule that a successful attempt binds the candidate for good, since aidlc card withdraw now releases it.
- 2026-11-28 RETIRE 2026-09-24 T1-OPUS55-R3-3 a13d4cb8d2e6b8afb708761de5d94af6054512d343f935c89a3a0a8c4a9b444e BY 2026-11-24 T0-MUTANT-EVIDENCE-STATE f2e5bcecd08585bae82b7f5d1e76399cdaf39faaf6279723c88dbe35a0e85fc4: The T0-MUTANT-EVIDENCE-STATE lesson makes the mutation sweep before the first R3 decision optional unless the card asks for one.
- 2026-11-28 RETIRE 2026-09-24 T1-OPUS55-MODELS 5c161e5821435a19de0b2e09611fee43f06ee342a4dafc8d1ecccc0a8b8c59d2 BY 2026-11-07 T0-CARD-SHORT cc1eceeb7188cb83f7cf46acf51c78b9356d3dd3dc4792567e4ec78f38115314: The T0-CARD-SHORT lesson proves doc text that no program reads by reviewer verification against the diff, not by a test of the exact sentence.
- 2026-11-28 RETIRE 2026-11-18 T0-STORE-LIST-ENOENT-2 0f8af378d191a8f01d2b34bbce0e00671ca1138d9b9202cfb544b21990b7ff64 BY 2026-11-23 T1-CARD-WRITER-LESSONS 0662fba4cc676a7ba55e97224fd936370d8def6980b1bc9961f62bdc19faf6b0: The T1-CARD-WRITER-LESSONS lesson keeps forbid to hard boundaries, so a card no longer lists import lines in its forbid allowlist.
- 2026-11-28 RETIRE 2026-11-25 T0-BENCH-INPUTS 4a8d2c5a9ff8492c8af351a5b43a2bb3eb2b316df93e0bb19f75ea22f4f8180d BY 2026-11-28 T0-LESSON-RETIRE-DATA 282c97d6671c9cb951c91abb87e41caaf188d3b13a1f5bff948b4131bdc81ceb: The T0-LESSON-RETIRE-DATA lesson keeps the SHIP warning and drops the advice to keep the whole output, which did not keep the refused merge text.
