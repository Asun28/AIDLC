-- Card T1-OUTCOME-HISTORY: the tables of bench/outcome/history.ts as views over their JSONL files (explicit columns, so
-- an empty file still has them), then the three summaries. Not run with --no-history. It reads the views of 10-cards.sql.
CREATE OR REPLACE VIEW rulings AS SELECT * FROM read_json('rulings.jsonl', format = 'newline_delimited', columns = {sha: 'VARCHAR', date: 'VARCHAR', subject: 'VARCHAR', cards: 'VARCHAR[]', successor: 'VARCHAR', predecessor: 'VARCHAR', 'on': 'VARCHAR'});
CREATE OR REPLACE VIEW ruling_set AS SELECT * FROM read_json('ruling_set.jsonl', format = 'newline_delimited', columns = {sha: 'VARCHAR', date: 'VARCHAR', subject: 'VARCHAR', cards: 'VARCHAR[]', successor: 'VARCHAR', predecessor: 'VARCHAR', 'on': 'VARCHAR', stopReason: 'VARCHAR', stopDetail: 'VARCHAR', candidateSha: 'VARCHAR', outcome: 'VARCHAR', decision: 'BIGINT', findings: 'STRUCT(id VARCHAR, "class" VARCHAR, file VARCHAR, reason VARCHAR)[]', successorMerged: 'BOOLEAN'});
CREATE OR REPLACE VIEW repeat_blocks AS SELECT * FROM read_json('repeat_blocks.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', id: 'VARCHAR', file: 'VARCHAR', line: 'BIGINT', outsideDelta: 'BOOLEAN', predates: 'VARCHAR'});
CREATE OR REPLACE VIEW finding_fixes AS SELECT * FROM read_json('finding_fixes.jsonl', format = 'newline_delimited', columns = {goalId: 'VARCHAR', cardId: 'VARCHAR', id: 'VARCHAR', file: 'VARCHAR', candidateSha: 'VARCHAR', changedAfter: 'VARCHAR'});
CREATE OR REPLACE VIEW history_errors AS SELECT * FROM read_json('history_errors.jsonl', format = 'newline_delimited', columns = {command: 'VARCHAR', exit: 'BIGINT', stderr: 'VARCHAR'});

-- Per predates value, a null one being a group of its own: the repeat blocks, their share of all repeat blocks, and
-- those where the two sides differ: predates is 'true' and outsideDelta is not true (false or null), or predates is
-- not 'true' (null included) and outsideDelta is true. The view has no row without a repeat block, so no share divides by 0.
CREATE OR REPLACE VIEW summary_repeat_blocks AS
SELECT predates, count(*) AS n, count(*) / sum(count(*)) OVER () AS share,
  count(*) FILTER (WHERE (predates IS NOT DISTINCT FROM 'true') <> (outsideDelta IS NOT DISTINCT FROM true)) AS differs_from_outsideDelta
FROM repeat_blocks GROUP BY predates ORDER BY predates NULLS LAST;

-- Per stage and perspective, a null one of either being a group of its own: findings raised, those with a dispute,
-- those raised again, and fixed: the finding has a resolvedAt, its finding_fixes row has changedAfter 'true' and a run
-- of its card has mergeVerified. A finding without a finding_fixes row, a null disputes or reraises count, a null
-- cardId and a null mergeVerified count in raised only.
CREATE OR REPLACE VIEW summary_true_defects AS
SELECT f.stage, f.perspective, count(*) AS raised, count(*) FILTER (WHERE f.disputes > 0) AS disputed, count(*) FILTER (WHERE f.reraises > 0) AS reraised,
  count(*) FILTER (WHERE f.resolvedAt IS NOT NULL AND x.changedAfter = 'true' AND f.cardId IN (SELECT r.cardId FROM card_runs r WHERE r.mergeVerified)) AS fixed
FROM findings f LEFT JOIN finding_fixes x ON x.goalId = f.goalId AND x.cardId = f.cardId AND x.id = f.id
GROUP BY f.stage, f.perspective ORDER BY f.stage NULLS LAST, f.perspective NULLS LAST;

-- Rows metric, key, value. rulings_per_month: per UTC calendar month of the commit date (key YYYY-MM).
-- rulings_per_on: per on value, a null one being a group of its own (null key). card_attempts_per_ruling: the rows of
-- card_attempts over the rulings, null without a ruling. superseded_predecessor_share: of the cards with superseded_by,
-- the share whose id is the predecessor of a ruling, null without such a card; a null predecessor is the id of no card.
CREATE OR REPLACE VIEW summary_rulings AS
SELECT * FROM (
  SELECT 'rulings_per_month' AS metric, substr(date, 1, 7) AS key, count(*)::DOUBLE AS value FROM rulings GROUP BY ALL
  UNION ALL SELECT 'rulings_per_on', "on", count(*) FROM rulings GROUP BY ALL
  UNION ALL SELECT 'card_attempts_per_ruling', NULL, (SELECT count(*) FROM card_attempts) / nullif((SELECT count(*) FROM rulings), 0)
  UNION ALL SELECT 'superseded_predecessor_share', NULL, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM rulings r WHERE r.predecessor = c.id)) / nullif(count(*), 0) FROM cards c WHERE c.superseded_by IS NOT NULL
) ORDER BY metric, key NULLS LAST;
