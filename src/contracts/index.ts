/**
 * @animemind/contracts — the complete wire format for the AnimeMind API.
 *
 * This barrel is the public surface a client app imports. It has no runtime
 * dependency beyond zod, which is what makes it liftable into a standalone
 * package when the mobile app arrives.
 */
export * from './common';
export * from './catalog';
export * from './sync';
export * from './auth';
