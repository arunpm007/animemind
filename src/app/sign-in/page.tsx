import { demoEnabled, signupsOpen } from '@/server/auth/config';
import SignInForm from './SignInForm';

// Reads deployment switches at request time.
export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return <SignInForm signupsOpen={signupsOpen()} demoEnabled={demoEnabled()} />;
}
