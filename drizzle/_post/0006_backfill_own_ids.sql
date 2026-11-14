-- ---------------------------------------------------------------------------
-- Every work claims the one id it has always known: its own.
--
-- Ingest now does this for new rows, but the catalog predates it and not one
-- work of several hundred held a single claim. That emptiness is what made
-- cross-provider identity inert — a mapping fetched for one row can only meet
-- another row if that other row has already said who it is, so with nothing
-- claimed there was nothing to meet, and the same anime accumulated a second
-- row under the second provider.
--
-- Costs no provider requests: `provider` and `provider_id` are the claim.
-- Idempotent, and conflicts are left alone rather than overwritten — a claim
-- that already exists was made by a row that resolved its identity properly,
-- and it outranks this backfill.
-- ---------------------------------------------------------------------------

INSERT INTO work_external_id (site, external_id, work_id)
SELECT
  -- Jikan serves MyAnimeList's data under MyAnimeList's numbers, so both sit
  -- in the same id space. Treating them as separate is what allowed one anime
  -- to hold two rows in the first place.
  CASE WHEN w.provider = 'kitsu' THEN 'kitsu' ELSE 'myanimelist' END,
  w.provider_id,
  w.id
FROM work w
ON CONFLICT (site, external_id) DO NOTHING;
