-- Trimmed by hand.
--
-- drizzle-kit regenerates the whole diff from its snapshot, and the snapshot
-- did not know about drizzle/_post/0003 and 0004 — which had already added the
-- `kitsu` provider value and the work_external_id table by hand, because
-- drizzle-kit cannot express enum additions or the row-level-security that
-- follows. Replaying them fails on the enum. Only the new column belongs here.
ALTER TABLE "work" ADD COLUMN IF NOT EXISTS "identity_checked_at" timestamp with time zone;
