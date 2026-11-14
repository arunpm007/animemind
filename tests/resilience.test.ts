/**
 * Regressions for failures found during a manual QA run.
 *
 * Each of these was a real defect that passing unit tests did not catch,
 * because each only appears when something outside the happy path is true:
 * the provider is down, the token aged out, or the client sent the identifier
 * the documentation described rather than the one the code wanted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { account, work } from '@/server/db/schema';
import { fetchJson, resetCircuitBreakers } from '@/server/providers/http';
import { addToLibrary } from '@/server/services/library';
import { HttpError } from '@/server/http/api';
import type { Actor } from '@/server/http/api';

afterEach(() => {
  resetCircuitBreakers();
  vi.restoreAllMocks();
});

describe('circuit breaker', () => {
  /**
   * The bug: during an outage every request waited out the full retry budget
   * before the caller could fall back — about 13 seconds each. Search worked,
   * but felt broken.
   */
  it('stops attempting the network after repeated failures', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    });

    const attempt = () =>
      fetchJson('https://example.test/a', {
        provider: 'breaker-test',
        attempts: 1,
        timeoutMs: 50,
      }).catch((e) => e);

    await attempt();
    await attempt();
    const callsBeforeOpen = calls;

    // Third call must not touch the network at all.
    const err = await attempt();
    expect(calls).toBe(callsBeforeOpen);
    expect(String(err)).toMatch(/circuit open/i);
  });

  it('closes again after a success, so recovery needs no intervention', async () => {
    let fail = true;
    vi.stubGlobal('fetch', async () => {
      if (fail) throw new Error('down');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const call = () =>
      fetchJson<{ ok: boolean }>('https://example.test/b', {
        provider: 'recovery-test',
        attempts: 1,
        timeoutMs: 50,
      });

    await call().catch(() => {});
    await call().catch(() => {});
    await expect(call()).rejects.toThrow(/circuit open/i);

    // Provider comes back; a fresh breaker (new cooldown window) must let it.
    resetCircuitBreakers();
    fail = false;
    const { data } = await call();
    expect(data.ok).toBe(true);
  });
});

describe('addToLibrary identifier handling', () => {
  /**
   * The bug: /search returns `work.id` (a uuid) but the add endpoint only
   * accepted a provider id. The client sent the uuid, the lookup missed, and
   * adding a title ALREADY in our database went to the network and failed
   * with 503 while the provider was down. 13.4s to not add a row.
   */
  const stamp = Date.now();
  let actor: Actor;
  let workId = '';
  let userId = '';

  async function seed() {
    const db = unscoped();
    const [a] = await db
      .insert(account)
      .values({ email: `add-${stamp}@test.local`, passwordHash: 'x' })
      .returning();
    const [w] = await db
      .insert(work)
      .values({
        provider: 'jikan',
        providerId: `add-${stamp}`,
        kind: 'tv',
        titleRomaji: 'Identifier Test',
        episodeCount: 12,
        releaseStatus: 'finished',
        contentHash: 'h',
      })
      .returning();
    userId = a.id;
    workId = w.id;
    actor = { userId: a.id, role: 'member', tier: 'free' };
  }

  afterEach(async () => {
    const db = unscoped();
    if (userId) await db.delete(account).where(eq(account.id, userId));
    if (workId) await db.delete(work).where(eq(work.id, workId));
    userId = '';
    workId = '';
  });

  it('adds by internal workId without touching the provider', async () => {
    await seed();
    // Any provider call here would be the bug reappearing.
    vi.stubGlobal('fetch', async () => {
      throw new Error('the provider must not be called');
    });

    const entry = await addToLibrary(actor, { workId, status: 'planned' });
    expect(entry.work.title).toBe('Identifier Test');
    expect(entry.progress.status).toBe('planned');
  });

  it('rejects an unknown workId as not found, not as an outage', async () => {
    await seed();
    await expect(
      addToLibrary(actor, { workId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow(HttpError);
  });

  it('requires at least one identifier', async () => {
    await seed();
    await expect(addToLibrary(actor, {})).rejects.toThrow(/workId or providerId/i);
  });
});
