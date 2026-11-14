/**
 * End-to-end API tests.
 *
 * Route handlers are plain `(Request) => Response` functions, so this exercises
 * the real HTTP path — auth, validation, envelope, RLS, merge rules — with no
 * server and no network. The provider is never called because the catalog row
 * is seeded from the captured Jikan fixture.
 *
 * The sync section is the important half: it encodes the guarantees a mobile
 * client is allowed to depend on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { unscoped } from '@/server/db/client';
import { account, work } from '@/server/db/schema';
import { normaliseJikanWork } from '@/server/providers/jikan';
import { upsertWork } from '@/server/services/ingest';
import aot from './fixtures/jikan-aot.json';

import { POST as registerRoute } from '@/app/api/v1/auth/register/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as meRoute } from '@/app/api/v1/auth/me/route';
import { GET as libraryGet, POST as libraryPost } from '@/app/api/v1/library/route';
import { POST as syncRoute } from '@/app/api/v1/sync/route';
import { POST as refreshRoute } from '@/app/api/v1/auth/refresh/route';

const email = `t-${Date.now()}@test.local`;
const password = 'correct horse battery staple';

let accessToken = '';
let userId = '';
let workId = '';
const deviceA = 'device-a';
const deviceB = 'device-b';

const json = (url: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

const authHeaders = () => ({ authorization: `Bearer ${accessToken}` });

async function bodyOf(res: Response) {
  return (await res.json()) as { data?: unknown; error?: { code: string } };
}

/** Build a sync op with the required envelope fields. */
const op = (device: string, rest: Record<string, unknown>) => ({
  id: ulid(),
  clientTs: Date.now(),
  deviceId: device,
  ...rest,
});

async function doSync(ops: unknown[], cursor?: string | null) {
  const res = await syncRoute(
    json('http://t/api/v1/sync', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ cursor: cursor ?? null, ops }),
    }),
    {},
  );
  const b = await bodyOf(res);
  return { res, data: b.data as Record<string, unknown> };
}

beforeAll(async () => {
  // Seed the catalog from the captured payload so nothing here needs network.
  const seeded = await upsertWork(normaliseJikanWork(aot as never), 'jikan');
  workId = seeded.id;

  const res = await registerRoute(
    json('http://t/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName: 'Test', client: 'ios' }),
    }),
    {},
  );
  const b = await bodyOf(res);
  const data = b.data as { accessToken: string; user: { id: string } };
  accessToken = data.accessToken;
  userId = data.user.id;
});

afterAll(async () => {
  const db = unscoped();
  await db.delete(account).where(eq(account.id, userId));
  await db.delete(work).where(eq(work.id, workId));
});

describe('auth', () => {
  it('registers and returns a bearer token to a mobile client', () => {
    expect(accessToken).toBeTruthy();
    expect(userId).toBeTruthy();
  });

  it('accepts the bearer token on a protected route', async () => {
    const res = await meRoute(json('http://t/api/v1/auth/me', { headers: authHeaders() }), {});
    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    expect((b.data as { email: string }).email).toBe(email);
  });

  it('rejects a missing token with a machine-readable code', async () => {
    const res = await meRoute(json('http://t/api/v1/auth/me'), {});
    expect(res.status).toBe(401);
    const b = await bodyOf(res);
    expect(b.error?.code).toBe('unauthorized');
  });

  it('rejects a forged token', async () => {
    const res = await meRoute(
      json('http://t/api/v1/auth/me', { headers: { authorization: 'Bearer not.a.jwt' } }),
      {},
    );
    expect(res.status).toBe(401);
  });

  it('does not leak whether an email exists', async () => {
    const unknown = await loginRoute(
      json('http://t/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'nobody@test.local', password, client: 'ios' }),
      }),
      {},
    );
    const wrongPw = await loginRoute(
      json('http://t/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'wrong password here', client: 'ios' }),
      }),
      {},
    );
    // Same status and same message for both, or the endpoint is an
    // account-enumeration oracle.
    expect(unknown.status).toBe(wrongPw.status);
    const a = await bodyOf(unknown);
    const b = await bodyOf(wrongPw);
    expect(a.error?.code).toBe(b.error?.code);
  });

  it('returns field-level detail on a malformed body', async () => {
    const res = await registerRoute(
      json('http://t/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'nope', password: 'short' }),
      }),
      {},
    );
    expect(res.status).toBe(422);
    const b = (await res.json()) as { error: { code: string; details: Record<string, string[]> } };
    expect(b.error.code).toBe('validation_failed');
    expect(Object.keys(b.error.details)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});

describe('refresh token rotation', () => {
  it('rotates on use and detects a replayed token as theft', async () => {
    // A fresh session of its own, so revoking it cannot disturb other tests.
    const res = await loginRoute(
      json('http://t/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, client: 'ios' }),
      }),
      {},
    );
    const first = (await bodyOf(res)).data as { refreshToken: string };
    expect(first.refreshToken).toBeTruthy();

    // 1. Using it returns a NEW refresh token.
    const r2 = await refreshRoute(
      json('http://t/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: first.refreshToken, client: 'ios' }),
      }),
      {},
    );
    expect(r2.status).toBe(200);
    const second = (await bodyOf(r2)).data as { refreshToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // 2. Replaying the FIRST token is either a replay or a theft, and the two
    //    are indistinguishable from the server. It must be refused.
    const replay = await refreshRoute(
      json('http://t/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: first.refreshToken, client: 'ios' }),
      }),
      {},
    );
    expect(replay.status).toBe(401);

    // 3. And the whole family dies with it — the token the attacker would be
    //    holding is now useless too. Losing a session beats leaving a stolen
    //    token live.
    const afterTheft = await refreshRoute(
      json('http://t/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: second.refreshToken, client: 'ios' }),
      }),
      {},
    );
    expect(afterTheft.status).toBe(401);
  });

  it('refuses a refresh token that was never issued', async () => {
    const res = await refreshRoute(
      json('http://t/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'not-a-real-token', client: 'ios' }),
      }),
      {},
    );
    expect(res.status).toBe(401);
  });
});

