'use client';

import { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';

/**
 * Read once, lazily, on the client.
 *
 * Showing ⌘K to a Windows user makes the single instruction on the page
 * wrong. Resolved in a lazy initialiser rather than an effect: it never
 * changes, so an effect would only buy an extra render and a flash of the
 * wrong key.
 */
function usesCommandKey(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/**
 * What a brand-new account sees instead of an empty page.
 *
 * The old first run said "Nothing is waiting on you" above four empty counters.
 * True, and useless: nothing named the one action that starts everything, and
 * the only hint at search was a small keyboard shortcut in the sidebar — which
 * does not exist on a phone at all.
 *
 * It also sets an expectation the app otherwise fails. The payoff needs a
 * FINISHED season with an existing sequel, so adding one title changes nothing
 * visible. Without saying so, a new user reasonably concludes it is broken.
 */
export function FirstRun() {
  const [mac] = useState(usesCommandKey);

  function openSearch() {
    // The shell owns the palette; this is the same path the keyboard takes.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  }

  return (
    <div className="rise mb-14 flex flex-col gap-5">
      <button
        type="button"
        onClick={openSearch}
        className="pane group flex items-center gap-4 rounded-xl p-5 text-left transition-colors duration-[160ms] hover:border-[var(--color-border-strong)]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]">
          <Search className="size-4 text-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">
            Add something you&apos;ve watched
          </span>
          <span className="mt-0.5 block text-[13px] text-[var(--color-dim)]">
            Search for it, say where you got to, and you never have to remember
            again.
          </span>
        </span>
        <kbd className="hidden shrink-0 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-mute)] sm:block">
          {mac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <div className="flex gap-3 px-1">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--color-accent)]" />
        <p className="text-[13px] leading-relaxed text-[var(--color-dim)]">
          Add a few things you&apos;ve <em className="not-italic text-[var(--color-text)]">finished</em>,
          not just what you&apos;re watching now. That&apos;s how this page starts
          telling you which sequels have aired and which ones you&apos;re still
          waiting on.
        </p>
      </div>
    </div>
  );
}
