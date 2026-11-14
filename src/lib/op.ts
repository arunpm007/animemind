import { ulid } from 'ulid';
import type { SyncOpBody } from '@/contracts';
import { deviceId } from './device';

/**
 * Wrap an op body in the envelope the sync protocol requires.
 *
 * Every write in the UI needs `id`, `clientTs` and `deviceId`, and three
 * components were each building that inline. Centralising it also keeps the
 * impure calls (a fresh ULID, the clock) in one place the React Compiler can
 * see is never render-phase.
 *
 * The id is what makes a retry safe: the same op sent twice is applied once.
 */
export function makeOp(body: SyncOpBody) {
  return {
    id: ulid(),
    clientTs: Date.now(),
    deviceId: deviceId(),
    ...body,
  };
}
