/**
 * Integration test: per-user isolation is enforced by Postgres itself.
 *
 * This is the test that must never be deleted. Every other guarantee in the
 * app is a convenience; this one is the difference between a private library
 * and a data breach. It runs against the real database because RLS cannot be
 * meaningfully mocked — the whole point is that the *database* refuses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const APP_URL =
  process.env.DATABASE_URL ??
  'postgres://animemind_app:animemind_app@localhost:55432/animemind';
const OWNER_URL =
  process.env.DATABASE_MIGRATION_URL ??
  'postgres://animemind:animemind@localhost:55432/animemind';

let app: postgres.Sql;
let owner: postgres.Sql;
let reachable = true;

let alice = '';
let bob = '';
let workId = '';

beforeAll(async () => {
  app = postgres(APP_URL, { max: 2, onnotice: () => {} });
  owner = postgres(OWNER_URL, { max: 2, onnotice: () => {} });
  try {
    await app`SELECT 1`;
  } catch {
    reachable = false;
    return;
  }

  const stamp = Date.now();
  [{ id: alice }] = await app<{ id: string }[]>`
    INSERT INTO account (email, password_hash)
    VALUES (${`alice-${stamp}@test.local`}, 'x') RETURNING id`;
  [{ id: bob }] = await app<{ id: string }[]>`
    INSERT INTO account (email, password_hash)
    VALUES (${`bob-${stamp}@test.local`}, 'x') RETURNING id`;
  [{ id: workId }] = await app<{ id: string }[]>`
    INSERT INTO work (provider, provider_id, title_romaji, kind)
    VALUES ('jikan', ${`t-${stamp}`}, 'Test Work', 'tv') RETURNING id`;

  for (const uid of [alice, bob]) {
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${uid}, true)`;
      await tx`INSERT INTO user_work (user_id, work_id, status, progress)
               VALUES (${uid}, ${workId}, 'watching', ${uid === alice ? 7 : 3})`;
    });
  }
});

afterAll(async () => {
  if (reachable) {
    await owner`DELETE FROM account WHERE id = ANY(${[alice, bob]})`;
    await owner`DELETE FROM work WHERE id = ${workId}`;
  }
  await app?.end();
  await owner?.end();
});

describe('row-level security', () => {
  it.runIf(reachable)('shows a user only their own rows', async () => {
    const rows = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${alice}, true)`;
      return tx`SELECT user_id, progress FROM user_work WHERE work_id = ${workId}`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(alice);
    expect(rows[0].progress).toBe(7);
  });

  it.runIf(reachable)('returns nothing when no identity is set', async () => {
    const rows = await app`SELECT * FROM user_work WHERE work_id = ${workId}`;
    expect(rows).toHaveLength(0);
  });

  it.runIf(reachable)('cannot read another user even with an explicit WHERE', async () => {
    // The attack this defends against: a handler that trusts a client-supplied
    // user id. The policy overrides the predicate.
    const rows = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${alice}, true)`;
      return tx`SELECT * FROM user_work WHERE user_id = ${bob}`;
    });
    expect(rows).toHaveLength(0);
  });

  it.runIf(reachable)('cannot write a row attributed to another user', async () => {
    await expect(
      app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${alice}, true)`;
        await tx`INSERT INTO user_work (user_id, work_id, status)
                 VALUES (${bob}, ${workId}, 'planned')`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it.runIf(reachable)('cannot update across the boundary', async () => {
    const res = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${alice}, true)`;
      return tx`UPDATE user_work SET progress = 999 WHERE user_id = ${bob} RETURNING *`;
    });
    expect(res).toHaveLength(0);

    const check = await owner`SELECT progress FROM user_work
                              WHERE user_id = ${bob} AND work_id = ${workId}`;
    expect(check[0].progress).toBe(3);
  });

  it.runIf(reachable)('does not leak identity between pooled transactions', async () => {
    // set_config(..., true) is transaction-local. If it were session-local, a
    // pooled connection would carry Alice's identity into Bob's next request.
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${alice}, true)`;
      await tx`SELECT 1`;
    });
    const leaked = await app`SELECT * FROM user_work WHERE work_id = ${workId}`;
    expect(leaked).toHaveLength(0);
  });
});

describe('sync cursor', () => {
  it.runIf(reachable)('advances monotonically on every write', async () => {
    const seqs = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${alice}, true)`;
      const out: number[] = [];
      for (const p of [8, 9, 10]) {
        const r = await tx<{ updated_seq: string }[]>`
          UPDATE user_work SET progress = ${p}
          WHERE user_id = ${alice} AND work_id = ${workId}
          RETURNING updated_seq`;
        out.push(Number(r[0].updated_seq));
      }
      return out;
    });
    expect(seqs[1]).toBeGreaterThan(seqs[0]);
    expect(seqs[2]).toBeGreaterThan(seqs[1]);
  });
});
