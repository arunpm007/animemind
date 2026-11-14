-- ---------------------------------------------------------------------------
-- The sync cursor is assigned by the database, not the application.
--
-- If application code owned this, one forgotten call site would silently stop
-- a row from ever reaching the user's other devices — a bug that shows up days
-- later as "my phone didn't update" and is near-impossible to trace.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bump_change_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_seq := nextval('change_seq');
  NEW.updated_at  := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS user_work_bump_seq ON user_work;
CREATE TRIGGER user_work_bump_seq
  BEFORE INSERT OR UPDATE ON user_work
  FOR EACH ROW EXECUTE FUNCTION bump_change_seq();

-- rewatch_count is denormalised for read speed. This keeps it honest against
-- watch_session, which is the append-only source of truth.
CREATE OR REPLACE FUNCTION sync_rewatch_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE completed_passes int;
BEGIN
  SELECT count(*) INTO completed_passes
    FROM watch_session
   WHERE user_id = NEW.user_id AND work_id = NEW.work_id
     AND completed_at IS NOT NULL;

  UPDATE user_work
     SET rewatch_count = GREATEST(completed_passes - 1, 0)
   WHERE user_id = NEW.user_id AND work_id = NEW.work_id;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS watch_session_rewatch_count ON watch_session;
CREATE TRIGGER watch_session_rewatch_count
  AFTER INSERT OR UPDATE OF completed_at ON watch_session
  FOR EACH ROW EXECUTE FUNCTION sync_rewatch_count();
