import { ProviderUnavailableError } from './types';

/**
 * A single global token bucket plus a persistent response cache.
 *
 * Jikan allows roughly 3 requests/second and 60/minute, unauthenticated, with
 * no way to raise it. Scattering retry logic across call sites overruns that
 * budget the moment two code paths fetch at once, so every provider request in
 * the process funnels through here.
 *
 * Note for deployment: this bucket is per-process. On a single node (which is
 * what this app runs as) that is exactly right. If this ever fans out across
 * serverless instances, the bucket has to move to Redis or the sync worker has
 * to be pinned to one instance — the cache below softens it but does not fix it.
 */

interface BucketOptions {
  ratePerSecond: number;
  perMinute: number;
}

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private minuteWindow: number[] = [];

  constructor(private readonly opts: BucketOptions) {
    this.tokens = opts.ratePerSecond;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsed = (now - this.last) / 1000;
      this.last = now;
      this.tokens = Math.min(
        this.opts.ratePerSecond,
        this.tokens + elapsed * this.opts.ratePerSecond,
      );

      this.minuteWindow = this.minuteWindow.filter((t) => now - t < 60_000);

      if (this.tokens >= 1 && this.minuteWindow.length < this.opts.perMinute) {
        this.tokens -= 1;
        this.minuteWindow.push(now);
        return;
      }

      const waitForToken = this.tokens < 1 ? (1 - this.tokens) / this.opts.ratePerSecond : 0;
      const waitForWindow =
        this.minuteWindow.length >= this.opts.perMinute
          ? (60_000 - (now - this.minuteWindow[0])) / 1000
          : 0;
      await sleep(Math.max(waitForToken, waitForWindow, 0.05) * 1000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deliberately conservative against the documented limit. Being throttled
 * costs far more than the throughput we give up: a 429 burns the budget AND
 * returns nothing.
 */
export const jikanBucket = new TokenBucket({ ratePerSecond: 2, perMinute: 50 });

/**
 * The official MyAnimeList API publishes no hard rate limit, but a first-party
 * endpoint deserves the same courtesy as a volunteer-run one. This is roomier
 * than Jikan's because it is not a scraper fronting someone else's site.
 */
export const malBucket = new TokenBucket({ ratePerSecond: 3, perMinute: 90 });

/**
 * Kitsu publishes no hard limit and is the primary source, so this is the
 * roomiest bucket — still conservative enough to be a good guest.
 */
export const kitsuBucket = new TokenBucket({ ratePerSecond: 4, perMinute: 120 });

/* ─────────────────────────── circuit breaker ─────────────────────────── */

/**
 * Stop paying the timeout once a provider is clearly down.
 *
 * Without this, every request during an outage waits out the full retry
 * budget before the caller can fall back — about 13 seconds each, so search
 * felt broken even though the fallback worked. After a few consecutive
 * failures the circuit opens and calls fail instantly, which makes degraded
 * mode feel like a mode rather than a hang.
 *
 * A single success closes it again, so recovery needs no intervention. Like
 * the token bucket, this is per-process: correct for one node, and it would
 * need to move to Redis if this ever fanned out.
 */
class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    // Two strikes, not three. One slow failure is bad luck; two in a row is a
    // pattern, and every further attempt costs a real person real seconds.
    private readonly threshold = 2,
    private readonly cooldownMs = 60_000,
  ) {}

  get isOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  /** Seconds until the next attempt is allowed, for the error message. */
  get retryInSeconds(): number {
    return Math.max(0, Math.ceil((this.openUntil - Date.now()) / 1000));
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();
const breakerFor = (provider: string): CircuitBreaker => {
  let b = breakers.get(provider);
  if (!b) {
    b = new CircuitBreaker();
    breakers.set(provider, b);
  }
  return b;
};

/** Test seam — lets the suite start from a known state. */
export function resetCircuitBreakers(): void {
  breakers.clear();
}

export interface CacheAdapter {
  get(url: string): Promise<{ body: unknown; fetchedAt: Date } | null>;
  set(url: string, body: unknown, status: number): Promise<void>;
}

export interface FetchJsonOptions {
  bucket?: TokenBucket;
  cache?: CacheAdapter;
  /** How long a cached body stays fresh. */
  ttlMs?: number;
  /** Total attempts including the first. */
  attempts?: number;
  /**
   * Per-attempt timeout. REQUIRED in spirit: Node's fetch has no default
   * timeout, so without this a stalled upstream connection hangs the request
   * forever — which on the search path means a spinner that never resolves.
   */
  timeoutMs?: number;
  provider?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Fetch JSON with caching, rate limiting and backoff.
 *
 * Retries only what is worth retrying. A 404 is an answer, not a failure, and
 * retrying it wastes budget that a genuinely transient 5xx needs.
 */
export async function fetchJson<T>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<{ data: T; cached: boolean }> {
  const {
    bucket = jikanBucket,
    cache,
    ttlMs = 6 * 60 * 60 * 1000,
    attempts = 4,
    timeoutMs = 12_000,
    provider = 'provider',
    signal,
    headers,
  } = opts;

  if (cache) {
    const hit = await cache.get(url);
    if (hit && Date.now() - hit.fetchedAt.getTime() < ttlMs) {
      return { data: hit.body as T, cached: true };
    }
  }

  // Known-down provider: skip the attempt entirely rather than burning the
  // full retry budget again. A stale cached body is still better than nothing.
  const breaker = breakerFor(provider);
  if (breaker.isOpen) {
    if (cache) {
      const stale = await cache.get(url);
      if (stale) return { data: stale.body as T, cached: true };
    }
    throw new ProviderUnavailableError(
      provider,
      `circuit open, retrying in ${breaker.retryInSeconds}s`,
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await bucket.take();
    try {
      // Combine the caller's signal (if any) with a hard per-attempt deadline.
      const deadline = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;

      const res = await fetch(url, {
        signal: combined,
        headers: { accept: 'application/json', ...headers },
      });

      if (res.status === 404) {
        // A 404 is the provider answering, so it is healthy.
        breaker.recordSuccess();
        return { data: null as T, cached: false };
      }

      if (res.status === 429) {
        // Respect the server's own pacing when it offers one.
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt);
        lastError = new Error('429 rate limited');
        continue;
      }

      if (res.status >= 500) {
        // Jikan returns 5xx when *MyAnimeList* refuses it, not when Jikan is
        // broken. Transient in practice, so it is worth a retry with backoff.
        lastError = new Error(`${res.status} upstream`);
        await sleep(Math.min(2 ** attempt * 400, 8000));
        continue;
      }

      if (!res.ok) {
        throw new ProviderUnavailableError(
          provider,
          `${res.status} ${res.statusText}`,
          false,
        );
      }

      const data = (await res.json()) as T;
      breaker.recordSuccess();
      await cache?.set(url, data, res.status).catch(() => {});
      return { data, cached: false };
    } catch (err) {
      if (err instanceof ProviderUnavailableError && !err.retryable) throw err;
      lastError = err;
      if (attempt < attempts) await sleep(Math.min(2 ** attempt * 400, 8000));
    }
  }

  breaker.recordFailure();

  // Exhausted. A stale cached body beats an error page — the user would rather
  // see yesterday's episode count than a failure.
  if (cache) {
    const stale = await cache.get(url);
    if (stale) return { data: stale.body as T, cached: true };
  }

  throw new ProviderUnavailableError(
    provider,
    `failed after ${attempts} attempts: ${String(lastError)}`,
  );
}
