import { timingSafeEqual } from 'node:crypto';
import { runSync } from '@/server/sync/worker';
import { HttpError, ok, route } from '@/server/http/api';
import { pruneRateLimits } from '@/server/http/rate-limit';
import { pruneSessions, resetDemo } from '@/server/auth/service';

// The refresh loop can take a while and must never be prerendered.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const given = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  // Length check first: timingSafeEqual throws on a mismatch, and comparing
  // with === here would leak the secret's length a byte at a time.
  return a.length === b.length && timingSafeEqual(a, b);
}

export const GET = route(async ({ req }) => {
  if (!authorised(req)) throw new HttpError('forbidden', 'Invalid cron credentials.');
  const sync = await runSync({ budget: 40 });
  // Housekeeping rides along with the daily sync.
  const [sessionsPruned, rateLimitsPruned, demo] = await Promise.all([
    pruneSessions(),
    pruneRateLimits(),
    resetDemo(),
  ]);
  return ok({ ...sync, sessionsPruned, rateLimitsPruned, demoReset: demo.reset });
});
