-- ---------------------------------------------------------------------------
-- Runs AFTER the generated schema.
--
-- Per-user isolation is enforced by the database, not by discipline in the
-- application. A route that forgets its WHERE clause returns zero rows here,
-- rather than returning somebody else's library.
--
-- Every request opens a transaction and issues:
--     SELECT set_config('app.user_id', $1, true);
-- The `true` makes it transaction-local, so a pooled connection can never leak
-- one user's identity into the next request.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO animemind_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO animemind_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO animemind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO animemind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO animemind_app;

CREATE OR REPLACE FUNCTION current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  -- missing_ok = true: an unset setting yields NULL, and NULL = uuid is never
  -- true, so an unauthenticated connection sees nothing instead of erroring.
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_work', 'watch_session', 'applied_op', 'user_notification']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so that even the owning role is subject to the policy.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = current_app_user()) '
      'WITH CHECK (user_id = current_app_user())',
      t || '_own', t
    );
  END LOOP;
END
$$;

-- `account` is deliberately NOT under RLS: sign-in must look a user up by
-- email before any identity exists. That lookup is confined to
-- src/server/auth/, is the only place that queries this table unscoped, and is
-- the one code path to audit.
