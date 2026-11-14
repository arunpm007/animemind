'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clock3, Compass, Library, Search, Tv } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Navigation is five destinations and a search key. That ceiling is a
 * deliberate constraint: this product's failure mode is becoming a second
 * MyAnimeList, and a growing nav is the first symptom. Anything that wants to
 * be a sixth item belongs inside one of these five.
 */
const NAV = [
  { href: '/', label: 'Today', icon: Compass },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/watching', label: 'Watching', icon: Tv },
  { href: '/waiting', label: 'Waiting', icon: Clock3 },
] as const;

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const path = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 border-r border-[var(--color-border)] px-3 py-5 md:flex md:w-[208px]">
      <Link href="/" className="mb-5 flex items-center gap-2.5 px-2">
        <span
          aria-hidden
          className="size-2 rounded-full bg-[var(--color-accent)]"
          style={{ boxShadow: '0 0 12px var(--color-accent)' }}
        />
        <span className="text-[15px] font-semibold tracking-[-0.02em]">AnimeMind</span>
      </Link>

      <button
        type="button"
        onClick={onSearch}
        className="mb-3 flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-sm text-[var(--color-mute)] transition-colors duration-[160ms] ease-[var(--ease-state)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-dim)]"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-mute)]">
          ⌘K
        </kbd>
      </button>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-[160ms] ease-[var(--ease-state)]',
                active
                  ? 'bg-[var(--color-raised)] text-[var(--color-text)]'
                  : 'text-[var(--color-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-[var(--color-accent)]"
                />
              ) : null}
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3">
        <form action="/api/v1/auth/logout" method="post">
          <button
            type="submit"
            className="text-xs text-[var(--color-mute)] transition-colors hover:text-[var(--color-dim)]"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

/** Mobile: the same five destinations, thumb-reachable. */
export function TabBar({ onSearch }: { onSearch: () => void }) {
  const path = usePathname();
  return (
    <nav className="pane fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around rounded-t-2xl px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] transition-colors duration-[160ms]',
              active ? 'text-[var(--color-accent)]' : 'text-[var(--color-mute)]',
            )}
          >
            <Icon className="size-[18px]" />
            {label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onSearch}
        className="flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] text-[var(--color-mute)]"
      >
        <Search className="size-[18px]" />
        Search
      </button>
    </nav>
  );
}
