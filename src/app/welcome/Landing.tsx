'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Bell,
  Clock3,
  Library,
  ListChecks,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  Tv,
  Workflow,
} from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { CinemaBackdrop } from '@/components/motion/CinemaBackdrop';

const STEPS = [
  {
    icon: Search,
    title: 'Tell it once',
    body: 'Search for an anime and say where you got to. That is the only thing you ever type.',
  },
  {
    icon: Workflow,
    title: 'It works out the rest',
    body: 'Seasons, films and specials are joined into one series, in watch order — so it knows what comes next.',
  },
  {
    icon: Bell,
    title: 'It tells you when it’s out',
    body: 'Finish a season and the next one shows up on your Today page the moment it is available.',
  },
] as const;

const SCREENS = [
  { icon: Sparkles, name: 'Today', body: 'What wants your attention right now.' },
  { icon: Tv, name: 'Watching', body: 'Everything in progress, with your episode count.' },
  { icon: ListChecks, name: 'Up next', body: 'What to start once you finish something.' },
  { icon: Clock3, name: 'Waiting', body: 'Sequels that are announced but not out yet.' },
  { icon: Library, name: 'Library', body: 'Every title you have ever added.' },
] as const;

export default function Landing({
  signupsOpen,
  demoEnabled,
}: {
  signupsOpen: boolean;
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tryDemo() {
    setDemoBusy(true);
    setError(null);
    try {
      await api.post('/auth/demo', { client: 'web' });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : 'Could not reach the server.');
      setDemoBusy(false);
    }
  }

  const primary =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-3 text-sm font-medium text-white transition-transform duration-[160ms] ease-[var(--ease-state)] active:scale-[0.98] disabled:opacity-60';
  const secondary =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-5 py-3 text-sm font-medium transition-colors hover:bg-[var(--color-surface)]';

  // A plain function, not a component: a component declared inside render
  // would be a new type every render and remount its buttons.
  function actions(where: 'top' | 'bottom') {
    return (
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
        {demoEnabled ? (
          <button type="button" onClick={tryDemo} disabled={demoBusy} className={primary}>
            {demoBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Try the demo
          </button>
        ) : null}
        {signupsOpen ? (
          <Link
            href="/sign-in?mode=register"
            className={demoEnabled ? secondary : primary}
            data-cta={`register-${where}`}
          >
            Create an account
          </Link>
        ) : null}
        <Link
          href="/sign-in"
          className={demoEnabled || signupsOpen ? secondary : primary}
          data-cta={`signin-${where}`}
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <CinemaBackdrop accent="#ff4d67" intensity={0.4} />
      <div className="relative z-10 min-h-dvh">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2 rounded-full bg-[var(--color-accent)]"
              style={{ boxShadow: '0 0 16px var(--color-accent)' }}
            />
            <span className="text-[17px] font-semibold tracking-[-0.02em]">AnimeMind</span>
          </div>
          <Link
            href="/sign-in"
            className="text-sm text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
          >
            Sign in
          </Link>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-8">
          {/* ── what this is ── */}
          <section className="rise mx-auto max-w-2xl pt-12 pb-16 text-center sm:pt-20">
            <p className="t-label mb-4">A personal anime tracker</p>
            <h1 className="t-display mb-4">Never forget what you watched.</h1>
            <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-[var(--color-dim)]">
              AnimeMind remembers where you got to in every series, works out what comes
              next, and tells you when a new season is out. No spreadsheets, no guessing
              which season you stopped on.
            </p>
            <div className="mt-8">
              {actions('top')}
            </div>
            {demoEnabled ? (
              <p className="mt-3 text-xs text-[var(--color-mute)]">
                The demo needs no account — it opens a shared sample library.
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mx-auto mt-4 max-w-sm rounded-lg border border-[var(--color-ended)]/30 bg-[var(--color-ended)]/10 px-3 py-2 text-xs text-[var(--color-ended)]"
              >
                {error}
              </p>
            ) : null}
          </section>

          {/* ── how it works ── */}
          <section aria-labelledby="how" className="mb-16">
            <h2 id="how" className="t-label mb-5 text-center">
              How it works
            </h2>
            <ol className="stagger grid gap-3 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="pane rounded-xl p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                      <s.icon className="size-4" />
                    </span>
                    <span className="tnum text-xs text-[var(--color-mute)]">0{i + 1}</span>
                  </div>
                  <h3 className="t-heading mb-1.5">{s.title}</h3>
                  <p className="text-[13px] leading-relaxed text-[var(--color-dim)]">{s.body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ── what you'll find inside ── */}
          <section aria-labelledby="inside" className="mb-16">
            <h2 id="inside" className="t-label mb-5 text-center">
              What you’ll find inside
            </h2>
            <ul className="pane divide-y divide-[var(--color-border)] rounded-xl">
              {SCREENS.map((s) => (
                <li key={s.name} className="flex items-center gap-4 px-5 py-3.5">
                  <s.icon className="size-4 shrink-0 text-[var(--color-dim)]" />
                  <span className="w-20 shrink-0 text-sm font-medium">{s.name}</span>
                  <span className="min-w-0 text-[13px] text-[var(--color-dim)]">{s.body}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── the honest part, before anyone makes an account ── */}
          <section
            aria-labelledby="know"
            className="mx-auto mb-16 max-w-2xl rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/80 p-5 sm:p-6"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <ShieldAlert className="size-4 text-[var(--color-upcoming)]" />
              <h2 id="know" className="t-heading">
                Good to know before you sign up
              </h2>
            </div>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] leading-relaxed text-[var(--color-dim)]">
              <li>AnimeMind is a personal project, built and run by one person.</li>
              <li>
                <span className="font-medium text-[var(--color-text)]">
                  There is no password reset and no email.
                </span>{' '}
                If you forget your password, your account and library can’t be recovered.
                Keep it in a password manager.
              </li>
              {demoEnabled ? (
                <li>The demo library is shared with everyone and resets every night.</li>
              ) : null}
              <li>Anime details and posters come from Kitsu and MyAnimeList.</li>
            </ul>
          </section>

          {/* ── second chance to act, after reading ── */}
          <section className="text-center">
            <h2 className="t-title mb-6">Ready to try it?</h2>
            {actions('bottom')}
          </section>
        </main>
      </div>
    </>
  );
}
