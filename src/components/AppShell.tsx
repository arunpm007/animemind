'use client';

import { useEffect, useState } from 'react';
import { Sidebar, TabBar } from './Chrome';
import { SearchPalette } from './SearchPalette';
import { CinemaBackdrop } from './motion/CinemaBackdrop';

/**
 * The shell: nav, the search palette, and the z0 light.
 *
 * `accent` is passed down from whichever page is showing, so the room takes on
 * the colour of the thing you are looking at while the chrome stays neutral.
 */
export function AppShell({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: string | null;
}) {
  const [search, setSearch] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
      // "/" is the other muscle memory for search, but not while the user is
      // already typing into something.
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <CinemaBackdrop accent={accent} intensity={0.5} />
      <div className="relative z-10 flex min-h-dvh">
        <Sidebar onSearch={() => setSearch(true)} />
        {/* `relative` scopes any page-level absolute art (the series hero) to the
            content column. Without it the nearest positioned ancestor is the
            row containing the sidebar, and the art bleeds under the nav. */}
        <main className="relative min-w-0 flex-1 pb-24 md:pb-0">{children}</main>
      </div>
      <TabBar onSearch={() => setSearch(true)} />
      {search ? <SearchPalette onClose={() => setSearch(false)} /> : null}
    </>
  );
}
