import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { unscoped } from '../db/client';
import { HttpError } from './api';

/**
 * Per-route rate limits, backed by Postgres (see drizzle/_post/0007_rate_limit.sql).
 *
 * Why these exist: sign-in verifies an argon2 hash on every attempt, which is
 * deliberately slow. Without a limit that is both an unlimited password-
 * guessing oracle and a cheap way to burn the server's CPU. Search reaches a
 * third-party API and writes catalog rows, so it needs a ceiling too.
 */

export interface Rule {
  /** Bucket name, e.g. "login:ip". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RULES = {
  loginPerIp: { name: 'login:ip', limit: 20, windowSeconds: 15 * 60 },
  // Per-account: slows a targeted guess at one email even across many IPs.
  loginPerEmail: { name: 'login:email', limit: 8, windowSeconds: 15 * 60 },
  registerPerIp: { name: 'register:ip', limit: 5, windowSeconds: 60 * 60 },
  refreshPerIp: { name: 'refresh:ip', limit: 120, windowSeconds: 15 * 60 },
  passwordPerUser: { name: 'password:user', limit: 5, windowSeconds: 15 * 60 },
  demoPerIp: { name: 'demo:ip', limit: 10, windowSeconds: 60 * 60 },
  searchPerIp: { name: 'search:ip', limit: 40, windowSeconds: 60 },
  // Every tick, add and status change is a sync. 120 a minute is far above a
  // person clicking, and far below a script hammering the database.
  syncPerUser: { name: 'sync:user', limit: 120, windowSeconds: 60 },
} satisfies Record<string, Rule>;

/**
 * The caller's IP, from the header the host sets.
 *
 * Only trust a header your host overwrites — a client can send any header it
 * likes. Vercel sets `x-real-ip` itself, so that is the default. Override with
 * CLIENT_IP_HEADER on other hosts (e.g. `cf-connecting-ip` behind Cloudflare).
 */
export function clientIp(req: Request): string {
  const header = (process.env.CLIENT_IP_HEADER || 'x-real-ip').toLowerCase();
  const value = req.headers.get(header)?.split(',')[0]?.trim();
  return value || 'unknown';
}

const keyFor = (rule: Rule, subject: string) =>
  createHash('sha256').update(`${rule.name}\u0000${subject.toLowerCase()}`).digest('hex');

/**
 * Count one hit against `rule` for `subject`; throw 429 when over the limit.
 * Fails open on a database error: a rate limiter that takes sign-in down with
 * it is worse than one that briefly lets traffic through.
 */
export async function enforce(rule: Rule, subject: string): Promise<void> {
  let retryAfter = 0;
  try {
    const rows = await unscoped().execute<{ wait: number }>(
      sql`SELECT take_rate_limit(${keyFor(rule, subject)}, ${rule.limit}, ${rule.windowSeconds}) AS wait`,
    );
    retryAfter = Number(rows[0]?.wait ?? 0);
  } catch (err) {
    console.error(`rate limit check failed for ${rule.name} (allowing request):`, err);
    return;
  }
  if (retryAfter > 0) {
    const minutes = Math.ceil(retryAfter / 60);
    throw new HttpError(
      'rate_limited',
      retryAfter < 90
        ? 'Too many attempts. Please wait a moment and try again.'
        : `Too many attempts. Please try again in about ${minutes} minutes.`,
      undefined,
      retryAfter,
    );
  }
}

/** Housekeeping for the cron job. */
export async function pruneRateLimits(): Promise<number> {
  const rows = await unscoped().execute<{ n: number }>(sql`SELECT prune_rate_limits() AS n`);
  return Number(rows[0]?.n ?? 0);
}
