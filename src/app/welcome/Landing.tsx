'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { SplitText } from 'gsap/SplitText';
import {
  ArrowRight,
  Bell,
  Clock3,
  Library,
  ListChecks,
  Loader2,
  Search,
  Sparkles,
  Tv,
  TriangleAlert,
} from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { InkBackdrop } from '@/components/motion/InkBackdrop';
import type { Showcase } from '@/server/services/showcase';

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);

const STEPS = [
  {
    icon: Search,
    title: 'Tell it once',
    body: 'Search for an anime and say where you got to. That is the only thing you ever type.',
  },
  {
    icon: ListChecks,
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
  { icon: Sparkles, name: 'Today', kanji: '今日', body: 'What wants your attention right now — new seasons first.' },
  { icon: Tv, name: 'Watching', kanji: '視聴中', body: 'Everything in progress, with your episode count one tap away.' },
  { icon: ListChecks, name: 'Up next', kanji: '次', body: 'What to start the moment you finish something.' },
  { icon: Clock3, name: 'Waiting', kanji: '待機', body: 'Sequels that are announced but not out yet, with dates.' },
  { icon: Library, name: 'Library', kanji: '書庫', body: 'Every title you have ever added, filterable in a click.' },
] as const;

const WORDS = ['Never forget', 'What comes next', 'New season out', 'Pick up where you left off'];

const KIND_LABEL: Record<string, string> = {
  tv: 'TV',
  ona: 'Web',
  movie: 'Film',
  ova: 'OVA',
  special: 'Special',
};

/** A wrap-around slice, so a small catalog still fills every row. */
function take<T>(list: T[], start: number, count: number): T[] {
  if (list.length === 0) return [];
  return Array.from({ length: count }, (_, i) => list[(start + i) % list.length]);
}

function PosterTile({
  poster,
  sizes = '160px',
  priority = false,
  className = '',
}: {
  poster: { title: string; cover: string };
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`poster-card aspect-[2/3] ${className}`}>
      <Image
        src={poster.cover}
        alt=""
        fill
        sizes={sizes}
        loading={priority ? 'eager' : undefined}
        fetchPriority={priority ? 'high' : undefined}
        className="object-cover"
        draggable={false}
      />
    </div>
  );
}

/** Section heading: kanji tag, then a big display line. */
function Heading({
  id,
  kanji,
  label,
  children,
}: {
  id: string;
  kanji: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="kanji-tag mb-4">
        {kanji}{' '}
        <span className="font-sans text-[11px] font-medium tracking-[0.2em] text-[#c9bdb0] uppercase">{label}</span>
      </p>
      <h2 id={id} className="font-display text-[clamp(1.9rem,3.8vw,3.1rem)] leading-[1.05] tracking-[-0.01em]">
        {children}
      </h2>
    </div>
  );
}

