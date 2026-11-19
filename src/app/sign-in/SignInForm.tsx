'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, Sparkles, TriangleAlert, UserRound } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { InkBackdrop } from '@/components/motion/InkBackdrop';

type Poster = { title: string; cover: string };

/** A wrap-around slice, so a small catalog still fills every column. */
function take<T>(list: T[], start: number, count: number): T[] {
  if (list.length === 0) return [];
  return Array.from({ length: count }, (_, i) => list[(start + i) % list.length]);
}

export default function SignInForm({
  signupsOpen,
  demoEnabled,
  initialMode = 'login',
  posters = [],
}: {
  signupsOpen: boolean;
  demoEnabled: boolean;
  initialMode?: 'login' | 'register';
  posters?: Poster[];
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [demoBusy, setDemoBusy] = useState(false);
  // AnimeMind has no password reset: a new account must acknowledge that.
  const [understood, setUnderstood] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const register = mode === 'register';

  // Entrance: the poster wall slides in, then the form assembles itself.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        gsap
          .timeline({ defaults: { ease: 'expo.out' } })
          .from('[data-art]', { xPercent: -8, opacity: 0, duration: 1.2 })
          .from('[data-card]', { y: 40, opacity: 0, scale: 0.97, duration: 1 }, 0.1)
          .from('[data-f]', { y: 18, opacity: 0, duration: 0.7, stagger: 0.06 }, 0.3);
      });
    }, el);
    return () => ctx.revert();
  }, []);

  function switchMode(next: 'login' | 'register') {
    if (next === mode) return;
    setUnderstood(false);
    setMode(next);
    setError(null);
    setFieldErrors({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (register && !understood) {
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
        ...(register && displayName ? { displayName } : {}),
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
    'own-focus w-full rounded-xl border border-[var(--color-border-strong)] bg-black/30 py-3 pr-3.5 pl-10 text-sm outline-none transition-[border-color,box-shadow] duration-[160ms] placeholder:text-[var(--color-mute)] focus:border-[var(--flame)] focus:shadow-[0_0_0_4px_rgb(255_106_26/0.15),0_0_24px_-6px_var(--flame)]';
  const icon = 'pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--color-mute)]';

  return (
    <div ref={root}>
      <InkBackdrop />
      <main className="relative z-10 grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* ── left: a wall of what people are tracking ── */}
        <aside data-art aria-hidden className="relative hidden overflow-hidden lg:sticky lg:top-0 lg:block lg:h-dvh lg:self-start">
          <div className="absolute inset-0 [perspective:1200px]">
            <div
              className="absolute top-1/2 left-1/2 grid w-[130%] grid-cols-4 gap-4"
              style={{ transform: 'translate(-50%, -50%) rotateX(18deg) rotateZ(-10deg)' }}
            >
              {Array.from({ length: 4 }, (_, i) => {
                const col = take(posters, i * 6, 7);
                return (
                  <div key={i} className="h-[140vh] overflow-hidden">
                    <div
                      className={`loop-y flex flex-col gap-4 ${i % 2 ? 'reverse' : ''}`}
                      style={{ '--loop-dur': `${60 + i * 12}s` } as React.CSSProperties}
                    >
                      {[...col, ...col].map((p, k) => (
                        <div key={k} className="poster-card aspect-[2/3]">
                          <Image src={p.cover} alt="" fill sizes="18vw" className="object-cover" loading="eager" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, rgb(11 8 6 / 0.15), rgb(11 8 6 / 0.35) 75%, var(--ink)), linear-gradient(to top, var(--ink) 8%, rgb(11 8 6 / 0.88) 30%, rgb(11 8 6 / 0.45) 50%, transparent 68%), linear-gradient(to bottom, rgb(11 8 6 / 0.5), transparent 20%), linear-gradient(115deg, rgb(255 106 26 / 0.22), transparent 50%)',
            }}
          />
          <div className="absolute inset-0 overflow-hidden">
            <div className="focus-lines opacity-60" />
          </div>
          <div className="absolute right-10 bottom-12 left-12">
            <p className="kanji-tag mb-4">記憶</p>
            <p className="font-display text-[clamp(2.4rem,4vw,3.6rem)] leading-[1.05]">
              Never forget what you <span className="text-[var(--flame)]">watched.</span>
            </p>
            <ul className="mt-6 flex flex-col gap-2 text-sm text-[#d8cfc6]">
              <li>✦ Remembers where you got to in every series</li>
              <li>✦ Works out seasons, films and specials in order</li>
              <li>✦ Tells you the moment a new season is out</li>
            </ul>
          </div>
        </aside>

        {/* ── right: the form ── */}
        <section className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[420px]">
            <Link href="/welcome" data-f className="mb-8 flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-2.5 rounded-full bg-[var(--flame)]"
                style={{ boxShadow: '0 0 18px var(--flame)' }}
              />
              <span className="font-display text-[18px]">AnimeMind</span>
            </Link>

            <div data-card className="flame-card relative rounded-3xl p-6 sm:p-8">
              <p data-f className="kanji-tag mb-3">
                {register ? 'はじめまして' : 'おかえり'}
              </p>
              <h1 data-f className="font-display mb-2 text-[clamp(1.8rem,4vw,2.3rem)] leading-tight">
                {register ? 'Create your account' : 'Welcome back'}
              </h1>
              <p data-f className="mb-6 text-sm text-[var(--color-dim)]">
                {register
                  ? 'Tell it once. It remembers the seasons, the films, and whether the next one is out.'
                  : 'Pick up exactly where you left off.'}
              </p>

              {signupsOpen ? (
                <div
                  data-f
                  role="tablist"
                  aria-label="Sign in or create an account"
                  className="relative mb-6 grid grid-cols-2 rounded-xl border border-[var(--color-border-strong)] bg-black/30 p-1"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-gradient-to-br from-[var(--gold)] via-[var(--flame)] to-[var(--ember)] shadow-[0_6px_20px_-6px_var(--flame)] transition-transform duration-[420ms] ease-[var(--ease-enter)]"
                    style={{ transform: register ? 'translateX(100%)' : 'none' }}
                  />
                  {(['login', 'register'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => switchMode(m)}
                      className={`relative z-10 rounded-lg py-2 text-xs font-semibold tracking-[0.08em] uppercase transition-colors duration-300 ${
                        mode === m ? 'text-[var(--color-on-accent)]' : 'text-[var(--color-dim)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      {m === 'login' ? 'Sign in' : 'Create account'}
                    </button>
                  ))}
                </div>
              ) : null}

              <form onSubmit={submit} className="flex flex-col gap-4">
                {register ? (
                  <div className="rise">
                    <label htmlFor="name" className="t-label mb-2 block">
                      Name
                    </label>
                    <div className="relative">
                      <UserRound className={icon} />
                      <input
                        id="name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        autoComplete="name"
                        placeholder="What should we call you?"
                        className={field}
                      />
                    </div>
                  </div>
                ) : null}

                <div data-f>
                  <label htmlFor="email" className="t-label mb-2 block">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className={icon} />
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="you@example.com"
                      className={field}
                    />
                  </div>
                  {fieldErrors.email ? (
                    <p className="mt-1.5 text-xs text-[#ff8a9a]">{fieldErrors.email[0]}</p>
                  ) : null}
                </div>

                <div data-f>
                  <label htmlFor="password" className="t-label mb-2 block">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className={icon} />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={register ? 'new-password' : 'current-password'}
                      className={`${field} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-mute)] transition-colors hover:text-[var(--color-text)]"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {fieldErrors.password ? (
                    <p className="mt-1.5 text-xs text-[#ff8a9a]">{fieldErrors.password[0]}</p>
                  ) : register ? (
                    <p className="mt-1.5 text-xs text-[var(--color-mute)]">At least 10 characters. A short sentence works well.</p>
                  ) : null}
                </div>

                {register ? (
                  <div className="rise overflow-hidden rounded-2xl border border-[var(--gold)]/40 bg-[#1a100a]">
                    <div aria-hidden className="hazard h-1.5" />
                    <div className="p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <TriangleAlert className="size-4 text-[var(--gold)]" />
                        <span className="jp text-[var(--flame)]">注意</span> No password recovery
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-dim)]">
                        AnimeMind is a personal project with no password reset and no email. If you
                        forget your password, your account and library can&apos;t be recovered. Save it
                        in a password manager.
                      </p>
                      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-black/30 p-2.5 text-xs transition-colors hover:border-[var(--flame)]/50">
                        <input
                          type="checkbox"
                          checked={understood}
                          onChange={(e) => setUnderstood(e.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--flame)]"
                        />
                        <span>I understand a lost password means a lost account.</span>
                      </label>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-[var(--ember)]/40 bg-[var(--ember)]/10 px-3 py-2.5 text-xs text-[#ff8a9a]"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  data-f
                  type="submit"
                  disabled={busy || (register && !understood)}
                  className="cta cta-primary mt-1 w-full disabled:cursor-not-allowed disabled:opacity-50 disabled:[animation:none]"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {register ? 'Create account' : 'Sign in'}
                  <ArrowRight className="cta-arrow size-4" />
                </button>

                {!register ? (
                  <p data-f className="text-center text-[11px] leading-relaxed text-[var(--color-mute)]">
                    Forgot your password? There&apos;s no reset — accounts can&apos;t be recovered.
                  </p>
                ) : null}
              </form>

              {demoEnabled ? (
                <div data-f className="mt-6">
                  <div className="mb-4 flex items-center gap-3 text-[11px] tracking-[0.2em] text-[var(--color-mute)] uppercase">
                    <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
                    or
                    <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
                  </div>
                  <button
                    type="button"
                    onClick={tryDemo}
                    disabled={demoBusy || busy}
                    className="cta cta-outline w-full disabled:opacity-60"
                  >
                    {demoBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-[var(--gold)]" />}
                    Try the demo
                  </button>
                  <p className="mt-2 text-center text-xs text-[var(--color-mute)]">
                    No account needed — a shared sample library that resets every night.
                  </p>
                </div>
              ) : null}
            </div>

            <p data-f className="mt-6 text-center">
              <Link
                href="/welcome"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--color-mute)] transition-colors hover:text-[var(--flame)]"
              >
                <ArrowLeft className="size-3.5" /> What is AnimeMind?
              </Link>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
