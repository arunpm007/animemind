-- ---------------------------------------------------------------------------
-- Runs BEFORE the generated schema.
--
-- change_seq is the sync cursor for every user-owned table. It must exist
-- before user_work is created because that table defaults to nextval() on it.
-- A global sequence (not per-user, not a timestamp) is what lets a client ask
-- "everything after N" and get a gap-free, clock-independent answer.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS change_seq;

-- The application connects as a NON-OWNER role. This is not ceremony: Postgres
-- exempts a table's owner from its own row-level security unless FORCE is set,
-- so running the app as the owner would make every policy below silently inert.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'animemind_app') THEN
    CREATE ROLE animemind_app LOGIN PASSWORD 'animemind_app';
  END IF;
END
$$;
