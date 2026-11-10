-- Card T1-OUTCOME-GITHUB: the tables of bench/outcome/github.ts as views over their JSONL files (explicit columns, so
-- an empty file still has them), then the accepted-change view and its summaries. Not run with --no-github.
CREATE OR REPLACE VIEW prs AS SELECT * FROM read_json('prs.jsonl', format = 'newline_delimited', columns = {number: 'BIGINT', headRef: 'VARCHAR', baseRef: 'VARCHAR', state: 'VARCHAR', createdAt: 'VARCHAR', mergedAt: 'VARCHAR', closedAt: 'VARCHAR', mergeCommitSha: 'VARCHAR', headSha: 'VARCHAR'});
CREATE OR REPLACE VIEW checks AS SELECT * FROM read_json('checks.jsonl', format = 'newline_delimited', columns = {sha: 'VARCHAR', name: 'VARCHAR', status: 'VARCHAR', conclusion: 'VARCHAR', startedAt: 'VARCHAR', completedAt: 'VARCHAR', runAttempt: 'BIGINT'});
CREATE OR REPLACE VIEW reverts AS SELECT * FROM read_json('reverts.jsonl', format = 'newline_delimited', columns = {sha: 'VARCHAR', date: 'VARCHAR', revertedSha: 'VARCHAR', daysAfter: 'DOUBLE'});
CREATE OR REPLACE VIEW branch_commits AS SELECT * FROM read_json('branch_commits.jsonl', format = 'newline_delimited', columns = {number: 'BIGINT', sha: 'VARCHAR', date: 'VARCHAR', modelCoAuthor: 'BOOLEAN'});
CREATE OR REPLACE VIEW github_errors AS SELECT * FROM read_json('github_errors.jsonl', format = 'newline_delimited', columns = {command: 'VARCHAR', exit: 'BIGINT', stderr: 'VARCHAR', problem: 'VARCHAR'});
CREATE OR REPLACE VIEW required_checks AS SELECT * FROM read_json('required_checks.jsonl', format = 'newline_delimited', columns = {name: 'VARCHAR'});

-- The pull requests of a card run: the one its prNumber names, else every one whose headRef is the card id.
CREATE OR REPLACE VIEW run_prs AS
SELECT r.goalId, r.cardId, p.number, p.mergedAt, p.closedAt, p.mergeCommitSha
FROM card_runs r JOIN prs p ON CASE WHEN r.prNumber IS NOT NULL THEN p.number = r.prNumber ELSE p.headRef = r.cardId END;

-- The merged pull request of a card: the one merged first among the pull requests of its runs.
CREATE OR REPLACE VIEW card_merge AS
SELECT cardId, arg_min(number, mergedAt) AS number, min(mergedAt) AS mergedAt, arg_min(mergeCommitSha, mergedAt) AS mergeCommitSha
FROM run_prs WHERE mergedAt IS NOT NULL GROUP BY cardId;

-- Per commit with a run of a required check. green: every required name has a run, and each name's runs with its
-- latest startedAt all concluded success. first_failed: a run with the earliest startedAt of its name did not.
CREATE OR REPLACE VIEW commit_checks AS
WITH runs AS (
  SELECT c.sha, c.name, c.conclusion IS NOT DISTINCT FROM 'success' AS success,
    c.startedAt = min(c.startedAt) OVER name_runs AS first_run, c.startedAt = max(c.startedAt) OVER name_runs AS last_run
  FROM checks c WHERE c.name IN (SELECT name FROM required_checks)
  WINDOW name_runs AS (PARTITION BY c.sha, c.name)
)
SELECT sha,
  count(DISTINCT name) FILTER (WHERE last_run) = (SELECT count(DISTINCT name) FROM required_checks) AND count(*) FILTER (WHERE last_run AND NOT success) = 0 AS green,
  count(*) FILTER (WHERE first_run AND NOT success) > 0 AS first_failed
FROM runs GROUP BY sha;

