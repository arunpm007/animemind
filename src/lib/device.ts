'use client';

import { ulid } from 'ulid';

const KEY = 'animemind.device';

/**
 * A stable per-browser id.
 *
 * The sync protocol needs to tell devices apart to reason about which one is
 * behind. This is a local convenience identifier, not an identity: it is
 * per-browser-profile, carries nothing about the user, and a reset simply
 * looks like a new device.
 */
export function deviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = ulid();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private browsing, or storage blocked. A per-session id still works for
    // merge ordering; it just cannot persist.
    return 'ephemeral';
  }
}
