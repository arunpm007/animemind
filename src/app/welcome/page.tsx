import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { demoEnabled, signupsOpen } from '@/server/auth/config';
import Landing from './Landing';

// Reads deployment switches and the session cookie at request time.
export const dynamic = 'force-dynamic';

/**
 * The front door for someone who has never been here.
 *
 * A bare email + password form answers "how do I get in" before anyone has
 * asked "what is this". New visitors land here first; the session route only
 * sends them to /sign-in directly when they have been signed in before.
 */
export default async function WelcomePage() {
  if (await currentActor()) redirect('/');
  return <Landing signupsOpen={signupsOpen()} demoEnabled={demoEnabled()} />;
}