export default function Landing({
  signupsOpen,
  demoEnabled,
  showcase,
}: {
  signupsOpen: boolean;
  demoEnabled: boolean;
  showcase: Showcase;
}) {
  const router = useRouter();
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const { posters, chain, catalogSize } = showcase;
  const chainItems = chain?.items ?? take(posters, 0, 4).map((p) => ({ ...p, kind: '', year: null }));
  const query = chainItems[0]?.title ?? 'Fullmetal Alchemist';
  const wallColumns = Array.from({ length: 7 }, (_, i) => take(posters, i * 6, 8));

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      // Whatever the motion preference, the hero content must end up visible.
      gsap.set('[data-hero]', { opacity: 1 });

      /* ── how it works: a self-running loop, independent of scrolling ── */
      const demo = demoTimeline();

      mm.add('(prefers-reduced-motion: reduce)', () => {
        // One still frame that shows all three steps' results at once.
        demo.pause(7.9);
        el.querySelector('[data-warn]')?.setAttribute('data-in', '');
      });

      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          wide: '(min-width: 768px)',
          fine: '(pointer: fine)',
        },
        (c) => {
          const { motion, wide, fine } = c.conditions as Record<string, boolean>;
          if (!motion) return;

          const smoother = ScrollSmoother.create({
            wrapper: '#smooth-wrapper',
            content: '#smooth-content',
            smooth: 1.15,
            effects: true,
            smoothTouch: false,
          });

          // Only spend frames on the demo while it can be seen.
          ScrollTrigger.create({
            trigger: '[data-story]',
            start: 'top bottom',
            end: 'bottom top',
            onToggle: (self) => (self.isActive ? demo.play() : demo.pause()),
          });

          /* ── hero: letters rise through a mask ── */
          const split = SplitText.create('[data-split]', { type: 'chars,words', mask: 'chars' });
          gsap
            .timeline({ defaults: { ease: 'expo.out' } })
            .from(split.chars, { yPercent: 115, rotate: 8, duration: 1.1, stagger: 0.025 })
            .from('[data-hero-fade]', { y: 24, opacity: 0, duration: 0.9, stagger: 0.08 }, '-=0.75')
            .from('[data-wall]', { opacity: 0, scale: 1.15, duration: 2.2, ease: 'power2.out' }, 0);

          /* ── hero: the wall falls away as you scroll ── */
          const heroScrub = { trigger: '[data-hero-section]', start: 'top top', end: 'bottom top', scrub: true };
          gsap.to('[data-wall-scroll]', { scale: 1.35, opacity: 0.15, filter: 'blur(6px)', ease: 'none', scrollTrigger: heroScrub });
          gsap.to('[data-hero-copy]', { yPercent: -35, opacity: 0, ease: 'none', scrollTrigger: { ...heroScrub } });

          if (fine) {
            /* the wall leans toward the pointer */
            const rx = gsap.quickTo('[data-wall-tilt]', 'rotationX', { duration: 1.2, ease: 'power3.out' });
            const ry = gsap.quickTo('[data-wall-tilt]', 'rotationY', { duration: 1.2, ease: 'power3.out' });
            const onMove = (e: PointerEvent) => {
              rx(26 - (e.clientY / innerHeight - 0.5) * 8);
              ry((e.clientX / innerWidth - 0.5) * 10);
            };
            window.addEventListener('pointermove', onMove);

            /* magnetic buttons */
            const offs = gsap.utils.toArray<HTMLElement>('[data-magnetic]').map((m) => {
              const mx = gsap.quickTo(m, 'x', { duration: 0.5, ease: 'power3.out' });
              const my = gsap.quickTo(m, 'y', { duration: 0.5, ease: 'power3.out' });
              const move = (e: PointerEvent) => {
                const r = m.getBoundingClientRect();
                mx((e.clientX - (r.left + r.width / 2)) * 0.3);
                my((e.clientY - (r.top + r.height / 2)) * 0.4);
              };
              const leave = () => {
                mx(0);
                my(0);
              };
              m.addEventListener('pointermove', move);
              m.addEventListener('pointerleave', leave);
              return () => {
                m.removeEventListener('pointermove', move);
                m.removeEventListener('pointerleave', leave);
              };
            });

            c.add(() => () => {
              window.removeEventListener('pointermove', onMove);
              offs.forEach((off) => off());
            });
          }

          /* ── word band: leans into the scroll ── */
          const skew = gsap.quickTo('[data-skew]', 'skewX', { duration: 0.4, ease: 'power3.out' });
          ScrollTrigger.create({
            onUpdate: (self) => skew(gsap.utils.clamp(-12, 12, self.getVelocity() / -250)),
          });

          /* ── generic reveals ── */
          gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((node) => {
            gsap.fromTo(
              node,
              { y: 60, opacity: 0 },
              { y: 0, opacity: 1, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: node, start: 'top 88%' } },
            );
          });

          /* ── the warning: slam the stamp, shake the card, run the marker ── */
          const warn = el.querySelector<HTMLElement>('[data-warn]');
          if (warn) {
            gsap
              .timeline({ scrollTrigger: { trigger: warn, start: 'top 75%' } })
              .from(warn, { y: 80, opacity: 0, rotate: -2, duration: 0.9, ease: 'expo.out' })
              .from('[data-stamp]', { scale: 2.6, opacity: 0, rotate: -40, duration: 0.45, ease: 'power4.in' }, '-=0.2')
              .to(warn, { x: 8, duration: 0.05, repeat: 5, yoyo: true, ease: 'none' })
              .set(warn, { x: 0 })
              .call(() => warn.setAttribute('data-in', ''));
          }

          /* ── screens: sideways on wide screens ── */
          if (wide) {
            const track = el.querySelector<HTMLElement>('[data-track]');
            if (track) {
              const distance = () => track.scrollWidth - innerWidth + 64;
              gsap.to(track, {
                x: () => -distance(),
                ease: 'none',
                scrollTrigger: {
                  trigger: '[data-screens]',
                  start: 'top top',
                  end: () => `+=${distance()}`,
                  pin: true,
                  scrub: 0.8,
                  invalidateOnRefresh: true,
                },
              });
            }
          }

          /* ── catalog counter ── */
          const counter = el.querySelector<HTMLElement>('[data-count]');
          if (counter) {
            const state = { n: 0 };
            gsap.to(state, {
              n: Number(counter.dataset.count),
              duration: 2,
              ease: 'power2.out',
              scrollTrigger: { trigger: counter, start: 'top 85%' },
              onUpdate: () => {
                counter.textContent = Math.round(state.n).toLocaleString('en-US');
              },
            });
          }

          /* ── closing line ── */
          const outro = SplitText.create('[data-outro]', { type: 'words', mask: 'words' });
          gsap.from(outro.words, {
            yPercent: 110,
            duration: 1.2,
            ease: 'expo.out',
            stagger: 0.08,
            scrollTrigger: { trigger: '[data-outro]', start: 'top 85%' },
          });

          return () => {
            smoother.kill();
            split.revert();
            outro.revert();
          };
        },
      );

      /**
       * The demo: type the title → untangle the series → announce the sequel,
       * then start over. Every state is SET at time 0, so each repeat begins
       * from a clean slate instead of whatever the last loop left behind.
       */
      function demoTimeline() {
        const cards = gsap.utils.toArray<HTMLElement>('[data-chain]');
        const steps = gsap.utils.toArray<HTMLElement>('[data-step]');
        const bars = gsap.utils.toArray<HTMLElement>('[data-step-bar]');
        const chars = gsap.utils.toArray<HTMLElement>('[data-typed] span');
        const n = cards.length;
        const focus = (i: number) => (k: number) => (k === i ? 1 : 0.35);

        const tl = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: 'power3.out' } });
        tl.set('[data-stage-inner]', { opacity: 1 }, 0)
          .set(cards, { xPercent: -50, yPercent: -50, left: '50%', top: '54%', opacity: 0, scale: 0.6, rotate: (k: number) => k * 7 }, 0)
          .set(chars, { opacity: 0 }, 0)
          .set('[data-search]', { opacity: 1 }, 0)
          .set('[data-chain-label]', { opacity: 0, y: 8 }, 0)
          .set('[data-chain-line]', { scaleX: 0 }, 0)
          .set('[data-glow]', { opacity: 0 }, 0)
          .set('[data-notify]', { opacity: 0, y: 40 }, 0)
          .set(bars, { scaleX: 0 }, 0)
          .set(steps, { opacity: focus(0) }, 0);

        // 1 — tell it once
        tl.to(bars[0] ?? [], { scaleX: 1, duration: 2.5, ease: 'none' }, 0)
          .to(chars, { opacity: 1, duration: 0.01, stagger: Math.min(0.07, 1.3 / Math.max(chars.length, 1)) }, 0.3)
          .to(cards[0] ?? [], { opacity: 1, scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(1.7)' }, 1.7);

        // 2 — it works out the rest
        tl.to(steps, { opacity: focus(1), duration: 0.3 }, 2.6)
          .to(bars[1] ?? [], { scaleX: 1, duration: 2.5, ease: 'none' }, 2.6)
          .to('[data-search]', { opacity: 0.35, duration: 0.4 }, 2.6)
          .to(
            cards,
            {
              opacity: 1,
              scale: 0.95,
              rotate: 0,
              xPercent: (k: number) => -50 + (k - (n - 1) / 2) * 108,
              duration: 1,
              ease: 'expo.out',
              stagger: 0.06,
            },
            2.7,
          )
          .to('[data-chain-line]', { scaleX: 1, duration: 0.8 }, 3.1)
          .to('[data-chain-label]', { opacity: 1, y: 0, stagger: 0.1, duration: 0.4 }, 3.3);

        // 3 — it tells you when it's out
        tl.to(steps, { opacity: focus(2), duration: 0.3 }, 5.2)
          .to(bars[2] ?? [], { scaleX: 1, duration: 2.8, ease: 'none' }, 5.2)
          .to(cards.slice(0, -1), { opacity: 0.4, duration: 0.5 }, 5.3)
          .to(cards.slice(-1), { scale: 1.1, duration: 0.6, ease: 'back.out(2)' }, 5.3)
          .to('[data-glow]', { opacity: 1, duration: 0.5 }, 5.4)
          .to('[data-notify]', { opacity: 1, y: 0, duration: 0.7, ease: 'back.out(1.4)' }, 5.6);

        // hold, then clear the stage for the next round
        tl.to('[data-stage-inner]', { opacity: 0, duration: 0.45 }, 8.6);
        return tl;
      }
    }, el);

    return () => ctx.revert();
  }, []);

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

  // A plain function, not a component: a component declared inside render
  // would be a new type every render and remount its buttons.
  function actions(where: 'top' | 'bottom') {
    return (
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
        {demoEnabled ? (
          <button type="button" onClick={tryDemo} disabled={demoBusy} className="cta cta-primary" data-magnetic>
            {demoBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Try the demo
            <ArrowRight className="cta-arrow size-4" />
          </button>
        ) : null}
        {signupsOpen ? (
          <Link
            href="/sign-in?mode=register"
            className={`cta ${demoEnabled ? 'cta-outline' : 'cta-primary'}`}
            data-cta={`register-${where}`}
            data-magnetic
          >
            Create an account
          </Link>
        ) : null}
        <Link
          href="/sign-in"
          className={`cta ${demoEnabled || signupsOpen ? 'cta-ghost' : 'cta-primary'}`}
          data-cta={`signin-${where}`}
          data-magnetic
        >
          <span className="u">Sign in</span>
          <ArrowRight className="cta-arrow size-4" />
        </Link>
      </div>
    );
  }

  return (
    <div ref={root} className="welcome">
      {/* ── background: ink, drifting flame aura, screentone, grain ── */}
      <InkBackdrop />
      {/* No-JS and crawlers: never leave the headline hidden. */}
      <noscript>
        <style>{'[data-hero]{opacity:1!important}'}</style>
      </noscript>

      <header className="fixed inset-x-0 top-0 z-50 bg-gradient-to-b from-[var(--ink)]/90 via-[var(--ink)]/50 to-transparent">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full bg-[var(--flame)]"
              style={{ boxShadow: '0 0 18px var(--flame)' }}
            />
            <span className="font-display text-[18px] tracking-[0.01em]">AnimeMind</span>
          </Link>
          <Link href="/sign-in" className="cta cta-outline !min-h-9 !rounded-full !px-4 !text-xs">
            Sign in
          </Link>
        </div>
      </header>

      <div id="smooth-wrapper" className="relative z-10">
        <div id="smooth-content">
          {/* ───────────────────────── hero ───────────────────────── */}
          <section data-hero-section className="relative flex min-h-[100svh] items-center justify-center overflow-hidden">
            <div aria-hidden data-wall-scroll className="absolute inset-0 [perspective:1400px]">
              <div data-wall className="absolute top-1/2 left-1/2 w-[190vw] -translate-x-1/2 -translate-y-1/2 sm:w-[150vw]">
                <div
                  data-wall-tilt
                  className="grid grid-cols-4 gap-3 sm:grid-cols-7 sm:gap-4"
                  style={{ transform: 'rotateX(26deg) rotateZ(-14deg)', transformStyle: 'preserve-3d' }}
                >
                  {wallColumns.map((col, i) => (
                    <div key={i} className={`h-[150vh] overflow-hidden ${i >= 4 ? 'hidden sm:block' : ''}`}>
                      <div
                        className={`loop-y flex flex-col gap-3 sm:gap-4 ${i % 2 ? 'reverse' : ''}`}
                        style={{ '--loop-dur': `${70 + i * 9}s` } as React.CSSProperties}
                      >
                        {[...col, ...col].map((p, k) => (
                          <PosterTile key={k} poster={p} sizes="(min-width: 640px) 14vw, 25vw" priority={k < 4} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Shade the wall in ink and flame so the words always win. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 65% 60% at 50% 52%, rgb(11 8 6 / 0.95) 0%, rgb(11 8 6 / 0.82) 45%, rgb(11 8 6 / 0.35) 80%), linear-gradient(to bottom, rgb(11 8 6 / 0.6), transparent 25%, transparent 65%, var(--ink)), linear-gradient(115deg, rgb(255 106 26 / 0.25), transparent 40%, rgb(255 46 77 / 0.2))',
              }}
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="focus-lines" />
            </div>

            <div data-hero-copy className="relative z-10 mx-auto max-w-4xl px-4 pt-20 text-center">
              <div data-hero style={{ opacity: 0 }}>
                <p
                  data-hero-fade
                  className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--flame)]/40 bg-black/50 px-3.5 py-1.5 text-[11px] font-medium tracking-[0.18em] text-[var(--gold)] uppercase backdrop-blur-md"
                >
                  <span className="jp text-[13px] tracking-normal text-[var(--flame)]">記憶</span> A personal anime tracker
                </p>
                <h1
                  data-split
                  className="font-display mb-5 text-[clamp(2.6rem,8.4vw,6.4rem)] leading-[1.14] tracking-[-0.01em]"
                >
                  Never forget what you{' '}
                  <span className="text-[var(--flame)] [text-shadow:0_0_40px_rgb(255_106_26/0.55)]">watched.</span>
                </h1>
                <p data-hero-fade className="mx-auto mb-10 max-w-xl text-[15px] leading-relaxed text-[#d8cfc6] sm:text-base">
                  AnimeMind remembers where you got to in every series, works out what comes
                  next, and tells you the moment a new season is out.
                </p>
                <div data-hero-fade>{actions('top')}</div>
                {demoEnabled ? (
                  <p data-hero-fade className="mt-5 text-xs text-[#c9bdb0]">
                    The demo needs no account — it opens a shared sample library.
                  </p>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    className="mx-auto mt-4 max-w-sm rounded-lg border border-[var(--ember)]/40 bg-[var(--ember)]/10 px-3 py-2 text-xs text-[#ff8a9a]"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            </div>

            <div aria-hidden className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
              <span className="t-label">Scroll</span>
              <span className="scroll-cue h-10 w-px bg-[var(--flame)]" />
            </div>
          </section>

          {/* ───────────────────────── word band ───────────────────────── */}
          <section aria-hidden className="-rotate-2 overflow-hidden border-y-2 border-[var(--flame)]/60 bg-[var(--flame)]/[0.08] py-5">
            <div data-skew className="flex flex-col gap-1">
              {[false, true].map((rev) => (
                <div key={String(rev)} className="flex w-max">
                  <div
                    className={`loop-x flex w-max items-center ${rev ? 'reverse' : ''}`}
                    style={{ '--loop-dur': '45s' } as React.CSSProperties}
                  >
                    {[...WORDS, ...WORDS, ...WORDS, ...WORDS].map((w, k) => (
                      <span
                        key={k}
                        className={`font-display flex items-center gap-8 px-4 text-[clamp(2rem,5.4vw,4.2rem)] leading-[1.15] whitespace-nowrap uppercase ${
                          (k + (rev ? 1 : 0)) % 2 ? 'text-outline' : ''
                        }`}
                      >
                        {w}
                        <span className="text-[0.5em] text-[var(--flame)]">✦</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ───────────────────────── how it works ───────────────────────── */}
          <section data-story aria-labelledby="how" className="relative py-24 sm:py-32">
            <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-8 md:grid-cols-[0.85fr_1.15fr]">
              <div>
                <Heading id="how" kanji="使い方" label="How it works">
                  You do <span className="brush-underline relative z-0">one</span> thing.
                  <br />
                  <span className="text-[#c9bdb0]">It does the rest.</span>
                </Heading>
                <ol className="mt-10 flex flex-col gap-5">
                  {STEPS.map((s, i) => (
                    <li key={s.title} data-step className="flex gap-4">
                      <span className="font-display flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--flame)]/50 bg-[var(--flame)]/15 text-base text-[var(--flame)]">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="t-heading mb-1 flex items-center gap-2">
                          <s.icon className="size-4 text-[var(--gold)]" />
                          {s.title}
                        </h3>
                        <p className="max-w-sm text-[13px] leading-relaxed text-[#d6cbbf]">{s.body}</p>
                        <div className="mt-3 h-[3px] max-w-sm overflow-hidden rounded-full bg-white/10">
                          <div
                            data-step-bar
                            className="step-bar h-full rounded-full bg-gradient-to-r from-[var(--gold)] via-[var(--flame)] to-[var(--ember)]"
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* The stage: a little window into the app, playing on a loop */}
              <div className="relative mx-auto w-full max-w-[620px]">
                <div
                  aria-hidden
                  className="absolute -inset-6 rounded-[2rem] bg-[radial-gradient(closest-side,rgb(255_106_26/0.35),transparent)] blur-2xl"
                />
                <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-[#120d0a]/90 shadow-[0_40px_120px_-30px_rgb(255_106_26/0.55)] backdrop-blur-xl">
                  <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                    <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="size-2.5 rounded-full bg-[#febc2e]" />
                    <span className="size-2.5 rounded-full bg-[#28c840]" />
                    <span className="ml-3 text-xs text-[#c9bdb0]">AnimeMind · Today</span>
                    <span className="ml-auto flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-[var(--flame)] uppercase">
                      <span className="size-1.5 animate-pulse rounded-full bg-[var(--flame)]" /> Live demo
                    </span>
                  </div>
                  <div data-stage-inner className="relative aspect-square sm:aspect-[5/4]">
                    <div
                      data-search
                      className="absolute top-5 left-1/2 flex h-14 w-[88%] -translate-x-1/2 items-center gap-3 rounded-2xl border-2 border-[var(--flame)]/60 bg-black/50 px-4 shadow-[0_0_30px_-8px_var(--flame)]"
                    >
                      <Search className="size-5 shrink-0 text-[var(--flame)]" />
                      <span data-typed className="truncate text-base font-medium">
                        {query.split('').map((ch, i) => (
                          <span key={i}>{ch}</span>
                        ))}
                      </span>
                      <span className="h-5 w-0.5 animate-pulse bg-[var(--flame)]" />
                    </div>

                    <div
                      data-chain-line
                      className="absolute top-[54%] right-[10%] left-[10%] h-0.5 origin-left bg-gradient-to-r from-transparent via-[var(--flame)] to-transparent"
                    />

                    {chainItems.map((item, i) => (
                      <div key={i} data-chain className="absolute w-[21%]">
                        {i === chainItems.length - 1 ? (
                          <div
                            data-glow
                            className="absolute -inset-2 rounded-xl"
                            style={{ boxShadow: '0 0 0 2px var(--gold), 0 0 50px var(--flame)' }}
                          />
                        ) : null}
                        <PosterTile poster={item} sizes="150px" />
                        <p data-chain-label className="mt-2 truncate text-center text-[11px] font-medium text-[#d8cfc6]">
                          {[KIND_LABEL[item.kind], item.year].filter(Boolean).join(' · ') || item.title}
                        </p>
                      </div>
                    ))}

                    <div
                      data-notify
                      className="absolute right-4 bottom-4 left-4 flex items-center gap-3 rounded-2xl border border-[var(--gold)]/50 bg-gradient-to-r from-[#2a140a] to-[#1a0d0a] p-3.5 shadow-[0_20px_50px_-10px_rgb(0_0_0/0.8)]"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gold)] via-[var(--flame)] to-[var(--ember)]">
                        <Bell className="size-5 text-[#1a0900]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--gold)] uppercase">New season available</p>
                        <p className="truncate text-[15px] font-medium">{chainItems.at(-1)?.title}</p>
                      </div>
                    </div>
                  </div>
                </div>
                {chain ? (
                  <p className="mt-4 text-center text-[11px] text-[#b7aa9c]">A real series from the catalog: {chain.title}</p>
                ) : null}
              </div>
            </div>
          </section>

          {/* ───────────────────────── screens ───────────────────────── */}
          <section
            data-screens
            aria-labelledby="inside"
            className="relative overflow-hidden py-20 md:flex md:min-h-[100svh] md:flex-col md:justify-center"
          >
            <div className="mx-auto mb-10 w-full max-w-6xl px-4 sm:px-8">
              <Heading id="inside" kanji="中身" label="What you’ll find inside">
                Five screens. <span className="flame-text">Zero spreadsheets.</span>
              </Heading>
            </div>
            <div
              data-track
              className="flex flex-col gap-5 px-4 sm:px-8 md:w-max md:flex-row md:gap-7 md:pl-[max(2rem,calc((100vw-72rem)/2+2rem))]"
            >
              {SCREENS.map((s, i) => {
                const fan = take(posters, 8 + i * 3, 3);
                return (
                  <article
                    key={s.name}
                    data-reveal
                    className="manga-panel relative flex min-h-[320px] overflow-hidden p-6 sm:p-8 md:h-[58vh] md:w-[min(64vw,760px)]"
                    style={{ rotate: `${i % 2 ? 0.6 : -0.6}deg` }}
                  >
                    <div className="tone" />
                    <span
                      aria-hidden
                      className="font-display num-outline pointer-events-none absolute right-6 bottom-[-0.12em] text-[clamp(8rem,18vw,15rem)] leading-none"
                    >
                      0{i + 1}
                    </span>
                    <div className="relative z-10 flex max-w-[58%] flex-col">
                      <span className="kanji-tag">{s.kanji}</span>
                      <span className="font-display mt-3 text-sm text-[#c9bdb0]">
                        <span className="text-[var(--gold)]">0{i + 1}</span> / 05
                      </span>
                      <s.icon className="mt-auto mb-4 size-7 text-[var(--flame)]" />
                      <h3 className="font-display mb-3 text-[clamp(2.2rem,5.4vw,4.4rem)] leading-[0.95]">{s.name}</h3>
                      <p className="text-[14px] leading-relaxed text-[#d6cbbf]">{s.body}</p>
                    </div>
                    <div aria-hidden className="fan absolute top-1/2 right-[-4%] h-[85%] w-[52%] -translate-y-1/2">
                      {fan.map((p, k) => (
                        <div
                          key={k}
                          className="absolute top-1/2 w-[48%]"
                          style={{
                            left: `${8 + k * 24}%`,
                            transform: `translate(0, -50%) rotate(${(k - 1) * 8}deg)`,
                            zIndex: k === 1 ? 2 : 1,
                          }}
                        >
                          <PosterTile poster={p} sizes="200px" />
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* ───────────────────────── poster ribbons ───────────────────────── */}
          {posters.length > 0 ? (
            <section aria-labelledby="catalog" className="relative overflow-hidden pt-8 pb-24">
              <div className="mx-auto mb-12 max-w-6xl px-4 text-center sm:px-8" data-reveal>
                <p className="kanji-tag mb-2 justify-center">作品</p>
                <p id="catalog" className="font-display pop-shadow text-[clamp(4rem,13vw,10rem)] leading-none">
                  <span data-count={catalogSize} className="flame-text tnum">
                    {catalogSize.toLocaleString('en-US')}
                  </span>
                  <span className="text-[var(--gold)]">+</span>
                </p>
                <p className="mt-4 text-sm text-[#d6cbbf]">titles already mapped — seasons, films and specials in watch order.</p>
              </div>
              <div className="loop-pause flex -rotate-3 flex-col gap-4 [scale:1.08]" aria-hidden>
                {[0, 1].map((row) => {
                  const strip = take(posters, row * 14, 14);
                  return (
                    <div key={row} className="flex w-max">
                      <div
                        className={`loop-x flex w-max gap-4 ${row ? 'reverse' : ''}`}
                        style={{ '--loop-dur': `${90 + row * 20}s` } as React.CSSProperties}
                      >
                        {[...strip, ...strip].map((p, k) => (
                          <PosterTile key={k} poster={p} sizes="150px" className="w-[110px] shrink-0 sm:w-[150px]" />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* ───────────────────────── the warning ───────────────────────── */}
          <section aria-labelledby="know" className="px-4 py-20 sm:px-8">
            <div data-warn className="warn-card relative mx-auto max-w-3xl overflow-hidden rounded-3xl">
              <div aria-hidden className="hazard h-3" />
              <div className="relative p-6 sm:p-10">
                <div
                  data-stamp
                  aria-hidden
                  className="stamp font-display absolute top-6 right-5 hidden rotate-[-10deg] px-3 py-1.5 text-center text-sm leading-tight sm:block"
                >
                  NO
                  <br />
                  RESET
                </div>
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--gold)] to-[var(--ember)] shadow-[0_0_30px_-4px_var(--flame)]">
                    <TriangleAlert className="size-6 text-[#1a0900]" />
                  </span>
                  <div>
                    <p className="kanji-tag">注意 · Read this first</p>
                    <h2 id="know" className="font-display mt-1 text-[clamp(1.4rem,3vw,2rem)] leading-tight">
                      Before you sign up
                    </h2>
                  </div>
                </div>
                <p className="mb-6 text-[clamp(1.05rem,2vw,1.3rem)] leading-snug font-medium">
                  <span className="marker">There is no password reset and no email.</span> If you forget your
                  password, your account and library are <span className="text-[#ff6b7f]">gone for good</span>.
                </p>
                <ul className="grid gap-3 text-[14px] leading-relaxed text-[#c9bdb2] sm:grid-cols-2">
                  <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">🔑 Keep your password in a password manager.</li>
                  <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                    🛠️ AnimeMind is a personal project, built and run by one person.
                  </li>
                  {demoEnabled ? (
                    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                      🔄 The demo library is shared and resets every night.
                    </li>
                  ) : null}
                  <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                    🎞️ Anime details and posters come from Kitsu and MyAnimeList.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* ───────────────────────── outro ───────────────────────── */}
          <section className="px-4 pt-10 pb-24 text-center sm:px-8">
            <p className="kanji-tag mb-5 justify-center">始めよう</p>
            <h2
              data-outro
              className="font-display mx-auto mb-12 max-w-4xl text-[clamp(2.5rem,8vw,6rem)] leading-[1] tracking-[-0.01em]"
            >
              Start <span className="text-[var(--flame)]">remembering.</span>
            </h2>
            {actions('bottom')}
            <p className="mt-16 text-xs text-[#b7aa9c]">AnimeMind · a personal project · posters from Kitsu &amp; MyAnimeList</p>
          </section>
        </div>
      </div>
    </div>
  );
}
