'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ArrowRight, Check, CornerDownRight, Loader2 } from 'lucide-react';
import type { LibraryEntry, SearchResult, WatchStateDto } from '@/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { makeOp } from '@/lib/op';
import { cn } from '@/lib/cn';
import { useDialog } from '@/lib/useDialog';
import { PosterImage } from '@/components/ui/PosterImage';

/**
 * "Where are you with this?"
 *
 * The product promise is *tell it once*, and the old one-click Add could not
 * express the only thing most people need to say: "I have already watched
 * this." Everything went in as `planned`, so a back catalogue of finished
 * shows had to be corrected one title at a time, afterwards.
 *
 * Deliberately scoped to the title you picked. The seasons either side of it
 * are not known yet — the relation walk takes a few seconds — so promising a
 * season picker here would mean either blocking on it or showing an empty one.
 * Instead this captures the state that search already has enough information
 * for, then offers the series page, where every season is editable.
 */

/**
 * Each choice says WHERE the title will turn up.
 *
 * "Plan to watch" and "On hold" are abstract until you know what they do to
 * the app. Naming the destination turns a form into an explanation, and it is
 * the cheapest way to teach the four screens — people learn the structure by
 * filing one thing.
 */
const CHOICES: Array<{
  value: WatchStateDto;
  label: string;
  hint: string;
  destination: string;
}> = [
  {
    value: 'planned',
    label: 'Plan to watch',
    hint: "Haven't started it",
    // These two used to say "Library", which was true and useless: the
    // library is a poster wall sorted by recency, so neither state was
    // actually findable once it got there.
    destination: 'Up next → Ready to start',
  },
  {
    value: 'watching',
    label: 'Currently watching',
    hint: 'Partway through',
    destination: 'Today → Continue watching',
  },
  {
    value: 'completed',
    label: 'Already watched',
    hint: 'Seen all of it',
    destination: 'Library · and Waiting, if a sequel is coming',
  },
  { value: 'on_hold', label: 'On hold', hint: 'Paused', destination: 'Up next → Paused' },
  { value: 'dropped', label: 'Dropped', hint: 'Not continuing', destination: 'Library' },
];

