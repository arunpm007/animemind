import { getSeries } from '@/server/services/library';
import { getActor, ok, route } from '@/server/http/api';

export const GET = route<{ params: Promise<{ slug: string }> }>(
  async ({ req, ctx }) => {
    const { slug } = await ctx.params;
    const actor = await getActor(req);
    return ok(await getSeries(actor, slug));
  },
);
