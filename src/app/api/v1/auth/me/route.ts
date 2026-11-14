import { eq } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { account } from '@/server/db/schema';
import { authed, notFound, ok } from '@/server/http/api';

export const GET = authed(async ({ actor }) => {
  const row = await unscoped().query.account.findFirst({
    where: eq(account.id, actor.userId),
  });
  if (!row) throw notFound('Account not found.');
  return ok({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    tier: row.tier,
    createdAt: row.createdAt.toISOString(),
  });
});
