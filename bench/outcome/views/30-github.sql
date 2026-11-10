-- Card T1-OUTCOME-GITHUB: the tables of bench/outcome/github.ts as views over their JSONL files (explicit columns, so
-- an empty file still has them), then the accepted-change view and its summaries. Not run with --no-github.
CREATE OR REPLACE VIEW prs AS SELECT * FROM read_json('prs.jsonl', format = 'newline_delimited', columns = {number: 'BIGINT', headRef: 'VARCHAR', baseRef: 'VARCHAR', state: 'VARCHAR', createdAt: 'VARCHAR', mergedAt: 'VARCHAR', closedAt: 'VARCHAR', mergeCommitSha: 'VARCHAR', headSha: 'VARCHAR'});
CREATE OR REPLACE VIEW checks AS SELECT * FROM read_json('checks.jsonl', format = 'newline_delimited', columns = {sha: 'VARCHAR', name: 'VARCHAR', status: 'VARCHAR', conclusion: 'VARCHAR', startedAt: 'VARCHAR', completedAt: 'VARCHAR', runAttempt: 'BIGINT'});
CREATE OR REPLACE VIEW reverts AS SELECT * FROM read_json('reverts.jsonl', format = 'newline_delimited', columns = {sha: 'VARCHAR', date: 'VARCHAR', revertedSha: 'VARCHAR', daysAfter: 'DOUBLE'});
CREATE OR REPLACE VIEW branch_commits AS SELECT * FROM read_json('branch_commits.jsonl', format = 'newline_delimited', columns = {number: 'BIGINT', sha: 'VARCHAR', date: 'VARCHAR', merge: 'BOOLEAN', modelCoAuthor: 'BOOLEAN'});
CREATE OR REPLACE VIEW github_errors AS SELECT * FROM read_json('github_errors.jsonl', format = 'newline_delimited', columns = {command: 'VARCHAR', exit: 'BIGINT', stderr: 'VARCHAR', problem: 'VARCHAR'});
CREATE OR REPLACE VIEW required_checks AS SELECT * FROM read_json('required_checks.jsonl', format = 'newline_delimited', columns = {name: 'VARCHAR'});

-- The pull requests of a card run: the one its prNumber names, else every one whose headRef is the card id.
CREATE OR REPLACE VIEW run_prs AS
SELECT r.goalId, r.cardId, p.number, p.mergedAt, p.closedAt, p.mergeCommitSha
FROM card_runs r JOIN prs p ON CASE WHEN r.prNumber IS NOT NULL THEN p.number = r.prNumber ELSE p.headRef = r.cardId END;

-- The merged pull request of a card: the one merged first among the pull requests of its runs. Its fields are read
-- from that one pull request by number, since arg_min would skip a null mergeCommitSha and take another's.
CREATE OR REPLACE VIEW card_merge AS
SELECT c.cardId, p.number, p.mergedAt, p.mergeCommitSha
FROM (SELECT cardId, arg_min(number, mergedAt) AS number FROM run_prs WHERE mergedAt IS NOT NULL GROUP BY cardId) c JOIN prs p ON p.number = c.number;

-- Per commit with a run of a required check. A run is pending when its status is not completed, whatever its
-- startedAt; a pending run is not a success, and a completed one is a success by its conclusion alone. The last runs
-- of a name are its pending ones when it has any, else its completed runs with the highest runAttempt, else, when none
-- has a runAttempt, those with the latest startedAt, a run without a startedAt being earlier than any that has one.
-- green: every required name has a run and each name's last runs are all a success. The first runs of a name are
-- those with its lowest runAttempt; among runs without a runAttempt, when none has one, those without a startedAt
-- before any that has one, else those with the earliest startedAt. first_failed: a first run is no success.
-- Runs of one runAttempt are ordered by startedAt in the same way, for the first and for the last.
CREATE OR REPLACE VIEW commit_checks AS
WITH runs AS (
  SELECT sha, name, success,
    rank() OVER (PARTITION BY sha, name ORDER BY runAttempt ASC NULLS LAST, startedAt ASC NULLS FIRST) = 1 AS first_run,
    CASE WHEN bool_or(pending) OVER name_runs THEN pending ELSE rank() OVER (PARTITION BY sha, name ORDER BY runAttempt DESC NULLS LAST, startedAt DESC NULLS LAST) = 1 END AS last_run
  FROM (
    SELECT c.sha, c.name, c.startedAt, c.runAttempt, c.status IS DISTINCT FROM 'completed' AS pending,
      c.conclusion IS NOT DISTINCT FROM 'success' AND c.status IS NOT DISTINCT FROM 'completed' AS success
    FROM checks c WHERE c.name IN (SELECT name FROM required_checks)
  )
  WINDOW name_runs AS (PARTITION BY sha, name)
)
SELECT sha,
  count(DISTINCT name) FILTER (WHERE last_run) = (SELECT count(DISTINCT name) FROM required_checks) AND count(*) FILTER (WHERE last_run AND NOT success) = 0 AS green,
  count(*) FILTER (WHERE first_run AND NOT success) > 0 AS first_failed
