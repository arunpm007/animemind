'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import type { SearchResult } from '@/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { StatusDot } from '@/components/ui/primitives';

/**
 * Search is the screen that answers "have I already seen this?", so the
 * `✓ In your library` marker is the most important pixel in the product. It is
 * rendered from data the search endpoint already returns, so the answer
 * arrives with the results rather than after a second round trip.
 */
/**
 * Mounted only while open, so a fresh mount is the reset. Clearing state in an
 * effect keyed on an `open` prop is the usual way to write this and it is
 * wrong: it costs a cascading render every time the dialog toggles, and React
 * now lints against it.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const seq = useRef(0);

  useEffect(() => {
    // rAF: focusing during the same frame the dialog mounts loses the caret in
    // Safari.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;

    const id = ++seq.current;
    // setState lives inside the timer, not the effect body: the effect only
    // schedules work, and the spinner appears when the request actually starts
    // rather than flashing for every keystroke a fast typist makes.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const envelope = await api.getEnvelope<SearchResult[]>(
          `/search?q=${encodeURIComponent(term)}&limit=12`,
        );
        // Drop a response that a newer keystroke has already superseded;
        // otherwise a slow request can overwrite fresher results.
        if (id !== seq.current) return;
        setResults(envelope.data);
        setDegraded(Boolean(envelope.meta?.degraded));
        setError(null);
        setCursor(0);
      } catch (err) {
        if (id !== seq.current) return;
        setError(
          err instanceof ApiRequestError
            ? err.payload.message
            : 'Search is unavailable right now.',
        );
        setResults([]);
        setDegraded(false);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 280); // long enough to skip intermediate keystrokes, short enough to feel live

    return () => clearTimeout(timer);
  }, [q]);

  const add = useCallback(
    async (r: SearchResult) => {
      setAdded((prev) => new Set(prev).add(r.id));
      setAddError(null);
      try {
        // r.id is our internal work id — no provider round-trip needed.
        await api.post('/library', { workId: r.id, status: 'planned' });
        startTransition(() => router.refresh());
      } catch (err) {
        // Roll back AND say so. Silently reverting the tick leaves the user
        // watching a row flip back with no explanation, which reads as the
        // app losing their input rather than a request that failed.
        setAdded((prev) => {
          const next = new Set(prev);
          next.delete(r.id);
          return next;
        });
        setAddError(
          err instanceof ApiRequestError
            ? `Could not add ${r.title}: ${err.payload.message}`
            : `Could not add ${r.title}. Check your connection.`,
        );
      }
    },
    [router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (e.key === 'Enter' && results[cursor]) {
        e.preventDefault();
        void add(results[cursor]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, cursor, onClose, add]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search anime"
    >
      <button
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fade absolute inset-0 cursor-default bg-[hsl(230_25%_2%/0.72)] backdrop-blur-sm"
      />

      <div className="pane-raised rise relative w-full max-w-xl overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-[var(--color-mute)]" />
          ) : (
            <Search className="size-4 shrink-0 text-[var(--color-mute)]" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for an anime…"
            className="flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-[var(--color-mute)]"
          />
          <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-mute)]">
            esc
          </kbd>
        </div>

        {addError ? (
          <p
            role="alert"
            className="border-b border-[var(--color-border)] bg-[var(--color-ended)]/10 px-4 py-2 text-[11px] text-[var(--color-ended)]"
          >
            {addError}
          </p>
        ) : null}

        {degraded ? (
          <p className="border-b border-[var(--color-border)] bg-[var(--color-upcoming)]/8 px-4 py-2 text-[11px] text-[var(--color-upcoming)]">
            The anime database is unreachable — searching titles you already
            have. New titles will appear once it is back.
          </p>
        ) : null}

        <div className="max-h-[52vh] overflow-y-auto">
          {error ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-dim)]">
              {error}
            </p>
          ) : null}

          {!error && !loading && q.trim().length >= 2 && results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-dim)]">
              Nothing found for “{q.trim()}”.
            </p>
          ) : null}

          {q.trim().length >= 2 ? results.map((r, i) => {
            const owned = r.inLibrary || added.has(r.id);
            return (
              <div
                key={r.id}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 transition-colors duration-[160ms]',
                  i === cursor && 'bg-[var(--color-overlay)]',
                )}
              >
                <div className="relative h-14 w-[38px] shrink-0 overflow-hidden rounded-[3px] bg-[var(--color-raised)]">
                  {r.coverUrl ? (
                    <Image src={r.coverUrl} alt="" fill sizes="38px" className="object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-mute)]">
                    <span className="uppercase">{r.kind}</span>
                    {r.episodeCount ? <span>· {r.episodeCount} eps</span> : null}
                    {r.seasonYear ? <span>· {r.seasonYear}</span> : null}
                    <StatusDot status={r.status} short />
                  </div>
                </div>

                {owned ? (
                  // The answer to the question that started this project.
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-airing)]/30 px-2.5 py-1 text-[11px] text-[var(--color-airing)]">
                    <Check className="size-3" />
                    In your library
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void add(r)}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-white transition-transform duration-[160ms] ease-[var(--ease-state)] active:scale-95"
                  >
                    <Plus className="size-3" />
                    Add
                  </button>
                )}
              </div>
            );
          }) : null}
        </div>

        {q.trim().length >= 2 && results.length > 0 ? (
          <div className="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-mute)]">
            <span>↑↓ navigate</span>
            <span>↵ add</span>
            <span>esc close</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
