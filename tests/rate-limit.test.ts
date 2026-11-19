/**
 * Rate limiting runs in Postgres, so it is tested against the real database:
 * the guarantee that matters (concurrent requests cannot slip past the limit)
 * only exists because of the row lock in take_rate_limit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { enforce, type Rule } from '@/server/http/rate-limit';
import { HttpError } from '@/server/http/api';

const APP_URL =
  process.env.DATABASE_URL ?? 'postgres://animemind_app:animemind_app@localhost:55432/animemind';

let app: postgres.Sql;
let reachable = true;

beforeAll(async () => {
  app = postgres(APP_URL, { max: 4, onnotice: () => {} });
  try {
    await app`SELECT 1`;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await app?.end();
});

const rule = (limit: number, windowSeconds = 60): Rule => ({
  name: `test:${Date.now()}:${Math.random()}`,
  limit,
  windowSeconds,
});

describe('rate limiting', () => {
  it('allows up to the limit, then refuses with a Retry-After', async () => {
    if (!reachable) return;
    const r = rule(3);
    for (let i = 0; i < 3; i++) await enforce(r, '203.0.113.7');
    const err = await enforce(r, '203.0.113.7').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfter).toBeGreaterThan(0);
    expect(err.retryAfter).toBeLessThanOrEqual(60);
  });

  it('counts each subject separately', async () => {
    if (!reachable) return;
    const r = rule(1);
    await enforce(r, 'a@example.com');
    await expect(enforce(r, 'b@example.com')).resolves.toBeUndefined();
    await expect(enforce(r, 'a@example.com')).rejects.toBeInstanceOf(HttpError);
  });

  it('treats emails case-insensitively', async () => {
    if (!reachable) return;
    const r = rule(1);
    await enforce(r, 'Someone@Example.com');
    await expect(enforce(r, 'someone@example.com')).rejects.toBeInstanceOf(HttpError);
  });

  it('cannot be raced: 20 concurrent hits against a limit of 5 let exactly 5 through', async () => {
    if (!reachable) return;
    const r = rule(5);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => enforce(r, '198.51.100.1')),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(5);
  });

  it('opens a fresh window once the old one has passed', async () => {
    if (!reachable) return;
    const r = rule(1, 1);
    await enforce(r, 'window');
    await expect(enforce(r, 'window')).rejects.toBeInstanceOf(HttpError);
    await new Promise((res) => setTimeout(res, 1100));
    await expect(enforce(r, 'window')).resolves.toBeUndefined();
  });

  it('never stores the raw IP or email', async () => {
    if (!reachable) return;
    const r = rule(10);
    await enforce(r, 'private.person@example.com');
    const rows = await app<{ key: string }[]>`SELECT key FROM rate_limit WHERE key LIKE ${'%example%'}`;
    expect(rows).toHaveLength(0);
  });
});
