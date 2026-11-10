-- Card T1-OUTCOME-INGEST: the tables of bench/outcome/ingest.ts as views over their JSONL files (read from the working
-- directory, with explicit columns so an empty file still has them), then the card and review views.
CREATE OR REPLACE VIEW cards AS SELECT * FROM read_json('cards.jsonl', format = 'newline_delimited', columns = {id: 'VARCHAR', status: 'VARCHAR', superseded_by: 'VARCHAR', depends_on: 'VARCHAR[]', tdd: 'BOOLEAN', budget: 'BIGINT'});
CREATE OR REPLACE VIEW card_runs AS SELECT * FROM read_json('card_runs.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', startedAt: 'VARCHAR', state: 'VARCHAR', mergeVerified: 'BOOLEAN', prNumber: 'BIGINT', stopReason: 'VARCHAR', stopDetail: 'VARCHAR', substantiveDecisions: 'BIGINT', substantiveBlocks: 'BIGINT', updatedAt: 'VARCHAR'});
CREATE OR REPLACE VIEW review_decisions AS SELECT * FROM read_json('review_decisions.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', stage: 'VARCHAR', outcome: 'VARCHAR', mergeBlocking: 'BOOLEAN', reviewer: 'VARCHAR', requestedAt: 'VARCHAR', candidateSha: 'VARCHAR', secondPass: 'BOOLEAN', baseSync: 'BOOLEAN', stopReview: 'BOOLEAN', decision: 'BIGINT', round: 'BIGINT', cycle: 'BIGINT', angles: 'STRUCT(angle VARCHAR, outcome VARCHAR)[]'});
CREATE OR REPLACE VIEW findings AS SELECT * FROM read_json('findings.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', id: 'VARCHAR', stage: 'VARCHAR', round: 'BIGINT', cycle: 'BIGINT', perspective: 'VARCHAR', file: 'VARCHAR', class: 'VARCHAR', candidateSha: 'VARCHAR', raisedAt: 'VARCHAR', disposition: 'VARCHAR', disputes: 'BIGINT', reraises: 'BIGINT', resolvedAt: 'VARCHAR', advisory: 'BOOLEAN', outsideDelta: 'BOOLEAN', reason: 'VARCHAR'});
CREATE OR REPLACE VIEW state_spans AS SELECT * FROM read_json('state_spans.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', state: 'VARCHAR', startTs: 'VARCHAR', endTs: 'VARCHAR'});
CREATE OR REPLACE VIEW attempts AS SELECT * FROM read_json('attempts.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', outcome: 'VARCHAR', endTs: 'VARCHAR', startTs: 'VARCHAR'});
CREATE OR REPLACE VIEW ingest_errors AS SELECT * FROM read_json('ingest_errors.jsonl', format = 'newline_delimited', columns = {source: 'VARCHAR', path: 'VARCHAR', line: 'BIGINT', problem: 'VARCHAR'});

-- One row per card with at least one run: merged when a run has mergeVerified, failed when the card has superseded_by.
CREATE OR REPLACE VIEW card_attempts AS
SELECT r.cardId, count(*) AS runs, bool_or(r.mergeVerified) AS merged, count(c.superseded_by) > 0 AS failed
FROM card_runs r LEFT JOIN cards c ON c.id = r.cardId
GROUP BY r.cardId;

-- Each card with the last card of its superseded_by chain (itself when it has none) and the number of steps to it.
-- A name the registry does not hold ends the chain; 50 steps end a chain that loops.
CREATE OR REPLACE VIEW card_family AS
WITH RECURSIVE chain(id, last_card, steps) AS (
  SELECT id, id, 0 FROM cards
  UNION ALL
  SELECT chain.id, c.superseded_by, chain.steps + 1 FROM chain JOIN cards c ON c.id = chain.last_card
  WHERE c.superseded_by IS NOT NULL AND chain.steps < 50
)
SELECT id, arg_max(last_card, steps) AS last_card, max(steps) AS steps FROM chain GROUP BY id;

-- Failed card attempts over card attempts.
CREATE OR REPLACE VIEW summary_successor_rate AS
SELECT count(*) AS card_attempts, count(*) FILTER (WHERE failed) AS failed, count(*) FILTER (WHERE merged) AS merged,
  count(*) FILTER (WHERE failed) / count(*) AS successor_rate
FROM card_attempts;

-- Over cards with at least one formal entry whose outcome is pass or block. A block with mergeBlocking absent is merge-blocking.
CREATE OR REPLACE VIEW summary_review_convergence AS
WITH per_card AS (
  SELECT cardId, bool_or(outcome = 'pass') AS passed, bool_or(stopReview) AS stopped,
    count(*) FILTER (WHERE outcome = 'block' AND coalesce(mergeBlocking, true)) AS blocks
  FROM review_decisions WHERE stage = 'formal'
  GROUP BY cardId HAVING count(*) FILTER (WHERE outcome IN ('pass', 'block')) > 0
)
SELECT count(*) AS cards,
  avg((passed AND blocks = 0)::INT) AS first_decision_pass_share,
  avg((blocks >= 2)::INT) AS two_or_more_blocks_share,
  avg(blocks + 1) FILTER (WHERE passed) AS mean_decisions_to_pass,
  avg(stopped::INT) AS stop_review_share
FROM per_card;

-- lead_p50 and lead_p90: hours from startedAt to the start of the first CLOSE or DONE span, over runs with mergeVerified
-- that have such a span (n runs). state_total: the hours of every span with an endTs, per state (n spans).
CREATE OR REPLACE VIEW summary_lead_time AS
WITH lead AS (
  SELECT epoch(min(s.startTs::TIMESTAMPTZ) - r.startedAt::TIMESTAMPTZ) / 3600 AS hours
  FROM card_runs r JOIN state_spans s ON s.goalId = r.goalId AND s.cardId = r.cardId AND s.state IN ('CLOSE', 'DONE')
  WHERE r.mergeVerified
  GROUP BY r.goalId, r.cardId, r.startedAt
)
SELECT * FROM (
  SELECT 'lead_p50' AS measure, NULL::VARCHAR AS state, quantile_cont(hours, 0.5) AS hours, count(*) AS n FROM lead
  UNION ALL SELECT 'lead_p90', NULL, quantile_cont(hours, 0.9), count(*) FROM lead
  UNION ALL SELECT 'state_total', state, sum(epoch(endTs::TIMESTAMPTZ - startTs::TIMESTAMPTZ)) / 3600, count(*) FROM state_spans WHERE endTs IS NOT NULL GROUP BY state
) ORDER BY measure, state;

-- Runs that carry a stop record, per stop reason.
CREATE OR REPLACE VIEW summary_stop_reasons AS
SELECT stopReason, count(*) AS runs FROM card_runs WHERE stopReason IS NOT NULL GROUP BY stopReason ORDER BY runs DESC, stopReason;
