'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * The last line of defence.
 *
 * Without this, an unhandled server error renders Next's raw error page: no
 * branding, no navigation, and — in production — a blank screen that gives
 * the user nothing to do and tells them nothing about their data.
 *
 * The reassurance matters as much as the retry. In an app whose whole value
 * is remembering things for you, an error screen that says nothing invites
 * the worst assumption.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span aria-hidden className="size-2 rounded-full bg-[var(--color-ended)]" />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">AnimeMind</span>
        </div>

        <h1 className="t-title mb-3">Something went wrong.</h1>
        <p className="mb-6 text-sm leading-relaxed text-[var(--color-dim)]">
          This is our problem, not yours — and nothing in your library has been
          lost. Try again, and if it keeps happening the reference below will
          help track it down.
        </p>

        <div className="mb-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-accent)]"
          >
            <RotateCcw className="size-3.5" />
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
          >
            Back to Today
          </Link>
        </div>

        {error.digest ? (
          <p className="font-mono text-[10px] text-[var(--color-mute)]">
            reference {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