describe('library', () => {
  it('adds a title already present in the catalog', async () => {
    // By internal workId, not providerId. Ids are per-provider: '16498' is a
    // MyAnimeList id, and under the current primary provider (Kitsu) that
    // number identifies a completely different show. The internal id is also
    // what /search returns and what the client sends.
    const res = await libraryPost(
      json('http://t/api/v1/library', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ workId, status: 'watching' }),
      }),
      {},
    );
    expect(res.status).toBe(201);
    const b = await bodyOf(res);
    const entry = b.data as { work: { title: string }; progress: { status: string } };
    expect(entry.work.title).toBe('Attack on Titan');
    expect(entry.progress.status).toBe('watching');
  });

  it('lists only the caller rows', async () => {
    const res = await libraryGet(json('http://t/api/v1/library', { headers: authHeaders() }), {});
    const b = await bodyOf(res);
    expect((b.data as unknown[]).length).toBe(1);
  });
});

describe('sync protocol', () => {
  let cursor: string | null = null;

  it('returns a cursor and the current snapshot', async () => {
    const { data } = await doSync([]);
    expect(typeof data.cursor).toBe('string');
    expect((data.changed as unknown[]).length).toBe(1);
    cursor = data.cursor as string;
  });

  it('applies an op and advances the cursor', async () => {
    const { data } = await doSync([op(deviceA, { t: 'set_progress', workId, pass: 1, value: 5 })], cursor);
    expect((data.results as Array<{ status: string }>)[0].status).toBe('applied');
    const entry = (data.changed as Array<{ progress: { progress: number } }>)[0];
    expect(entry.progress.progress).toBe(5);
    cursor = data.cursor as string;
  });

  it('treats a replayed op as a duplicate, not a second write', async () => {
    const replayed = op(deviceA, { t: 'set_progress', workId, pass: 1, value: 9 });
    const first = await doSync([replayed], cursor);
    expect((first.data.results as Array<{ status: string }>)[0].status).toBe('applied');

    // The same op id arriving again — the normal case after a mobile timeout.
    const second = await doSync([replayed], first.data.cursor as string);
    expect((second.data.results as Array<{ status: string }>)[0].status).toBe('duplicate');
    cursor = second.data.cursor as string;
  });

  it('NEVER rewinds progress when two devices disagree', async () => {
    // The sofa/laptop case. Device B is behind and syncs last; under
    // last-write-wins it would silently undo three episodes.
    await doSync([op(deviceA, { t: 'set_progress', workId, pass: 1, value: 12 })], cursor);
    const late = await doSync([op(deviceB, { t: 'set_progress', workId, pass: 1, value: 9 })], cursor);

    const entry = (late.data.changed as Array<{ progress: { progress: number } }>)[0];
    expect(entry.progress.progress).toBe(12);
    cursor = late.data.cursor as string;
  });

  it('lets a new rewatch pass legitimately reset to zero', async () => {
    const { data } = await doSync(
      [
        op(deviceA, { t: 'complete', workId, pass: 1 }),
        op(deviceA, { t: 'start_rewatch', workId, pass: 2 }),
      ],
      cursor,
    );
    const entry = (data.changed as Array<{
      progress: { progress: number; status: string; rewatching: boolean };
    }>)[0];

    expect(entry.progress.progress).toBe(0);
    expect(entry.progress.rewatching).toBe(true);
    // Status stays completed: a rewatch must not make the completed count drop.
    expect(entry.progress.status).toBe('completed');
    cursor = data.cursor as string;
  });

  it('ignores a stale op from an older pass', async () => {
    // Device B never learned about the rewatch and replays pass-1 progress.
    // Accepting it would jump the rewatch to episode 20.
    const { data } = await doSync(
      [op(deviceB, { t: 'set_progress', workId, pass: 1, value: 20 })],
      cursor,
    );
    const rows = data.changed as Array<{ progress: { progress: number } }>;
    if (rows.length) expect(rows[0].progress.progress).toBe(0);
    cursor = data.cursor as string;
  });

  it('counts a completed rewatch', async () => {
    const { data } = await doSync([op(deviceA, { t: 'complete', workId, pass: 2 })], cursor);
    const entry = (data.changed as Array<{ progress: { rewatchCount: number } }>)[0];
    expect(entry.progress.rewatchCount).toBe(1);
    cursor = data.cursor as string;
  });

  it('reports a removal as a tombstone, not a missing row', async () => {
    const { data } = await doSync([op(deviceA, { t: 'remove', workId })], cursor);
    expect(data.deleted as string[]).toContain(workId);
    cursor = data.cursor as string;
  });

  it('rejects an unapplicable op instead of wedging the queue', async () => {
    const { data } = await doSync(
      [op(deviceA, { t: 'set_progress', workId: crypto.randomUUID(), pass: 1, value: 1 })],
      cursor,
    );
    const r = (data.results as Array<{ status: string }>)[0];
    expect(r.status).toBe('rejected');
  });

  it('requires authentication', async () => {
    const res = await syncRoute(
      json('http://t/api/v1/sync', { method: 'POST', body: JSON.stringify({ ops: [] }) }),
      {},
    );
    expect(res.status).toBe(401);
  });
});
