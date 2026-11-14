/**
 * "4 months ago", for the one place it carries weight.
 *
 * On the backlog screen a paused show's age IS the information: "stopped at
 * episode 12" is a fact, "stopped at episode 12, eight months ago" is a
 * decision. An absolute date makes the reader do that subtraction themselves.
 *
 * Called from server components only, so there is no hydration mismatch to
 * worry about — the string is computed once and shipped as text.
 */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function relativeTime(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const diff = then - now;
  const abs = Math.abs(diff);

  // Below a minute "0 minutes ago" is both wrong-looking and useless.
  if (abs < 60 * 1000) return 'just now';

  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}
