'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { CinemaBackdrop } from '@/components/motion/CinemaBackdrop';

export default function SignInPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post(`/auth/${mode}`, {
        email,
        password,
        client: 'web', // the server then sets httpOnly cookies rather than returning tokens
        ...(mode === 'register' && displayName ? { displayName } : {}),
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.payload.message);
        setFieldErrors(err.payload.details ?? {});
      } else {
        setError('Could not reach the server.');
      }
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none transition-colors duration-[160ms] focus:border-[var(--color-border-strong)]';

  return (
    <>
      <CinemaBackdrop accent="#ff4d67" intensity={0.4} />
      <main className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="w-full max-w-[380px]">
          <div className="rise mb-10 text-center">
            <div className="mb-5 flex items-center justify-center gap-2.5">
              <span
                aria-hidden
                className="size-2 rounded-full bg-[var(--color-accent)]"
                style={{ boxShadow: '0 0 16px var(--color-accent)' }}
              />
              <span className="text-[17px] font-semibold tracking-[-0.02em]">
                AnimeMind
              </span>
            </div>
            <h1 className="t-title mb-2">Never forget what you watched.</h1>
            <p className="text-sm text-[var(--color-dim)]">
              Tell it once. It remembers the seasons, the films, and whether the next
              one is out.
            </p>
          </div>

          <form onSubmit={submit} className="pane rise flex flex-col gap-3 rounded-2xl p-5">
            {mode === 'register' ? (
              <div>
                <label htmlFor="name" className="t-label mb-1.5 block">
                  Name
                </label>
                <input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  className={field}
                />
              </div>
            ) : null}

            <div>
              <label htmlFor="email" className="t-label mb-1.5 block">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={field}
              />
              {fieldErrors.email ? (
                <p className="mt-1.5 text-xs text-[var(--color-ended)]">
                  {fieldErrors.email[0]}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="password" className="t-label mb-1.5 block">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={field}
              />
              {fieldErrors.password ? (
                <p className="mt-1.5 text-xs text-[var(--color-ended)]">
                  {fieldErrors.password[0]}
                </p>
              ) : mode === 'register' ? (
                <p className="mt-1.5 text-xs text-[var(--color-mute)]">
                  At least 10 characters. A short sentence works well.
                </p>
              ) : null}
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-[var(--color-ended)]/30 bg-[var(--color-ended)]/10 px-3 py-2 text-xs text-[var(--color-ended)]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white transition-transform duration-[160ms] ease-[var(--ease-state)] active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
                setFieldErrors({});
              }}
              className="text-xs text-[var(--color-mute)] transition-colors hover:text-[var(--color-dim)]"
            >
              {mode === 'login'
                ? "Don't have an account? Create one"
                : 'Already have an account? Sign in'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
