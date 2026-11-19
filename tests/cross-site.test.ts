/**
 * The second lock behind SameSite cookies: a browser write that announces a
 * foreign Origin is refused before the handler runs. Apps send no Origin and
 * must be unaffected.
 */
import { describe, expect, it } from 'vitest';
import { crossSiteWrite } from '@/server/http/api';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';

const req = (method: string, headers: Record<string, string> = {}) =>
  new Request('http://animemind.test/api/v1/sync', { method, headers: { host: 'animemind.test', ...headers } });

describe('crossSiteWrite', () => {
  it('refuses a write from another site', () => {
    expect(crossSiteWrite(req('POST', { origin: 'https://evil.example' }))).toBe(true);
  });
  it('refuses an opaque "null" origin', () => {
    expect(crossSiteWrite(req('POST', { origin: 'null' }))).toBe(true);
  });
  it('allows the same site', () => {
    expect(crossSiteWrite(req('POST', { origin: 'http://animemind.test' }))).toBe(false);
  });
  it('allows apps and servers that send no Origin', () => {
    expect(crossSiteWrite(req('POST'))).toBe(false);
  });
  it('never blocks reads', () => {
    expect(crossSiteWrite(req('GET', { origin: 'https://evil.example' }))).toBe(false);
  });
  it('respects the proxy host header', () => {
    expect(crossSiteWrite(req('POST', { origin: 'https://animemind.app', 'x-forwarded-host': 'animemind.app' }))).toBe(false);
  });
  it('a real route answers 403 before doing anything', async () => {
    const res = await loginRoute(
      new Request('http://animemind.test/api/v1/auth/login', {
        method: 'POST',
        headers: { host: 'animemind.test', origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@y.z', password: 'whatever whatever', client: 'web' }),
      }),
      undefined as never,
    );
    expect(res.status).toBe(403);
  });
});
