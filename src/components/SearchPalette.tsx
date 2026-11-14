'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import type { SearchResult } from '@/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { AddSheet } from '@/components/anime/AddSheet';
import { PosterImage } from '@/components/ui/PosterImage';
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
  const [sheetFor, setSheetFor] = useState<SearchResult | null>(null);
  const [cursor, setCursor] = useState(0);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);
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

  // Opening the sheet, not adding. One click used to file everything as
  // "plan to watch", which is the wrong answer for anything you have already
  // seen — and correcting it afterwards, per title, is exactly the work this
  // product exists to remove.
  const add = useCallback((r: SearchResult) => {
    setAddError(null);
    setSheetFor(r);
  }, []);

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
        add(results[cursor]);
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

        <div className="max-h-[58vh] overflow-y-auto">
          {error ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-dim)]">
              {error}
            </p>
          ) : null}

          {!error && !loading && q.trim().length >= 2 && results.length === 0 ? (
            degraded ? (
              // "Nothing found" is a claim about the world and we are in no
              // position to make it: the catalog only holds what has already
              // been looked up, and the provider is unreachable. Saying it
              // anyway tells the user their anime does not exist, which is
              // both wrong and the most discouraging thing we could say.
              <div className="px-5 py-7 text-center">
                <p className="mb-1.5 text-sm">
                  Not in your library yet.
                </p>
                <p className="text-xs leading-relaxed text-[var(--color-dim)]">
                  We can&apos;t reach the anime database to look up
                  &ldquo;{q.trim()}&rdquo; right now. It will be findable once
                  the database is back.
                </p>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-[var(--color-dim)]">
                Nothing found for &ldquo;{q.trim()}&rdquo;.
              </p>
            )
          ) : null}

          {q.trim().length >= 2
            ? results.map((r, i) => {
                const owned = r.inLibrary || added.has(r.id);
                const state = r.libraryStatus;
                return (
                  // The whole row is the target. A 70px button was the only
                  // way in, which made a list of large posters feel inert.
                  <button
                    key={r.id}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => add(r)}
                    className={cn(
                      'flex w-full items-center gap-3.5 px-3 py-3 text-left transition-colors duration-[160ms]',
                      i === cursor
                        ? 'bg-[var(--color-overlay)]'
                        : 'hover:bg-[var(--color-surface)]',
                    )}
                  >
                    <div className="relative h-[72px] w-[50px] shrink-0 overflow-hidden rounded-[5px] bg-[var(--color-raised)] shadow-[var(--edge-light),var(--shadow-1)]">
                      {/* Not a raw next/image: it THROWS on a host missing
                          from remotePatterns, taking the whole page down. */}
                      <PosterImage src={r.coverUrl} title={r.title} sizes="50px" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-snug font-medium">
                        {r.title}
                      </p>
                      {/* The original title, when it differs — half of
                          searching is recognising the name you knew it by. */}
                      {r.titleEnglish && r.titleEnglish !== r.title ? (
                        <p className="truncate text-[11px] text-[var(--color-mute)]">
                          {r.titleEnglish}
                        </p>
                      ) : null}

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-mute)]">
                        <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 uppercase">
                          {r.kind}
                        </span>
                        {r.seasonYear ? <span>{r.seasonYear}</span> : null}
                        {r.episodeCount ? <span>· {r.episodeCount} eps</span> : null}
                        <StatusDot status={r.status} short />
                      </div>
                    </div>

                    <span className="shrink-0">
                      {owned ? (
                        // The answer to the question that started this
                        // project — and it names the state, because "already
                        // in there somewhere" is not what anyone wants to know.
                        <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-airing)]/30 bg-[var(--color-airing)]/10 px-2.5 py-1 text-[11px] text-[var(--color-airing)]">
                          <Check className="size-3" />
                          {state === 'watching'
                            ? 'Watching'
                            : state === 'completed'
                              ? 'Watched'
                              : state === 'planned'
                                ? 'Planned'
                                : state === 'on_hold'
                                  ? 'On hold'
                                  : state === 'dropped'
                                    ? 'Dropped'
                                    : 'In library'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-white">
                          <Plus className="size-3" />
                          Add
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            : null}
        </div>

        {q.trim().length >= 2 && results.length > 0 ? (
          <div className="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-mute)]">
            <span>↑↓ navigate</span>
            <span>↵ choose</span>
            <span>esc close</span>
          </div>
        ) : null}
      </div>

      {sheetFor ? (
        <AddSheet
          result={sheetFor}
          onClose={() => setSheetFor(null)}
          onAdded={(workId) => setAdded((prev) => new Set(prev).add(workId))}
        />
      ) : null}
    </div>
  );
}
