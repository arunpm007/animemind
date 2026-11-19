-- ---------------------------------------------------------------------------
-- Rate limiting, in Postgres.
--
-- One row per (bucket, subject). `take_rate_limit` is a single atomic upsert:
-- two requests arriving together cannot both read "4 of 5" and both pass,
-- because the row lock serialises them. No Redis, no extra service, nothing
-- that costs money on a free tier.
--
-- Keys are SHA-256 hashes built in the application (bucket + IP or email), so
-- this table never stores an IP address or an email in readable form.
-- Old rows are deleted by the cron job (prune_rate_limits).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limit (
  key          text        PRIMARY KEY,
  hits         integer     NOT NULL,
  window_start timestamptz NOT NULL
);

-- Returns 0 when the request is allowed, otherwise the number of seconds
-- until the window resets (used for the Retry-After header).
CREATE OR REPLACE FUNCTION take_rate_limit(p_key text, p_limit int, p_window_seconds int)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r rate_limit;
  win interval := make_interval(secs => p_window_seconds);
BEGIN
  INSERT INTO rate_limit AS rl (key, hits, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE SET
    hits         = CASE WHEN rl.window_start <= now() - win THEN 1 ELSE rl.hits + 1 END,
    window_start = CASE WHEN rl.window_start <= now() - win THEN now() ELSE rl.window_start END
  RETURNING * INTO r;

  IF r.hits > p_limit THEN
    RETURN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (r.window_start + win - now())))::int);
  END IF;
  RETURN 0;
END
$$;

-- Housekeeping: drop windows that ended more than a day ago.
CREATE OR REPLACE FUNCTION prune_rate_limits() RETURNS integer
LANGUAGE sql AS $$
  WITH gone AS (
    DELETE FROM rate_limit WHERE window_start < now() - interval '1 day' RETURNING 1
  )
  SELECT count(*)::int FROM gone;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit TO animemind_app;
GRANT EXECUTE ON FUNCTION take_rate_limit(text, int, int) TO animemind_app;
GRANT EXECUTE ON FUNCTION prune_rate_limits() TO animemind_app;
