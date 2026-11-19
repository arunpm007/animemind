'use client';

import { useSyncExternalStore } from 'react';

/**
 * Values that only the viewer's browser knows: their clock, their time zone,
 * their keyboard.
 *
 * Computing these during a server render is wrong twice over. The server's
 * clock is UTC in production, so a viewer in India at 2 a.m. was greeted
 * "Good evening" with yesterday's date; and when a client component computed
 * them during render instead, the server's guess and the browser's answer
 * differed and React threw "Hydration failed because the server rendered
 * text didn't match the client".
 *
 * useSyncExternalStore is React's sanctioned way out: hydration uses the
 * server snapshot (so the HTML matches), then React immediately re-renders
 * with the browser's real value. No mismatch, no effect-and-setState flash
 * logic to get wrong.
 */
const never = () => () => {};

function useClient<T>(get: () => T, server: T): T {
  return useSyncExternalStore(never, get, () => server);
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘K" on Apple devices, "Ctrl K" elsewhere; nothing until the browser says. */
export function ShortcutKey({ className }: { className?: string }) {
  const mac = useClient<boolean | null>(isMac, null);
  if (mac === null) return null;
  return <kbd className={className}>{mac ? '⌘K' : 'Ctrl K'}</kbd>;
}

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Greeting in the viewer's own time of day. */
export function Greeting({ name }: { name: string | null }) {
  const greeting = useClient(() => greetingFor(new Date().getHours()), 'Hello');
  return (
    <>
      {greeting}
      {name ? `, ${name}` : ''}.
    </>
  );
}

/** Today's date in the viewer's own calendar, e.g. "Thursday, 19 November". */
export function TodayDate() {
  return (
    <>
      {useClient(
        () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
        ' ',
      )}
    </>
  );
}

/** An absolute moment in the viewer's own locale and time zone. */
export function LocalDateTime({ iso }: { iso: string }) {
  return <>{useClient(() => new Date(iso).toLocaleString(), new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC')}</>;
}
