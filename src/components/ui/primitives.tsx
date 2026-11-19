import Link from 'next/link';
import { PosterImage } from './PosterImage';
import type { ReleaseStatusDto, WorkSummary } from '@/contracts';
import { cn } from '@/lib/cn';

/* ───────────────────────────── status ───────────────────────────── */

/**
 * Release status — what the SHOW is doing, never what the user has done.
 *
 * The wording here is deliberately disjoint from the watch-status vocabulary
 * ("completed", "watching"). Labelling a finished broadcast "Complete" put
 * "● Complete" directly above "0/12" on the series page, which reads as a
 * contradiction: it looks like a claim about the viewer, not the broadcast.
 * "Finished airing" can only be read one way.
 */
const STATUS_META: Record<
  ReleaseStatusDto,
  { label: string; color: string; short: string }
> = {
  airing: { label: 'Airing now', color: 'var(--color-airing)', short: 'Airing' },
  not_yet_aired: {
    label: 'Announced',
    color: 'var(--color-announced)',
    short: 'Announced',
  },
  finished: {
    label: 'Finished airing',
    color: 'var(--color-unknown)',
    short: 'Aired',
  },
  cancelled: { label: 'Cancelled', color: 'var(--color-ended)', short: 'Cancelled' },
  hiatus: { label: 'On hiatus', color: 'var(--color-upcoming)', short: 'Hiatus' },
  unknown: { label: 'Unknown', color: 'var(--color-unknown)', short: 'Unknown' },
};

/**
 * Status is a dot AND a word, never a dot alone.
 *
 * Colour-blind users aside, this also survives a greyscale screenshot and a
 * bad monitor — and people do screenshot their libraries.
 */
export function StatusDot({
  status,
  short = false,
  className,
}: {
  status: ReleaseStatusDto;
  short?: boolean;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: meta.color }}
      />
      <span style={{ color: meta.color }}>{short ? meta.short : meta.label}</span>
    </span>
  );
}

/* ──────────────────────────── progress ──────────────────────────── */

export function ProgressBar({
  value,
  total,
  className,
}: {
  value: number;
  total: number | null;
  className?: string;
}) {
  // An unknown total is shown as indeterminate rather than as 0%, which would
  // read as "you have watched nothing" for every currently-airing show.
  const pct = total && total > 0 ? Math.min(100, (value / total) * 100) : null;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-[320ms]"
          style={{
            width: pct === null ? '100%' : `${pct}%`,
            opacity: pct === null ? 0.25 : 1,
          }}
        />
      </div>
      <span className="tnum shrink-0 text-xs text-[var(--color-dim)]">
        {value}
        <span className="text-[var(--color-mute)]">/{total ?? '?'}</span>
      </span>
    </div>
  );
}

/* ───────────────────────────── poster ───────────────────────────── */

export function Poster({
  work,
  href,
  priority,
  className,
  quiet,
}: {
  work: WorkSummary;
  href?: string;
  priority?: boolean;
  className?: string;
  /** The title is shown beside this poster — see PosterImage. */
  quiet?: boolean;
}) {
  const inner = (
    <div className={cn('group relative', className)}>
      <div className="poster relative overflow-hidden">
        <PosterImage src={work.coverUrl} title={work.title} priority={priority} quiet={quiet} />
        {/* Bottom scrim so a title over art stays legible on pale covers. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/3 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(to top, hsl(230 25% 2% / 0.85), transparent)',
          }}
        />
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block rounded-lg">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Poster plus the two facts worth showing at grid size. */
export function PosterCard({
  work,
  href,
  footer,
  priority,
}: {
  work: WorkSummary;
  href?: string;
  footer?: React.ReactNode;
  priority?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Poster work={work} href={href} priority={priority} />
      <div className="flex flex-col gap-1">
        <p className="line-clamp-2 text-[13px] leading-snug font-medium">
          {href ? (
            <Link href={href} className="hover:text-[var(--color-accent-soft)]">
              {work.title}
            </Link>
          ) : (
            work.title
          )}
        </p>
        {footer ?? (
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-mute)]">
            <StatusDot status={work.status} short />
            {work.seasonYear ? <span>· {work.seasonYear}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── layout ───────────────────────────── */

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="t-label flex items-center gap-2">
          <span aria-hidden className="h-[2px] w-5 rounded-full bg-gradient-to-r from-[var(--gold)] to-[var(--flame)]" />
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
      {children}
    </div>
  );
}

/**
 * An empty state that reads as an achievement where it is one.
 *
 * "Nothing is waiting on you" is good news, and the UI should say so rather
 * than showing the usual apologetic empty box.
 */
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="pane relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border-dashed px-6 py-8">
      <p className="t-heading">{title}</p>
      {body ? (
        <p className="max-w-prose text-sm text-[var(--color-dim)]">{body}</p>
      ) : null}
      {action}
    </div>
  );
}
