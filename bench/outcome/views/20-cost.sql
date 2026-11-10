-- Card T1-OUTCOME-USAGE: the usage tables of bench/outcome/usage.ts as views over their JSONL files, then the cost views.
-- `tokens` is totalTokens for a reviewer-log row and the sum of the four kinds for every other row. costUsd is a list-price
-- estimate, null for a model without an entry in prices.json and for a reviewer-log row; sums leave null out.
CREATE OR REPLACE VIEW usage AS SELECT *, coalesce(totalTokens, coalesce(inputTokens, 0) + coalesce(cacheReadTokens, 0) + coalesce(cacheWriteTokens, 0) + coalesce(outputTokens, 0)) AS tokens
FROM read_json('usage.jsonl', format = 'newline_delimited', columns = {source: 'VARCHAR', sessionId: 'VARCHAR', ts: 'VARCHAR', model: 'VARCHAR', cwd: 'VARCHAR', sidechain: 'BOOLEAN', inputTokens: 'BIGINT', outputTokens: 'BIGINT', cacheReadTokens: 'BIGINT', cacheWriteTokens: 'BIGINT', totalTokens: 'BIGINT', durationMs: 'BIGINT', invocation: 'VARCHAR', agentId: 'VARCHAR', agentType: 'VARCHAR', agentCard: 'VARCHAR', goalId: 'VARCHAR', cardId: 'VARCHAR', stage: 'VARCHAR', costUsd: 'DOUBLE'});
CREATE OR REPLACE VIEW usage_errors AS SELECT * FROM read_json('usage_errors.jsonl', format = 'newline_delimited', columns = {source: 'VARCHAR', path: 'VARCHAR', problem: 'VARCHAR'});

-- The two card groups of the cost views: `merged`, a card with a run that has mergeVerified, and `superseded`, a card with
-- superseded_by. A card in both groups is counted in each.
CREATE OR REPLACE VIEW cost_groups AS
SELECT DISTINCT cardId, 'merged' AS cards FROM card_runs WHERE mergeVerified
UNION ALL SELECT id, 'superseded' FROM cards WHERE superseded_by IS NOT NULL;

-- Requests, tokens by kind and list-price cost per group and stage.
CREATE OR REPLACE VIEW summary_cost_by_stage AS
SELECT g.cards, u.stage, count(*) AS requests, sum(u.inputTokens)::BIGINT AS inputTokens, sum(u.cacheReadTokens)::BIGINT AS cacheReadTokens,
  sum(u.cacheWriteTokens)::BIGINT AS cacheWriteTokens, sum(u.outputTokens)::BIGINT AS outputTokens, sum(u.totalTokens)::BIGINT AS totalTokens,
  sum(u.costUsd) AS cost_usd, count(*) FILTER (WHERE u.costUsd IS NULL) AS unpriced_requests
FROM usage u JOIN cost_groups g ON g.cardId = u.cardId
GROUP BY g.cards, u.stage ORDER BY g.cards, u.stage;

-- Everything attributed to a card with superseded_by.
CREATE OR REPLACE VIEW summary_superseded_spend AS
SELECT count(DISTINCT u.cardId) AS cards, count(*) AS requests, sum(u.tokens)::BIGINT AS tokens, sum(u.costUsd) AS cost_usd, count(*) FILTER (WHERE u.costUsd IS NULL) AS unpriced_requests
FROM usage u JOIN cost_groups g ON g.cardId = u.cardId AND g.cards = 'superseded';

-- cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens) per source and model, over rows that carry inputTokens.
-- Every share of this file is null, not NaN, when its denominator is 0.
CREATE OR REPLACE VIEW summary_cache_share AS
SELECT source, model, count(*) AS requests, sum(cacheReadTokens) / nullif(sum(inputTokens + coalesce(cacheReadTokens, 0) + coalesce(cacheWriteTokens, 0)), 0) AS cache_read_share
FROM usage WHERE inputTokens IS NOT NULL
GROUP BY source, model ORDER BY source, model;

-- The cost of a card family (card_family.last_card; a card the registry does not hold is its own family) is the sum over
-- its attributed rows. p50, p90 and max over the families with at least one priced row.
CREATE OR REPLACE VIEW summary_cost_per_card AS
WITH family AS (
  SELECT coalesce(f.last_card, u.cardId) AS family, sum(u.costUsd) AS cost
  FROM usage u LEFT JOIN card_family f ON f.id = u.cardId
  WHERE u.cardId IS NOT NULL GROUP BY 1
)
SELECT count(*) AS families, count(cost) AS priced_families, quantile_cont(cost, 0.5) AS p50_usd, quantile_cont(cost, 0.9) AS p90_usd, max(cost) AS max_usd FROM family;

-- `unattributed`: the rows with stage unattributed, with their share of all rows and of all tokens. `unpriced`: the rows
-- without costUsd, per model (key). `codex_sessions_in_review_log`: the Codex sessions attributed to a card whose ts lies
-- between the requestedAt of a formal review of that card and requestedAt plus the durationMs of the log of that review
-- (the log named <card>.r3.<decision>.<suffix>); such a session and that log count the same request twice.
CREATE OR REPLACE VIEW summary_unattributed AS
WITH twice AS (
  SELECT DISTINCT c.sessionId, c.tokens
  FROM usage c
  JOIN usage l ON l.source = 'review-log' AND l.cardId = c.cardId
  JOIN review_decisions d ON d.stage = 'formal' AND d.goalId = l.goalId AND d.cardId = l.cardId AND starts_with(l.invocation, l.cardId || '.r3.' || d.decision || '.')
  WHERE c.source = 'codex' AND c.ts::TIMESTAMPTZ BETWEEN d.requestedAt::TIMESTAMPTZ AND d.requestedAt::TIMESTAMPTZ + to_milliseconds(l.durationMs)
)
SELECT * FROM (
  SELECT 'unattributed' AS measure, NULL::VARCHAR AS key, count(*) FILTER (WHERE stage = 'unattributed') AS requests, coalesce(sum(tokens) FILTER (WHERE stage = 'unattributed'), 0)::BIGINT AS tokens,
    count(*) FILTER (WHERE stage = 'unattributed') / nullif(count(*), 0) AS request_share, coalesce(sum(tokens) FILTER (WHERE stage = 'unattributed'), 0) / nullif(sum(tokens), 0) AS token_share
  FROM usage
  UNION ALL SELECT 'unpriced', model, count(*), sum(tokens)::BIGINT, NULL, NULL FROM usage WHERE costUsd IS NULL GROUP BY model
  UNION ALL SELECT 'codex_sessions_in_review_log', NULL, count(*), coalesce(sum(tokens), 0)::BIGINT, NULL, NULL FROM twice
) ORDER BY measure, key;
