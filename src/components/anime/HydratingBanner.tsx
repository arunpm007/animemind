'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * "Working out the seasons…" — and then actually come back with them.
 *
 * The first version told the user to refresh in a moment. That is the app
 * asking a person to poll it: refresh too early and the same banner appears
 * again, with no way to tell how long is long enough. For a wait the app
 * started, the app should be the one watching.
 *
 * It re-renders the server component on an interval and stops as soon as the
 * structure arrives — or after a bounded number of tries, so a franchise that
 * genuinely has nothing to derive cannot leave a tab polling forever.
 */
const INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 12; // ~30s, comfortably longer than a relation walk

export function HydratingBanner() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (attempts >= MAX_ATTEMPTS) return;
    timer.current = setTimeout(() => {
      setAttempts((n) => n + 1);
      // The server decides whether the banner still applies; if the spine has
      // arrived this component simply stops being rendered.
      router.refresh();
    }, INTERVAL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attempts, router]);

  const givenUp = attempts >= MAX_ATTEMPTS;

  return (
    <div className="pane rise mb-10 flex items-center gap-3 rounded-xl p-4">
      {givenUp ? (
        <span aria-hidden className="size-3 shrink-0 rounded-full bg-[var(--color-upcoming)]" />
      ) : (
        <span
          aria-hidden
          className="size-3 shrink-0 animate-spin rounded-full border-2 border-[var(--color-border-strong)] border-t-[var(--color-accent)]"
        />
      )}
      <div className="min-w-0">
        {givenUp ? (
          <>
            <p className="text-sm font-medium">Still working this one out.</p>
            <p className="text-[12px] text-[var(--color-dim)]">
              The anime database may be slow right now. Your library is
              unaffected — this page will fill in on its own later.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Working out the seasons…</p>
            <p className="text-[12px] text-[var(--color-dim)]">
              Reading this franchise&apos;s structure. This updates on its own.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
