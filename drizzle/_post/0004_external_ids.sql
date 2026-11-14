-- Cross-provider identity. See the comment on workExternalId in schema.ts.
--
-- The primary key is a GLOBAL claim on (site, external_id): two works cannot
-- both be MyAnimeList 16498. Ingestion resolves the resulting conflict by
-- merging the duplicate rather than creating a second catalog entry.
CREATE TABLE IF NOT EXISTS work_external_id (
  site        text NOT NULL,
  external_id text NOT NULL,
  work_id     uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  PRIMARY KEY (site, external_id)
);

CREATE INDEX IF NOT EXISTS external_work_idx ON work_external_id (work_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON work_external_id TO animemind_app;
