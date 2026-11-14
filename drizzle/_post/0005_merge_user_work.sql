-- ---------------------------------------------------------------------------
-- Folding two catalog rows into one, for the half of the job that is owned by
-- users rather than by the catalog.
--
-- WHY THIS IS A FUNCTION AND NOT APPLICATION CODE
--
-- One anime can occupy two `work` rows, because two providers number it
-- differently. Repairing that means merging, and a merge has to move
-- `user_work` and `watch_session` off the losing row before it is deleted.
--
-- Those two tables are under FORCE row-level security. The application role
-- (`animemind_app`) has no BYPASSRLS, which is deliberate and should stay that
-- way — it is what makes a forgotten WHERE clause harmless. But it means the
-- merge, which runs with no user pinned, sees ZERO rows in either table. It
-- would move nothing, report success, and then delete the losing work, at
-- which point ON DELETE CASCADE — which is enforced by the system and ignores
-- RLS — would destroy the watch history the merge had just failed to see.
-- Silent, unrecoverable, and performed by the one tool meant to be careful.
--
-- The alternatives were worse. Granting BYPASSRLS to the application role
-- removes the guarantee from every query in the app to fix one operation.
-- Looping over every account and re-pinning `app.user_id` works, but makes a
-- single merge cost O(accounts) round trips.
--
-- So the crossing-user privilege is confined to exactly this: one function,
-- two work ids, no dynamic SQL, a pinned search_path, and EXECUTE granted only
-- to the application role. It can fold two works together and do nothing else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION merge_user_work(keeper uuid, loser uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- A SECURITY DEFINER function without this resolves unqualified names through
-- the caller's search_path, so a shadowing object in a schema they control
-- runs as the definer. Pinning it is not optional.
SET search_path = public, pg_temp
AS $$
BEGIN
  IF keeper = loser THEN RETURN; END IF;

  -- Where one person holds BOTH rows, combine rather than pick. Taking the
  -- furthest progress is the same rule the sync protocol uses: a merge must
  -- never cost someone episodes they have watched, and the row being kept is
  -- as likely as not to be the one further behind.
  UPDATE user_work k
     SET progress      = GREATEST(k.progress, l.progress),
         status        = CASE
           WHEN 'completed' IN (k.status::text, l.status::text) THEN 'completed'::watch_state
           WHEN 'watching'  IN (k.status::text, l.status::text) THEN 'watching'::watch_state
           ELSE k.status
         END,
         rewatching    = k.rewatching OR l.rewatching,
         rewatch_count = GREATEST(k.rewatch_count, l.rewatch_count),
         favorite      = k.favorite OR l.favorite,
         rating        = COALESCE(k.rating, l.rating),
         notes         = COALESCE(k.notes, l.notes),
         started_at    = LEAST(k.started_at, l.started_at),
         completed_at  = GREATEST(k.completed_at, l.completed_at),
         -- GREATEST ignores NULLs, so a row never watched does not erase a
         -- date on the other copy.
         last_watched_at = GREATEST(k.last_watched_at, l.last_watched_at),
         -- Only a row that is deleted on BOTH sides stays deleted.
         deleted_at    = CASE
           WHEN k.deleted_at IS NULL OR l.deleted_at IS NULL THEN NULL
           ELSE GREATEST(k.deleted_at, l.deleted_at)
         END,
         updated_at    = now()
    FROM user_work l
   WHERE k.work_id = keeper
     AND l.work_id = loser
     AND l.user_id = k.user_id;

  DELETE FROM user_work l
   WHERE l.work_id = loser
     AND EXISTS (
       SELECT 1 FROM user_work k
        WHERE k.work_id = keeper AND k.user_id = l.user_id
     );

  -- Whatever is left has no counterpart on the keeper, so it simply moves.
  UPDATE user_work SET work_id = keeper, updated_at = now() WHERE work_id = loser;

  -- Pass numbers are unique per (user, work) and the two rows number theirs
  -- independently, so they are offset past the keeper's rather than dropped.
  -- Rewatch counts are derived from these, and losing one would silently
  -- rewrite a user's history.
  UPDATE watch_session l
     SET work_id = keeper,
         pass_no = l.pass_no + COALESCE(
           (SELECT max(pass_no) FROM watch_session k
             WHERE k.user_id = l.user_id AND k.work_id = keeper), 0)
   WHERE l.work_id = loser;
END;
$$;

REVOKE ALL ON FUNCTION merge_user_work(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_user_work(uuid, uuid) TO animemind_app;
