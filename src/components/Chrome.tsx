'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clock3, Compass, Library, ListChecks, Search, Tv, UserRound } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ShortcutKey } from './ClientOnly';

/**
 * Navigation is five destinations and a search key. That ceiling is a
 * deliberate constraint: this product's failure mode is becoming a second
 * MyAnimeList, and a growing nav is the first symptom. Anything that wants to
 * be a sixth item belongs inside one of these five.
 *
 * The fifth slot is now spent, on "Up next". It earns it by being the only
 * home for `planned` and `on_hold` — two of the five watch states, which the
 * add sheet used to file under "Library" and which were then unreachable in a
 * poster wall sorted by recency.
 *
 * Ordered by how much a decision is wanted: today, then the backlog, then
 * what is under way, then what has not arrived, with the archive last.
 */
const NAV = [
  { href: '/', label: 'Today', icon: Compass },
  { href: '/next', label: 'Up next', icon: ListChecks },
  { href: '/watching', label: 'Watching', icon: Tv },
  { href: '/waiting', label: 'Waiting', icon: Clock3 },
  { href: '/library', label: 'Library', icon: Library },
] as const;

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const path = usePathname();

  return (
    <aside aria-label="Main" className="sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 border-r border-[var(--color-border)] px-3 py-5 md:flex md:w-[208px]">
      <Link href="/" className="mb-5 flex items-center gap-2.5 px-2">
        <span
          aria-hidden
          className="size-2.5 rounded-full bg-[var(--flame)]"
          style={{ boxShadow: '0 0 16px var(--flame)' }}
        />
        <span className="font-display text-[17px]">AnimeMind</span>
      </Link>

      <button
        type="button"
        onClick={onSearch}
        className="mb-3 flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-sm text-[var(--color-mute)] transition-colors duration-[160ms] ease-[var(--ease-state)] hover:border-[var(--flame)]/60 hover:text-[var(--color-text)] hover:shadow-[0_0_20px_-8px_var(--flame)]"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1">Search</span>
        <ShortcutKey className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-mute)]" />
      </button>

      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-[160ms] ease-[var(--ease-state)]',
                active
                  ? 'bg-gradient-to-r from-[var(--flame)]/20 to-transparent font-medium text-[var(--color-text)]'
                  : 'text-[var(--color-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[var(--color-accent)] shadow-[0_0_12px_var(--flame)]"
                />
              ) : null}
              <Icon className={cn('size-4 shrink-0', active && 'text-[var(--flame)]')} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Account, not a bare "Sign out" in 11px muted text — settings need a
          home, and sign-out belongs inside it rather than loose in the nav. */}
      <div className="mt-auto">
        <Link
          href="/account"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-[160ms]',
            path.startsWith('/account')
              ? 'bg-[var(--color-raised)] text-[var(--color-text)]'
              : 'text-[var(--color-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
          )}
        >
          <UserRound className="size-4 shrink-0" />
          Account
        </Link>
      </div>
    </aside>
  );
}

/** Mobile: the same five destinations, thumb-reachable. */
export function TabBar({ onSearch }: { onSearch: () => void }) {
  const path = usePathname();
  return (
    // Six cells now (five destinations plus search), so the gutters and the
    // label size come down to keep them on one line at 375px.
    <nav aria-label="Sections" className="pane fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around rounded-t-2xl px-0.5 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 text-[9px] transition-colors duration-[160ms]',
              active ? 'text-[var(--color-accent)]' : 'text-[var(--color-mute)]',
            )}
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onSearch}
        className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 text-[9px] text-[var(--color-mute)]"
      >
        <Search className="size-[18px] shrink-0" />
        <span className="max-w-full truncate">Search</span>
      </button>
    </nav>
  );
}
