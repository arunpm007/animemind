'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { CinemaBackdrop } from '@/components/motion/CinemaBackdrop';

export default function SignInForm({
  signupsOpen,
  demoEnabled,
}: {
  signupsOpen: boolean;
  demoEnabled: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [demoBusy, setDemoBusy] = useState(false);
  // AnimeMind has no password reset: a new account must acknowledge that.
  const [understood, setUnderstood] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'register' && !understood) {
      setError('Please confirm you understand a lost password cannot be recovered.');
      return;
    }
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

  async function tryDemo() {
    setDemoBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.post('/auth/demo', { client: 'web' });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : 'Could not reach the server.');
      setDemoBusy(false);
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

            {mode === 'register' ? (
              <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 py-3">
                <p className="text-xs font-medium">No password recovery</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-dim)]">
                  AnimeMind is a personal project with no password reset and no email.
                  If you forget your password, your account and library can&apos;t be
                  recovered. Save it in a password manager.
                </p>
                <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                    className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span>I understand a lost password means a lost account.</span>
                </label>
              </div>
            ) : null}

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
              disabled={busy || (mode === 'register' && !understood)}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white transition-transform duration-[160ms] ease-[var(--ease-state)] active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            {mode === 'login' ? (
              <p className="text-center text-[11px] leading-relaxed text-[var(--color-mute)]">
                Forgot your password? There&apos;s no reset — accounts can&apos;t be recovered.
              </p>
            ) : null}

            {signupsOpen ? (
              <button
                type="button"
                onClick={() => {
                  setUnderstood(false);
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
            ) : null}
          </form>

          {demoEnabled ? (
            <div className="rise mt-4 text-center">
              <button
                type="button"
                onClick={tryDemo}
                disabled={demoBusy || busy}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-surface)] disabled:opacity-60"
              >
                {demoBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                Try the demo — no account needed
              </button>
              <p className="mt-2 text-xs text-[var(--color-mute)]">
                A shared sample library. Changes reset every night.
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
