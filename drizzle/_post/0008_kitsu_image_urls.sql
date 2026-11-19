-- ---------------------------------------------------------------------------
-- Repair cover/banner URLs that were stored as Kitsu's pre-signed storage links.
--
-- Kitsu sometimes returned `https://kitsu-production-media.s3.<region>.
-- backblazeb2.com/<path>?X-Amz-...` instead of its CDN. Those links expire after
-- 15 minutes and their host is not proxied (it crashed the search screen). The
-- same file lives permanently at https://media.kitsu.app/<path>. The normaliser
-- now rewrites new ones (kitsuImageUrl); this fixes rows saved before that.
-- ---------------------------------------------------------------------------

UPDATE work
SET cover_url = regexp_replace(cover_url,
  '^https://kitsu-production-media\.[^/]*\.backblazeb2\.com(/[^?]*).*$', 'https://media.kitsu.app\1')
WHERE cover_url ~ '^https://kitsu-production-media\.[^/]*\.backblazeb2\.com/';

UPDATE work
SET banner_url = regexp_replace(banner_url,
  '^https://kitsu-production-media\.[^/]*\.backblazeb2\.com(/[^?]*).*$', 'https://media.kitsu.app\1')
WHERE banner_url ~ '^https://kitsu-production-media\.[^/]*\.backblazeb2\.com/';
