/**
 * Deployment switches for account creation and the public demo.
 *
 *   ALLOW_SIGNUPS=true   lets anyone create an account. Off by default in
 *                        production: open sign-up with no email verification
 *                        invites spam accounts, and there is no password reset
 *                        yet. In development it defaults to on.
 *   DEMO_EMAIL=...       enables "Try the demo": one shared account that
 *                        visitors enter with a single click and that is reset
 *                        to sample data every night.
 */

export function signupsOpen(): boolean {
  const flag = process.env.ALLOW_SIGNUPS;
  if (flag !== undefined) return flag === 'true';
  return process.env.NODE_ENV !== 'production';
}

export function demoEmail(): string | null {
  const email = process.env.DEMO_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

export function demoEnabled(): boolean {
  return demoEmail() !== null;
}
