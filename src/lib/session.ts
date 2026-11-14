import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, type Actor } from '@/server/http/api';
import { verifyAccessToken } from '@/server/auth/tokens';

/**
 * Resolve the signed-in user inside a server component.
 *
 * Note the layering this demonstrates: pages read by calling the SAME service
 * functions the HTTP routes call, not by fetching their own API over the
 * network. The services are transport-agnostic, so the web app gets them for
 * free in-process while a mobile app reaches them over HTTP. One
 * implementation, two transports — which is the whole point of the split.
 */
export async function currentActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  return { userId: claims.sub, role: claims.role, tier: claims.tier };
}

/**
 * Require a signed-in user, refreshing silently where possible.
 *
 * If the short-lived access token has expired but a refresh token is still
 * present, bounce through the session route rather than dumping the user at
 * sign-in — they have a valid 60-day session and should never notice the
 * 15-minute rotation.
 */
export async function requireActor(path: string): Promise<Actor> {
  const actor = await currentActor();
  if (actor) return actor;

  // The refresh cookie is scoped to /api/v1/auth, so it is deliberately NOT
  // sent to this page and cannot be checked here. Widening its path would
  // hand it to every request on the site — including any XSS — purely to make
  // this branch convenient, so instead the decision is delegated to the one
  // route the browser does send it to. That route redirects to /sign-in when
  // the cookie is absent or dead, so this cannot loop.
  redirect(`/api/v1/auth/session?next=${encodeURIComponent(path)}`);
}
