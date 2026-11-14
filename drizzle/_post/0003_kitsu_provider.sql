-- Kitsu became the primary source after the original mirror (Jikan) measured
-- 1/10 then 0/10 successful requests across three sessions while Kitsu
-- answered 8/8. Adding the enum value separately because drizzle-kit does not
-- emit ALTER TYPE for an added variant.
ALTER TYPE provider ADD VALUE IF NOT EXISTS 'kitsu';
