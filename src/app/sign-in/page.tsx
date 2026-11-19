import { demoEnabled, signupsOpen } from '@/server/auth/config';
import { getShowcase } from '@/server/services/showcase';
import SignInForm from './SignInForm';

// Reads deployment switches at request time.
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const open = signupsOpen();
  // "Create an account" on the welcome page links here with ?mode=register.
  const { mode } = await searchParams;
  const { posters } = await getShowcase();
  return (
    <SignInForm
      signupsOpen={open}
      demoEnabled={demoEnabled()}
      initialMode={open && mode === 'register' ? 'register' : 'login'}
      posters={posters.slice(0, 24).map((p) => ({ title: p.title, cover: p.cover }))}
    />
  );
}
