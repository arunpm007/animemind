import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * A wrong URL should not be a dead end.
 *
 * Next's default 404 is an unstyled black page with no navigation — from a
 * user's side, the app has simply vanished. A series slug that no longer
 * resolves (a merged duplicate, a stale bookmark) is a normal event, not a
 * catastrophe, and the way back should be obvious.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="size-2 rounded-full bg-[var(--color-accent)]"
            style={{ boxShadow: '0 0 16px var(--color-accent)' }}
          />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">AnimeMind</span>
        </div>

        <h1 className="t-title mb-3">That page isn&apos;t here.</h1>
        <p className="mb-7 text-sm leading-relaxed text-[var(--color-dim)]">
          The link may be old, or the series may have been merged with another
          entry. Your library is untouched.
        </p>

        <div className="flex items-center justify-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white"
          >
            <ArrowLeft className="size-3.5" />
            Back to Today
          </Link>
          <Link
            href="/library"
            className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
          >
            Your library
          </Link>
        </div>
      </div>
    </main>
  );
}
