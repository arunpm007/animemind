'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import { ulid } from 'ulid';
import type { SyncOpBody, SyncResponse, WatchStateDto } from '@/contracts';
import { api } from '@/lib/api';
import { deviceId } from '@/lib/device';
import { cn } from '@/lib/cn';

/**
 * Everything you can do to a title you already have.
 *
 * The server has supported nine write operations since it was built, and the
 * UI could reach two of them. Changing status, marking complete, starting a
 * rewatch, rating, favouriting and removing were all unreachable — the
 * documentation even described a "Watch again" button that did not exist.
 * This component is where those live.
 *
 * Everything writes through /sync rather than a bespoke endpoint, so the merge
 * rules (never rewind progress, respect the rewatch pass) apply identically
 * here, on mobile, and anywhere else.
 */

const STATES: Array<{ value: WatchStateDto; label: string; hint: string }> = [
  { value: 'watching', label: 'Watching', hint: 'In progress' },
  { value: 'completed', label: 'Completed', hint: 'Seen it all' },
  { value: 'planned', label: 'Plan to watch', hint: 'Not started' },
  { value: 'on_hold', label: 'On hold', hint: 'Paused for now' },
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
}

export function StatusControl(props: StatusControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(props.progress));
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

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

  async function send(op: SyncOpBody) {
    setBusy(true);
    setError(null);
    try {
      await api.post<SyncResponse>('/sync', {
        ops: [{ id: ulid(), clientTs: Date.now(), deviceId: deviceId(), ...op }],
      });
      startTransition(() => router.refresh());
      setOpen(false);
      setEditing(false);
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function setEpisode() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return setError('Enter a number.');
    if (props.total && n > props.total) return setError(`Max is ${props.total}.`);
    // Reaching the final episode IS completing it — making the user set the
    // number and then separately mark it complete is busywork.
    if (props.total && n === props.total) {
      return send({ t: 'complete', workId: props.workId, pass });
    }
    await send({ t: 'set_progress', workId: props.workId, pass, value: n });
  }

  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-[120ms] hover:bg-[var(--color-overlay)]';

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
        {props.rewatching ? 'Rewatching' : LABEL[props.status]}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      {open ? (
        <div
          role="menu"
          className="pane-raised rise absolute top-full right-0 z-50 mt-1.5 w-[232px] rounded-xl p-1.5"
        >
          {/* ── set the episode directly ── */}
          <div className="mb-1 border-b border-[var(--color-border)] px-2.5 pt-1 pb-2.5">
            <p className="t-label mb-2">Episode</p>
            {editing ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={draft}
                  inputMode="numeric"
                  onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && void setEpisode()}
                  className="tnum w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
                />
                <span className="text-xs text-[var(--color-mute)]">
                  / {props.total ?? '?'}
                </span>
                <button
                  type="button"
                  onClick={() => void setEpisode()}
                  className="ml-auto rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-medium text-white"
                >
                  Set
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(String(props.progress));
                  setEditing(true);
                }}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="tnum text-sm">
                  {props.progress}
                  <span className="text-[var(--color-mute)]">
                    /{props.total ?? '?'}
                  </span>
                </span>
                <Pencil className="size-3 text-[var(--color-mute)]" />
                <span className="ml-auto text-[11px] text-[var(--color-mute)]">
                  jump to…
                </span>
              </button>
            )}
          </div>

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
                  // "Completed" means every episode, not just a label change —
                  // the dedicated op fills progress to the episode count and
                  // closes the watch session.
                  s.value === 'completed'
                    ? { t: 'complete', workId: props.workId, pass }
                    : { t: 'set_status', workId: props.workId, value: s.value },
                )
              }
              className={cn(item, props.status === s.value && 'text-[var(--color-accent)]')}
            >
              <span className="flex-1">{s.label}</span>
              {props.status === s.value ? <Check className="size-3.5" /> : null}
            </button>
          ))}

          <div className="my-1 border-t border-[var(--color-border)]" />

          {/* ── the button the documentation promised ── */}
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
            onClick={() =>
              void send({ t: 'favorite', workId: props.workId, value: !props.favorite })
            }
            className={cn(item, props.favorite && 'text-[var(--color-upcoming)]')}
          >
            <Star className={cn('size-3.5', props.favorite && 'fill-current')} />
            {props.favorite ? 'Favourited' : 'Add to favourites'}
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