export function AddSheet({
  result,
  onClose,
  onAdded,
}: {
  result: SearchResult;
  onClose: () => void;
  onAdded?: (workId: string) => void;
}) {
  /**
   * Already held, so this is an EDIT.
   *
   * The sheet previously had no idea: clicking a result marked "Watching"
   * reopened an empty "Add to library" form, offering to file something the
   * user had just filed. It read as the app having forgotten, which in an app
   * whose entire promise is remembering is about the worst impression
   * available.
   */
  const held = result.inLibrary;

  // Start from where they actually are, not from a default.
  const [choice, setChoice] = useState<WatchStateDto>(
    result.libraryStatus ?? 'planned',
  );
  const [episode, setEpisode] = useState(
    String(result.libraryProgress && result.libraryProgress > 0 ? result.libraryProgress : 1),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null | undefined>(undefined);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel);

  const total = result.episodeCount;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // 1. Create the row. `completed` is set through the sync op below rather
      //    than here, so that it fills progress and closes a watch session —
      //    the same path a user clicking "Completed" takes.
      const entry = await api.post<LibraryEntry>('/library', {
        workId: result.id,
        status: choice === 'completed' ? 'watching' : choice,
      });

      // 2. Say where they actually are.
      const ops = [];
      if (choice === 'watching') {
        const n = Math.max(0, Number(episode) || 0);
        ops.push(
          makeOp({ t: 'set_progress', workId: result.id, pass: 1, value: n }),
        );
      } else if (choice === 'completed') {
        ops.push(makeOp({ t: 'complete', workId: result.id, pass: 1 }));
      }
      if (ops.length) await api.post('/sync', { ops });

      setSavedSlug(entry.seriesSlug);
      onAdded?.(result.id);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.payload.message
          : 'Could not save. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={held ? `Update ${result.title}` : `Add ${result.title}`}
    >
      <button
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fade absolute inset-0 cursor-default bg-[hsl(230_25%_2%/0.78)] backdrop-blur-sm"
      />

      <div
        ref={panel}
        tabIndex={-1}
        className="pane-raised rise relative w-full max-w-[420px] overflow-hidden rounded-2xl outline-none"
      >
        {/* ── what you picked ── */}
        <div className="flex gap-3.5 border-b border-[var(--color-border)] p-4">
          <div className="relative h-[84px] w-[58px] shrink-0 overflow-hidden rounded-md bg-[var(--color-raised)]">
            <PosterImage src={result.coverUrl} title={result.title} sizes="58px" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="leading-snug font-medium">{result.title}</p>
            <p className="mt-1 text-xs text-[var(--color-dim)]">
              <span className="uppercase">{result.kind}</span>
              {total ? ` · ${total} episodes` : ''}
              {result.seasonYear ? ` · ${result.seasonYear}` : ''}
            </p>
          </div>
        </div>

        {savedSlug !== undefined ? (
          /* ── saved ── */
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="flex size-5 items-center justify-center rounded-full bg-[var(--color-airing)]/20">
                <Check className="size-3 text-[var(--color-airing)]" />
              </span>
              {held ? 'Updated.' : 'Added to your library.'}
            </div>
            <p className="mb-4 flex items-center gap-1.5 text-[13px] text-[var(--color-accent-soft)]">
              <CornerDownRight className="size-3" />
              Find it in {CHOICES.find((c) => c.value === choice)?.destination}
            </p>
            <p className="mb-4 text-[13px] leading-relaxed text-[var(--color-dim)]">
              {savedSlug
                ? 'Other seasons, films and OVAs are on the series page — you can set where you are with each of them there.'
                : "We're working out the other seasons now. They'll appear on the series page in a moment."}
            </p>
            <div className="flex gap-2">
              {savedSlug ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push(`/series/${savedSlug}`);
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-accent)]"
                >
                  Open series <ArrowRight className="size-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-dim)]"
              >
                Keep searching
              </button>
            </div>
          </div>
        ) : (
          /* ── choose ── */
          <>
            <div className="p-3">
              {held ? (
                <p className="mb-2.5 flex items-center gap-1.5 rounded-lg bg-[var(--color-airing)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-airing)]">
                  <Check className="size-3 shrink-0" />
                  Already in your library
                  {result.libraryProgress ? (
                    <span className="tnum opacity-80">
                      · episode {result.libraryProgress}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p className="t-label mb-2.5 px-1.5">
                {held ? 'Update where you are' : 'Where are you with this?'}
              </p>
              <div
                role="radiogroup"
                aria-label={held ? 'Update where you are' : 'Where are you with this?'}
                className="flex flex-col gap-0.5"
              >
                {CHOICES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={choice === c.value}
                    onClick={() => setChoice(c.value)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-[120ms]',
                      choice === c.value
                        ? 'bg-[var(--color-overlay)]'
                        : 'hover:bg-[var(--color-surface)]',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-full border',
                        choice === c.value
                          ? 'border-[var(--color-accent)]'
                          : 'border-[var(--color-border-strong)]',
                      )}
                    >
                      {choice === c.value ? (
                        <span className="size-2 rounded-full bg-[var(--color-accent)]" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px]">{c.label}</span>
                      {/* Only the active choice explains itself — showing five
                          destinations at once is noise, not guidance. */}
                      {choice === c.value ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-accent-soft)]">
                          <CornerDownRight className="size-2.5" />
                          Appears in {c.destination}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-mute)]">
                      {c.hint}
                    </span>
                  </button>
                ))}
              </div>

              {/* Only "currently watching" needs a number; asking for one in
                  any other state would be a question with no right answer. */}
              {choice === 'watching' ? (
                <div className="rise mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
                  <label htmlFor="ep" className="t-label mb-2 block">
                    Which episode are you on?
                  </label>
                  <div className="flex items-center gap-2.5">
                    <input
                      id="ep"
                      value={episode}
                      inputMode="numeric"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ''))}
                      className="tnum w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                    <span className="text-xs text-[var(--color-mute)]">
                      of {total ?? 'unknown'}
                    </span>
                  </div>
                  {total ? (
                    <input
                      type="range"
                      min={0}
                      max={total}
                      value={Math.min(Number(episode) || 0, total)}
                      onChange={(e) => setEpisode(e.target.value)}
                      aria-label="Episode"
                      className="mt-3 w-full accent-[var(--color-accent)]"
                    />
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-[var(--color-ended)]/30 bg-[var(--color-ended)]/10 px-3 py-2 text-xs text-[var(--color-ended)]"
                >
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex gap-2 border-t border-[var(--color-border)] p-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2.5 text-sm text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-accent)] transition-transform duration-[160ms] active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {held ? 'Update' : 'Add to library'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
