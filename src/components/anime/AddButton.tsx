'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Add a title to the library from wherever you happen to be looking at it.
 *
 * The series page used to show "NEXT SEASON — Episode 1" with no way to act
 * on it: the next season was not in the library, so it rendered a dead 0/12
 * bar and no control. The app named the thing to do and then refused to let
 * you do it, which is the one failure a product like this cannot afford.
 */
export function AddButton({
  workId,
  label = 'Add',
  status = 'planned',
  className,
}: {
  workId: string;
  label?: string;
  status?: 'planned' | 'watching';
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function add() {
    if (state === 'saving') return;
    setState('saving');
    try {
      await api.post('/library', { workId, status });
      // The server now owns the truth; re-render from it rather than guessing.
      startTransition(() => router.refresh());
    } catch {
      setState('failed');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={state === 'saving'}
      aria-label={`${label} to your library`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-[transform,background-color] duration-[160ms] ease-[var(--ease-state)] active:scale-95',
        state === 'failed'
          ? 'bg-[var(--color-ended)]/20 text-[var(--color-ended)]'
          : 'bg-[var(--color-accent)] text-[var(--color-on-accent)]',
        className,
      )}
    >
      {state === 'saving' ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Plus className="size-3" />
      )}
      {state === 'failed' ? 'Retry' : label}
    </button>
  );
}
