/**
 * Validate a post-sign-in destination so it can only ever be a path on this
 * site. An unvalidated `next` is an open redirect: a genuine AnimeMind link
 * that bounces people to a look-alike site.
 *
 * Checking `startsWith('/') && !startsWith('//')` is not enough on its own:
 * browsers treat a backslash as a slash and silently drop tabs and newlines,
 * so `/\evil.example` and `/\t/evil.example` both become `//evil.example` — a
 * protocol-relative URL pointing at another host. So: refuse those characters
 * outright, then resolve against a placeholder origin and require the result
 * to stay on it.
 */
const BASE = 'http://animemind.invalid';

export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
