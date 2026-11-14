'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Plus } from 'lucide-react';
import { ulid } from 'ulid';
import type { SyncResponse } from '@/contracts';
import { api } from '@/lib/api';
import { deviceId } from '@/lib/device';
import { cn } from '@/lib/cn';

/**
 * "I watched another one."
 *
 * This is the single most-used control in the product, so it is optimistic:
 * the number moves on click and the request happens behind it. Marking an
 * episode should feel like ticking a box, not like submitting a form.
 *
 * It writes through the same /sync endpoint a mobile client uses rather than a
 * bespoke REST call. One write path means the merge rules — never rewind,
 * respect the rewatch pass — apply identically everywhere, and there is no
 * second implementation to keep honest.
 */
export function EpisodeStepper({
  workId,
  progress,
  total,
  pass,
}: {
  workId: string;
  progress: number;
  total: number | null;
  pass: number;
}) {
  const [value, setValue] = useState(progress);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const atEnd = total !== null && value >= total;

  async function bump() {
    if (atEnd) return;
    const next = value + 1;
    const previous = value;
    setValue(next);
    setFailed(false);

    try {
      await api.post<SyncResponse>('/sync', {
        ops: [
          {
            id: ulid(),
            clientTs: Date.now(),
            deviceId: deviceId(),
            t: 'set_progress',
            workId,
            pass,
            value: next,
          },
        ],
      });
      startTransition(() => router.refresh());
    } catch {
      // Roll back rather than leaving a number the server never accepted.
      setValue(previous);
      setFailed(true);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {failed ? (
        <span className="text-[10px] text-[var(--color-ended)]">not saved</span>
      ) : null}
      <button
        type="button"
        onClick={() => void bump()}
        disabled={atEnd}
        aria-label={atEnd ? 'All episodes watched' : `Mark episode ${value + 1} watched`}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-[transform,background-color,border-color] duration-[160ms] ease-[var(--ease-state)]',
          atEnd
            ? 'cursor-default border-[var(--color-border)] text-[var(--color-mute)]'
            : 'border-transparent bg-[var(--color-raised)] text-[var(--color-text)] hover:bg-[var(--color-overlay)] active:scale-95',
        )}
      >
        {atEnd ? (
          <>
            <Check className="size-3" /> Done
          </>
        ) : (
          <>
            <Plus className="size-3" />
            <span className="tnum">Ep {value + 1}</span>
          </>
        )}
      </button>
    </div>
  );
}
