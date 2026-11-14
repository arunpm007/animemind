import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AuthResult, ClientKind, SessionUser } from '@/contracts';
import { unscoped } from '../db/client';
import { account, authSession } from '../db/schema';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './tokens';

export class AuthError extends Error {
  constructor(
    public readonly code: 'invalid_credentials' | 'email_taken' | 'invalid_refresh',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * OWASP-recommended argon2id parameters. Tuned so a single verify costs ~50ms
 * on this machine: slow enough to make offline cracking expensive, fast enough
 * that sign-in still feels instant.
 */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

function toSessionUser(row: typeof account.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    tier: row.tier,
    createdAt: row.createdAt.toISOString(),
  };
}

async function issue(
  user: typeof account.$inferSelect,
  client: ClientKind,
  deviceLabel: string | undefined,
  familyId: string,
): Promise<AuthResult> {
  const db = unscoped();
  const refreshToken = generateRefreshToken();

  await db.insert(authSession).values({
    userId: user.id,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    client,
    deviceLabel: deviceLabel ?? null,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });

  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    tier: user.tier,
  });

  return {
    user: toSessionUser(user),
    accessToken,
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken,
  };
}

export async function register(input: {
  email: string;
  password: string;
  displayName?: string;
  client: ClientKind;
  deviceLabel?: string;
}): Promise<AuthResult> {
  const db = unscoped();
  const email = input.email.trim().toLowerCase();

  const existing = await db.query.account.findFirst({
    where: eq(account.email, email),
  });
  if (existing) throw new AuthError('email_taken', 'That email is already registered.');

  const passwordHash = await hash(input.password, ARGON);
  const [row] = await db
    .insert(account)
    .values({ email, passwordHash, displayName: input.displayName ?? null })
    .returning();

  return issue(row, input.client, input.deviceLabel, randomUUID());
}

export async function login(input: {
  email: string;
  password: string;
  client: ClientKind;
  deviceLabel?: string;
}): Promise<AuthResult> {
  const db = unscoped();
  const email = input.email.trim().toLowerCase();

  const row = await db.query.account.findFirst({ where: eq(account.email, email) });

  if (!row) {
    // Verify against a dummy hash anyway. Returning early on an unknown email
    // makes sign-in measurably faster for non-existent accounts, which turns
    // the endpoint into an account-enumeration oracle.
    await verify(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$YQjBnZ0vI0m3v7jJQ2gZ9KqL8xqXvQ0wYQ0hZ0Zt0Zo',
      input.password,
      ARGON,
    ).catch(() => false);
    throw new AuthError('invalid_credentials', 'Email or password is incorrect.');
  }

  const ok = await verify(row.passwordHash, input.password, ARGON).catch(() => false);
  if (!ok) throw new AuthError('invalid_credentials', 'Email or password is incorrect.');

  return issue(row, input.client, input.deviceLabel, randomUUID());
}

/**
 * Rotate a refresh token.
 *
 * Each token is single-use. Presenting one that was already rotated away means
 * either a replay or a theft, and the two are indistinguishable from here — so
 * the whole family is revoked and every device on that session is signed out.
 * Losing a session is a mild annoyance; leaving a stolen token live is not.
 */
export async function refresh(input: {
  refreshToken: string;
  client: ClientKind;
}): Promise<AuthResult> {
  const db = unscoped();
  const tokenHash = hashRefreshToken(input.refreshToken);

  const row = await db.query.authSession.findFirst({
    where: eq(authSession.tokenHash, tokenHash),
  });
  if (!row) throw new AuthError('invalid_refresh', 'Session expired. Sign in again.');

  if (row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    await db
      .update(authSession)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSession.familyId, row.familyId), isNull(authSession.revokedAt)));
    throw new AuthError('invalid_refresh', 'Session expired. Sign in again.');
  }

  const user = await db.query.account.findFirst({ where: eq(account.id, row.userId) });
  if (!user) throw new AuthError('invalid_refresh', 'Session expired. Sign in again.');

  await db
    .update(authSession)
    .set({ revokedAt: new Date() })
    .where(eq(authSession.id, row.id));

  return issue(user, input.client, row.deviceLabel ?? undefined, row.familyId);
}

export async function logout(refreshToken: string): Promise<void> {
  const db = unscoped();
  const row = await db.query.authSession.findFirst({
    where: eq(authSession.tokenHash, hashRefreshToken(refreshToken)),
  });
  if (!row) return;
  // Revoke the family, not just this token: "sign out" should mean the session
  // is over, including any token already rotated out on another tab.
  await db
    .update(authSession)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSession.familyId, row.familyId), isNull(authSession.revokedAt)));
}

/** Housekeeping for the cron job. */
export async function pruneSessions(): Promise<number> {
  const db = unscoped();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(authSession)
    .where(or(lt(authSession.expiresAt, new Date()), lt(authSession.revokedAt, cutoff)))
    .returning({ id: authSession.id });
  return deleted.length;
}
