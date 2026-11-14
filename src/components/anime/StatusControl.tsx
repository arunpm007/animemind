'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, ChevronDown, Loader2, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { SyncOpBody, SyncResponse, WatchStateDto } from '@/contracts';
import { api } from '@/lib/api';
import { makeOp } from '@/lib/op';
import { cn } from '@/lib/cn';

/**
 * Everything you can do to a title you already have.
 *
 * Two rules learned from using it:
 *
 *  - A TOGGLE keeps the menu open. Favouriting used to close it, and because
 *    favourite was rendered nowhere else in the app, the state change left no
 *    trace at all — it read as though the action had been erased. Toggles now
 *    stay put and show their new state immediately.
 *  - A DECISION closes it. Changing status or removing a title is the end of
 *    an interaction; leaving the menu hanging open afterwards is noise.
 */

const STATES: Array<{ value: WatchStateDto; label: string; hint: string }> = [
  { value: 'watching', label: 'Watching', hint: 'In progress' },
  { value: 'completed', label: 'Completed', hint: 'Seen it all' },
  { value: 'planned', label: 'Plan to watch', hint: 'Not started' },
  { value: 'on_hold', label: 'On hold', hint: 'Paused' },
  { value: 'dropped', label: 'Dropped', hint: 'Not continuing' },
];

const LABEL: Record<WatchStateDto, string> = {
  watching: 'Watching',
  completed: 'Completed',
  planned: 'Planned',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

export interface StatusControlProps {
  workId: string;
  status: WatchStateDto;
  progress: number;
  total: number | null;
  rewatching: boolean;
  rewatchCount: number;
  favorite: boolean;
  rating: number | null;
  notes: string | null;
}

export function StatusControl(props: StatusControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  // Optimistic overlays, cleared whenever the server value moves. Copying
  // props into state instead leaves every control stale the moment anything
  // else edits this title — including another device.
  const [favOptimistic, setFavOptimistic] = useState<boolean | null>(null);
  const [rateOptimistic, setRateOptimistic] = useState<number | null | undefined>(undefined);
  const [seenFav, setSeenFav] = useState(props.favorite);
  const [seenRating, setSeenRating] = useState(props.rating);
  if (seenFav !== props.favorite) {
    setSeenFav(props.favorite);
    setFavOptimistic(null);
  }
  if (seenRating !== props.rating) {
    setSeenRating(props.rating);
    setRateOptimistic(undefined);
  }
  const favorite = favOptimistic ?? props.favorite;
  const rating = rateOptimistic === undefined ? props.rating : rateOptimistic;

  const [notes, setNotes] = useState(props.notes ?? '');
  const [seenNotes, setSeenNotes] = useState(props.notes);
  if (seenNotes !== props.notes) {
    setSeenNotes(props.notes);
    setNotes(props.notes ?? '');
  }
  const notesDirty = notes !== (props.notes ?? '');

  const pass = props.rewatchCount + 1 + (props.rewatching ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function send(op: SyncOpBody, { close = true } = {}) {
    setBusy(true);
    setError(null);
    try {
      await api.post<SyncResponse>('/sync', {
        ops: [makeOp(op)],
      });
      startTransition(() => router.refresh());
      if (close) setOpen(false);
    } catch {
      setError('Could not save. Try again.');
      setFavOptimistic(null);
      setRateOptimistic(undefined);
    } finally {
      setBusy(false);
    }
  }

  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-[120ms] hover:bg-[var(--color-overlay)] disabled:opacity-50';

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-dim)] transition-colors duration-[160ms] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {/* Favourite and rating are visible ON the chip, so the menu is not
            the only place the app admits they exist. */}
        {favorite ? (
          <Star className="size-3 fill-[var(--color-upcoming)] text-[var(--color-upcoming)]" />
        ) : null}
        {rating ? <span className="tnum text-[var(--color-dim)]">{rating}</span> : null}
        {props.rewatching ? 'Rewatching' : LABEL[props.status]}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      {open ? (
        <div
          role="menu"
          className="pane-raised rise absolute top-full right-0 z-50 mt-1.5 w-[256px] rounded-xl p-1.5"
        >
          {/* ── status ── */}
          <p className="t-label px-2.5 pt-1 pb-1.5">Status</p>
          {STATES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() =>
                void send(
                  // "Completed" means every episode, not a label — the
                  // dedicated op fills progress and closes the watch session.
                  s.value === 'completed'
                    ? { t: 'complete', workId: props.workId, pass }
                    : { t: 'set_status', workId: props.workId, value: s.value },
                )
              }
              className={cn(item, props.status === s.value && 'text-[var(--color-accent)]')}
            >
              <span className="flex-1">{s.label}</span>
              {props.status === s.value ? (
                <Check className="size-3.5" />
              ) : (
                <span className="text-[10px] text-[var(--color-mute)]">{s.hint}</span>
              )}
            </button>
          ))}

          <div className="my-1 border-t border-[var(--color-border)]" />

          {/* ── rating ── */}
          <div className="px-2.5 py-1.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="t-label">Your rating</span>
              {rating ? (
                <button
                  type="button"
                  onClick={() => {
                    setRateOptimistic(null);
                    void send({ t: 'rate', workId: props.workId, value: null }, { close: false });
                  }}
                  className="text-[10px] text-[var(--color-mute)] hover:text-[var(--color-dim)]"
                >
                  clear
                </button>
              ) : null}
            </div>
            <div className="flex gap-[3px]">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  aria-label={`Rate ${n} out of 10`}
                  onClick={() => {
                    setRateOptimistic(n);
                    void send({ t: 'rate', workId: props.workId, value: n }, { close: false });
                  }}
                  className={cn(
                    'tnum h-6 flex-1 rounded text-[10px] transition-colors duration-[120ms]',
                    rating && n <= rating
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface)] text-[var(--color-mute)] hover:bg-[var(--color-overlay)]',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* ── notes ── */}
          <div className="px-2.5 py-1.5">
            <span className="t-label mb-1.5 block">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Where you left off, who recommended it…"
              className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-mute)]"
            />
            {/* Notes are free text, so they save on an explicit action rather
                than on every keystroke — nobody wants a write per character. */}
            {notesDirty ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void send(
                    { t: 'note', workId: props.workId, value: notes.trim() || null },
                    { close: false },
                  )
                }
                className="rise mt-1.5 w-full rounded-md bg-[var(--color-accent)] py-1 text-[11px] font-medium text-white"
              >
                Save note
              </button>
            ) : null}
          </div>

          <div className="my-1 border-t border-[var(--color-border)]" />

          {props.status === 'completed' && !props.rewatching ? (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() =>
                void send({ t: 'start_rewatch', workId: props.workId, pass: pass + 1 })
              }
              className={item}
            >
              <RotateCcw className="size-3.5 text-[var(--color-dim)]" />
              Watch again
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setFavOptimistic(!favorite);
              void send(
                { t: 'favorite', workId: props.workId, value: !favorite },
                { close: false },
              );
            }}
            className={cn(item, favorite && 'text-[var(--color-upcoming)]')}
          >
            <Star className={cn('size-3.5', favorite && 'fill-current')} />
            {favorite ? 'Favourited' : 'Add to favourites'}
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void send({ t: 'remove', workId: props.workId })}
            className={cn(item, 'text-[var(--color-ended)]')}
          >
            <Trash2 className="size-3.5" />
            Remove from library
          </button>

          {error ? (
            <p role="alert" className="px-2.5 py-1.5 text-[11px] text-[var(--color-ended)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
