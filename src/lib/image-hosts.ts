/**
 * Image hosts the app may show through next/image.
 *
 * One list, used twice: next.config.ts turns it into `images.remotePatterns`
 * (who may be proxied through our optimiser), and PosterImage checks it before
 * rendering. next/image THROWS on a host that is not configured, and inside a
 * list that throw takes the whole screen down — so an unexpected host from a
 * provider must degrade to the text fallback, never crash the page.
 */
export const IMAGE_HOSTS = [
  // Kitsu — the primary provider.
  'media.kitsu.app',
  'media.kitsu.io',
  // MyAnimeList, via Jikan or the official API.
  'cdn.myanimelist.net',
  'api-cdn.myanimelist.net',
] as const;

export function isAllowedImage(src: string | null | undefined): src is string {
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && (IMAGE_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}
