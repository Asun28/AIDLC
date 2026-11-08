/** The sentence each formal REVIEW_FIX narration ends with (card T1-FINDING-REPRO, R6); it contains no `class`. */
export const REPRO_REQUEST =
  'For each fixed finding of the Bugs or Security pass, record `aidlc review repro <cardId> <findingId> --argv \'<JSON array>\' --files <paths>` with the test that catches it, and attach one to a `wrong` dispute; a repro is evidence for the next decision and changes no gate.';