-- One row per card attempt (card_attempts). checksGreen, notReverted and noHumanCommit are null for a card without a
-- merged pull request. A merge commit without a run of a required check is not green unless no check is required; a
-- merged pull request without branch commits has no proof and noHumanCommit is false.
CREATE OR REPLACE VIEW accepted_changes AS
WITH parts AS (
  SELECT a.cardId, m.number AS prNumber, m.number IS NOT NULL AS merged,
    CASE WHEN m.number IS NOT NULL THEN coalesce(g.green, (SELECT count(*) FROM required_checks) = 0) END AS checksGreen,
    CASE WHEN m.number IS NOT NULL THEN NOT EXISTS (SELECT 1 FROM reverts v WHERE v.revertedSha = m.mergeCommitSha AND v.daysAfter <= 14) END AS notReverted,
    CASE WHEN m.number IS NOT NULL THEN coalesce((SELECT bool_and(b.modelCoAuthor) FROM branch_commits b WHERE b.number = m.number), false) END AS noHumanCommit,
    NOT EXISTS (SELECT 1 FROM review_decisions d LEFT JOIN cards c ON c.id = d.cardId WHERE d.stopReview AND (d.cardId = a.cardId OR c.superseded_by = a.cardId)) AS noRuling
  FROM card_attempts a LEFT JOIN card_merge m ON m.cardId = a.cardId LEFT JOIN commit_checks g ON g.sha = m.mergeCommitSha
)
SELECT *, merged AND checksGreen AND notReverted AND noHumanCommit AND noRuling AS accepted FROM parts;

-- Accepted changes over card attempts, and the card attempts for which each boolean is false.
CREATE OR REPLACE VIEW summary_pr_success AS
SELECT count(*) AS card_attempts, count(*) FILTER (WHERE accepted) AS accepted, count(*) FILTER (WHERE accepted) / count(*) AS pr_success_rate,
  count(*) FILTER (WHERE NOT merged) AS failing_merged, count(*) FILTER (WHERE NOT checksGreen) AS failing_checksGreen,
  count(*) FILTER (WHERE NOT notReverted) AS failing_notReverted, count(*) FILTER (WHERE NOT noHumanCommit) AS failing_noHumanCommit,
  count(*) FILTER (WHERE NOT noRuling) AS failing_noRuling
FROM accepted_changes;

-- Hours from the startedAt of the earliest run of a card to the mergedAt of its merged pull request (n cards), and
-- the cards with a mergeVerified run that have no merged pull request.
CREATE OR REPLACE VIEW summary_lead_time_pr AS
WITH lead AS (
  SELECT epoch(m.mergedAt::TIMESTAMPTZ - min(r.startedAt::TIMESTAMPTZ)) / 3600 AS hours
  FROM card_merge m JOIN card_runs r ON r.cardId = m.cardId GROUP BY m.cardId, m.mergedAt
)
SELECT quantile_cont(hours, 0.5) AS p50_hours, quantile_cont(hours, 0.9) AS p90_hours, count(*) AS n,
  (SELECT count(*) FROM card_attempts a WHERE a.merged AND a.cardId NOT IN (SELECT cardId FROM card_merge)) AS merged_cards_without_pr
FROM lead;

-- Over merged pull requests: the share whose head has a check run with runAttempt above 1, and the share whose head
-- has a required check whose first run did not conclude success.
CREATE OR REPLACE VIEW summary_ci AS
SELECT count(*) AS merged_prs,
  avg(coalesce((SELECT max(c.runAttempt) > 1 FROM checks c WHERE c.sha = p.headSha), false)::INT) AS rerun_share,
  avg(coalesce(g.first_failed, false)::INT) AS first_attempt_failed_share
FROM prs p LEFT JOIN commit_checks g ON g.sha = p.headSha WHERE p.mergedAt IS NOT NULL;

-- Per card: runs with mergeVerified and no merged pull request; merged pull requests whose headRef is the id of a card
-- that has no mergeVerified run; pull requests of its runs that were closed unmerged.
CREATE OR REPLACE VIEW summary_reconcile AS
SELECT * FROM (
  SELECT 'mergeVerified_without_merged_pr' AS kind, r.cardId, count(*) AS n FROM card_runs r
  WHERE r.mergeVerified AND NOT EXISTS (SELECT 1 FROM run_prs x WHERE x.goalId = r.goalId AND x.cardId = r.cardId AND x.mergedAt IS NOT NULL) GROUP BY r.cardId
  UNION ALL SELECT 'merged_pr_without_mergeVerified', p.headRef, count(*) FROM prs p
  WHERE p.mergedAt IS NOT NULL AND p.headRef IN (SELECT id FROM cards UNION SELECT cardId FROM card_runs)
    AND NOT EXISTS (SELECT 1 FROM card_runs r WHERE r.cardId = p.headRef AND r.mergeVerified) GROUP BY p.headRef
  UNION ALL SELECT 'closed_unmerged', cardId, count(DISTINCT number) FROM run_prs WHERE mergedAt IS NULL AND closedAt IS NOT NULL GROUP BY cardId
) ORDER BY kind, cardId;
