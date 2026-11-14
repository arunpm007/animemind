'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';

const field =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none transition-colors duration-[160ms] focus:border-[var(--color-border-strong)]';

function Saved() {
  return (
    <span className="flex items-center gap-1 text-[11px] text-[var(--color-airing)]">
      <Check className="size-3" /> Saved
    </span>
  );
}

export function DisplayNameForm({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const dirty = name.trim() !== initial.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    try {
      await api.post('/auth/profile', { displayName: name });
      setState('saved');
      startTransition(() => router.refresh());
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiRequestError ? err.payload.message : 'Could not save.');
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label htmlFor="name" className="t-label">
        Display name
      </label>
      <input
        id="name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setState('idle');
        }}
        placeholder="What should we call you?"
        className={field}
      />
      <p className="text-[11px] text-[var(--color-mute)]">
        Used in the greeting on Today.
      </p>
      {error ? <p className="text-xs text-[var(--color-ended)]">{error}</p> : null}
      <div className="flex items-center gap-3">
        {dirty ? (
          <button
            type="submit"
            disabled={state === 'busy'}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-60"
          >
            {state === 'busy' ? <Loader2 className="size-3 animate-spin" /> : null}
            Save name
          </button>
        ) : null}
        {state === 'saved' && !dirty ? <Saved /> : null}
      </div>
    </form>
  );
}

/**
 * The PATCH method the profile form uses is not what `api.post` sends, so the
 * profile endpoint accepts POST too — kept deliberately simple because this
 * is the only non-GET/POST verb in the app and one exception is not worth a
 * client abstraction.
 */
export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Checked here as well as on the server: a mismatch is a typo, and the
    // user should learn about it without a round trip.
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next.length < 10) return setError('Use at least 10 characters.');

    setState('busy');
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      setState('saved');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setState('idle');
      setError(
        err instanceof ApiRequestError ? err.payload.message : 'Could not change it.',
      );
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div>
        <label htmlFor="cur" className="t-label mb-1.5 block">
          Current password
        </label>
        <input
          id="cur"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="new" className="t-label mb-1.5 block">
          New password
        </label>
        <input
          id="new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={field}
        />
        <p className="mt-1.5 text-[11px] text-[var(--color-mute)]">
          At least 10 characters. A short sentence works well.
        </p>
      </div>
      <div>
        <label htmlFor="conf" className="t-label mb-1.5 block">
          Confirm new password
        </label>
        <input
          id="conf"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={field}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-ended)]/30 bg-[var(--color-ended)]/10 px-3 py-2 text-xs text-[var(--color-ended)]"
        >
          {error}
        </p>
      ) : null}

      {state === 'saved' ? (
        <p className="rounded-lg border border-[var(--color-airing)]/30 bg-[var(--color-airing)]/10 px-3 py-2 text-xs text-[var(--color-airing)]">
          Password changed. Your other devices have been signed out.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === 'busy' || !current || !next}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {state === 'busy' ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Change password
        </button>
        <p className="text-[11px] text-[var(--color-mute)]">
          Signs out every other device.
        </p>
      </div>
    </form>
  );
}
