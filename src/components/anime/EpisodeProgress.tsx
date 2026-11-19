'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import type { SyncResponse } from '@/contracts';
import { api } from '@/lib/api';
import { makeOp } from '@/lib/op';
import { cn } from '@/lib/cn';

/**
 * The progress bar, the count, and the way to change it — one control.
 *
 * Incrementing by one is right while you are actually watching, and useless
 * for everything else. Entering a back catalogue means saying "I'm on episode
 * 161 of One Piece", and doing that by pressing +1 a hundred and sixty times,
 * or by hunting for a number field inside a dropdown, is not a flow anyone
 * should have to find.
 *
 * So the count itself is the control: click `161/1122` and type. The +1 button
 * stays for the common case.
 */
export function EpisodeProgress({
  workId,
  progress,
  total,
  pass,
  status,
}: {
  workId: string;
  progress: number;
  total: number | null;
  pass: number;
  status: string;
}) {
  // Optimistic overlay on the server value, never a copy of it — a copy goes
  // stale the moment anything else changes this title.
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const [seen, setSeen] = useState(progress);
  if (seen !== progress) {
    setSeen(progress);
    setOptimistic(null);
  }
  const value = optimistic ?? progress;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const atEnd = total !== null && value >= total;
  const pct = total && total > 0 ? Math.min(100, (value / total) * 100) : null;

  async function commit(next: number) {
    const previous = value;
    setOptimistic(next);
    setBusy(true);
    setError(null);
    try {
      await api.post<SyncResponse>('/sync', {
        ops: [
          makeOp(
            // Landing on the last episode IS finishing it. Making someone set
            // the number and then separately mark it complete is busywork.
            total !== null && next >= total
              ? { t: 'complete', workId, pass }
              : { t: 'set_progress', workId, pass, value: next },
          ),
        ],
      });
      startTransition(() => router.refresh());
      setEditing(false);
    } catch {
      setOptimistic(previous);
      setError('Not saved');
    } finally {
      setBusy(false);
    }
  }

  function submitDraft() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return setError('Enter a number');
    if (total !== null && n > total) return setError(`Max ${total}`);
    void commit(n);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <div className="h-1 max-w-sm flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-[320ms]"
            style={{
              width: pct === null ? '100%' : `${pct}%`,
              opacity: pct === null ? 0.25 : 1,
            }}
          />
        </div>

        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={draft}
              inputMode="numeric"
              aria-label="Episode number"
              // Select the existing number so typing REPLACES it. Without
              // this, clicking "161/1122" and typing 170 gives 161170 — and
              // correcting a long-runner's count is the exact case this
              // control exists for.
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitDraft();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={() => !busy && setEditing(false)}
              className="tnum w-[4.5rem] rounded-md border border-[var(--color-accent)] bg-[var(--color-surface)] px-2 py-0.5 text-xs outline-none"
            />
            <button
              type="button"
              // onMouseDown, not onClick: blur fires first and would close the
              // editor before the click ever lands.
              onMouseDown={(e) => {
                e.preventDefault();
                submitDraft();
              }}
              className="rounded-md bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-on-accent)]"
            >
              Set
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
              setError(null);
            }}
            title="Click to set the episode"
            className="tnum shrink-0 rounded px-1 text-xs text-[var(--color-dim)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          >
            {value}
            <span className="text-[var(--color-mute)]">/{total ?? '?'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => void commit(value + 1)}
          disabled={atEnd || busy}
          aria-label={atEnd ? 'All episodes watched' : `Mark episode ${value + 1} watched`}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-[transform,background-color] duration-[160ms] active:scale-95',
            atEnd
              ? 'cursor-default border-[var(--color-border)] text-[var(--color-mute)]'
              : 'border-transparent bg-[var(--color-raised)] hover:bg-[var(--color-overlay)]',
          )}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : atEnd ? (
            <Check className="size-3" />
          ) : (
            <Plus className="size-3" />
          )}
          {atEnd ? 'Done' : `Ep ${value + 1}`}
        </button>
      </div>

      {error ? (
        <span className="text-[10px] text-[var(--color-ended)]">{error}</span>
      ) : status === 'completed' && !atEnd && total ? (
        // Marked complete but the count says otherwise — usually because the
        // provider revised the episode count upward after it finished airing.
        <span className="text-[10px] text-[var(--color-mute)]">
          marked complete at {value} of {total}
        </span>
      ) : null}
    </div>
  );
}
