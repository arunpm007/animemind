import { getUpNext } from '@/server/services/library';
import { authed, ok } from '@/server/http/api';

export const GET = authed(async ({ actor }) => ok(await getUpNext(actor)));
