import { eq } from 'drizzle-orm';
import { LogOut } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { DisplayNameForm, PasswordForm } from '@/components/AccountForms';
import { unscoped } from '@/server/db/client';
import { account, authSession } from '@/server/db/schema';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Account settings.
 *
 * Previously there were none: no way to change a password, and sign-out was
 * 11px of muted text at the bottom of the sidebar. For anything holding
 * credentials, a password change is a floor, not a feature.
 */
export default async function AccountPage() {
  const actor = await requireActor('/account');
  const db = unscoped();

  const me = await db.query.account.findFirst({ where: eq(account.id, actor.userId) });
  const sessions = await db
    .select({ id: authSession.id })
    .from(authSession)
    .where(eq(authSession.userId, actor.userId));

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-10">
          <h1 className="t-title">Account</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">{me?.email}</p>
        </header>

        <div className="flex flex-col gap-8">
          <section className="pane rounded-xl p-5">
            <DisplayNameForm initial={me?.displayName ?? ''} />
          </section>

          <section className="pane rounded-xl p-5">
            <h2 className="t-heading mb-4">Password</h2>
            <PasswordForm />
          </section>

          <section className="pane rounded-xl p-5">
            <h2 className="t-heading mb-1">Sessions</h2>
            <p className="mb-4 text-[13px] text-[var(--color-dim)]">
              {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} on
              record. Signing out ends this one; changing your password ends all the
              others.
            </p>
            <form action="/api/v1/auth/logout" method="post">
              <button
                type="submit"
                className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-dim)] transition-colors hover:border-[var(--color-ended)]/40 hover:text-[var(--color-ended)]"
              >
                <LogOut className="size-3.5" />
                Sign out
              </button>
            </form>
          </section>

          <p className="text-[11px] leading-relaxed text-[var(--color-mute)]">
            Changing your email address and deleting your account are not built yet.
            Both need a confirmation step to be done safely, so they are deliberately
            absent rather than half-done.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