FROM runs GROUP BY sha;

-- One row per card attempt (card_attempts). checksGreen, notReverted and noHumanCommit are null for a card without a
-- merged pull request. A merge commit without a run of a required check is not green unless no check is required.
-- noHumanCommit: null when the pull request has no branch_commits row (they could not be read), else whether every
-- row is a merge or has modelCoAuthor. accepted takes null as passing, acceptedStrict does not.
CREATE OR REPLACE VIEW accepted_changes AS
WITH parts AS (
  SELECT a.cardId, m.number AS prNumber, m.number IS NOT NULL AS merged,
    CASE WHEN m.number IS NOT NULL THEN coalesce(g.green, (SELECT count(*) FROM required_checks) = 0) END AS checksGreen,
    CASE WHEN m.number IS NOT NULL THEN NOT EXISTS (SELECT 1 FROM reverts v WHERE v.revertedSha = m.mergeCommitSha AND v.daysAfter <= 14) END AS notReverted,
    (SELECT bool_and(b.merge OR b.modelCoAuthor) FROM branch_commits b WHERE b.number = m.number) AS noHumanCommit,
    NOT EXISTS (SELECT 1 FROM review_decisions d LEFT JOIN cards c ON c.id = d.cardId WHERE d.stopReview AND (d.cardId = a.cardId OR c.superseded_by = a.cardId)) AS noRuling
  FROM card_attempts a LEFT JOIN card_merge m ON m.cardId = a.cardId LEFT JOIN commit_checks g ON g.sha = m.mergeCommitSha
)
SELECT *, merged AND checksGreen AND notReverted AND noRuling AND noHumanCommit IS DISTINCT FROM false AS accepted,
  merged AND checksGreen AND notReverted AND noRuling AND coalesce(noHumanCommit, false) AS acceptedStrict
FROM parts;

-- Accepted and strictly accepted changes over card attempts, the card attempts for which each boolean is false, and
-- the card attempts with a merged pull request whose noHumanCommit is null.
CREATE OR REPLACE VIEW summary_pr_success AS
SELECT count(*) AS card_attempts, count(*) FILTER (WHERE accepted) AS accepted, count(*) FILTER (WHERE accepted) / count(*) AS pr_success_rate,
  count(*) FILTER (WHERE acceptedStrict) AS accepted_strict, count(*) FILTER (WHERE acceptedStrict) / count(*) AS pr_success_rate_strict,
  count(*) FILTER (WHERE NOT merged) AS failing_merged, count(*) FILTER (WHERE NOT checksGreen) AS failing_checksGreen,
  count(*) FILTER (WHERE NOT notReverted) AS failing_notReverted, count(*) FILTER (WHERE NOT noHumanCommit) AS failing_noHumanCommit,
  count(*) FILTER (WHERE NOT noRuling) AS failing_noRuling, count(*) FILTER (WHERE merged AND noHumanCommit IS NULL) AS unknown_noHumanCommit
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

-- Per card: runs with mergeVerified and no merged pull request (run_prs); merged pull requests whose headRef is the id
-- of a card that has no mergeVerified run; closed unmerged pull requests that a run of the card names by prNumber or
-- whose headRef is the id of a registry card, each card and pull request pair once.
CREATE OR REPLACE VIEW summary_reconcile AS
SELECT * FROM (
  SELECT 'mergeVerified_without_merged_pr' AS kind, r.cardId, count(*) AS n FROM card_runs r
  WHERE r.mergeVerified AND NOT EXISTS (SELECT 1 FROM run_prs x WHERE x.goalId = r.goalId AND x.cardId = r.cardId AND x.mergedAt IS NOT NULL) GROUP BY r.cardId
  UNION ALL SELECT 'merged_pr_without_mergeVerified', p.headRef, count(*) FROM prs p
  WHERE p.mergedAt IS NOT NULL AND p.headRef IN (SELECT id FROM cards UNION SELECT cardId FROM card_runs)
    AND NOT EXISTS (SELECT 1 FROM card_runs r WHERE r.cardId = p.headRef AND r.mergeVerified) GROUP BY p.headRef
  UNION ALL SELECT 'closed_unmerged', cardId, count(*) FROM (
    SELECT r.cardId, p.number FROM card_runs r JOIN prs p ON p.number = r.prNumber WHERE p.mergedAt IS NULL AND p.closedAt IS NOT NULL
    UNION SELECT c.id, p.number FROM cards c JOIN prs p ON p.headRef = c.id WHERE p.mergedAt IS NULL AND p.closedAt IS NOT NULL
  ) GROUP BY cardId
) ORDER BY kind, cardId;
