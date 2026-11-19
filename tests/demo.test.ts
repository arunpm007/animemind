/**
 * The public demo account and the sign-up switch.
 *
 * Guarantees under test: the demo is reachable only through the demo door
 * (never by password, never by registering its address), it cannot change its
 * own credentials, and the nightly reset really does undo visitor changes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { asUser, unscoped } from '@/server/db/client';
import { account, authSession, userWork } from '@/server/db/schema';
import { signupsOpen } from '@/server/auth/config';
import {
  AuthError,
  changePassword,
  login,
  loginDemo,
  register,
  resetDemo,
  updateProfile,
} from '@/server/auth/service';
import { PROGRESS } from '@/server/demo/sample-library';

const DEMO = `demo-${Date.now()}@test.local`;
const saved = { demo: process.env.DEMO_EMAIL, signups: process.env.ALLOW_SIGNUPS };

beforeAll(() => {
  process.env.DEMO_EMAIL = DEMO;
});

afterEach(() => {
  if (saved.signups === undefined) delete process.env.ALLOW_SIGNUPS;
  else process.env.ALLOW_SIGNUPS = saved.signups;
});

afterAll(async () => {
  if (saved.demo === undefined) delete process.env.DEMO_EMAIL;
  else process.env.DEMO_EMAIL = saved.demo;
  await unscoped().delete(account).where(eq(account.email, DEMO));
});

describe('sign-up switch', () => {
  it('respects ALLOW_SIGNUPS explicitly', () => {
    process.env.ALLOW_SIGNUPS = 'false';
    expect(signupsOpen()).toBe(false);
    process.env.ALLOW_SIGNUPS = 'true';
    expect(signupsOpen()).toBe(true);
  });
});

describe('demo account', () => {
  it('signs in with one call, creating and seeding the account on first use', async () => {
    const result = await loginDemo('web');
    expect(result.user.email).toBe(DEMO);
    expect(result.accessToken).toBeTruthy();

    const rows = await asUser(result.user.id, (tx) =>
      tx.select().from(userWork).where(eq(userWork.userId, result.user.id)),
    );
    expect(rows.length).toBe(Object.keys(PROGRESS).length);
  });

  it('cannot be signed in to with a password', async () => {
    const err = await login({ email: DEMO, password: 'anything-at-all-123', client: 'web' }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('invalid_credentials');
  });

  it('cannot be taken over by registering its address', async () => {
    const err = await register({ email: DEMO.toUpperCase(), password: 'a-long-password-1', client: 'web' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('email_taken');
  });

  it('cannot change its password or name', async () => {
    const { user } = await loginDemo('web');
    const pw = await changePassword({ userId: user.id, currentPassword: 'x', newPassword: 'y'.repeat(12) }).catch(
      (e) => e,
    );
    expect(pw.code).toBe('demo_readonly');
    const name = await updateProfile({ userId: user.id, displayName: 'pwned' }).catch((e) => e);
    expect(name.code).toBe('demo_readonly');
  });

  it('nightly reset restores the sample library and ends demo sessions', async () => {
    const { user } = await loginDemo('web');
    // A visitor empties the library…
    await asUser(user.id, (tx) => tx.delete(userWork).where(eq(userWork.userId, user.id)));

    await expect(resetDemo()).resolves.toEqual({ reset: true });

    const rows = await asUser(user.id, (tx) =>
      tx.select().from(userWork).where(eq(userWork.userId, user.id)),
    );
    expect(rows.length).toBe(Object.keys(PROGRESS).length);

    const live = await unscoped()
      .select()
      .from(authSession)
      .where(and(eq(authSession.userId, user.id), isNull(authSession.revokedAt)));
    expect(live).toHaveLength(0);
  });
});
