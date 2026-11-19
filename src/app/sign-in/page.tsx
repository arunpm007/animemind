import { demoEnabled, signupsOpen } from '@/server/auth/config';
import SignInForm from './SignInForm';

// Reads deployment switches at request time.
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const open = signupsOpen();
  // "Create an account" on the landing page links here with ?mode=register.
  const { mode } = await searchParams;
  return (
    <SignInForm
      signupsOpen={open}
      demoEnabled={demoEnabled()}
      initialMode={open && mode === 'register' ? 'register' : 'login'}
    />
  );
}
