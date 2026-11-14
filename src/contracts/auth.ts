import { z } from 'zod';
import { instant } from './common';

/**
 * ============================================================================
 *  AUTH — one scheme, two delivery mechanisms
 * ============================================================================
 *
 * The same endpoints serve web and mobile. What differs is only where the
 * tokens are kept:
 *
 *   web     access token in memory, refresh token in an httpOnly, SameSite=Lax
 *           cookie the JS never touches (so XSS cannot exfiltrate it)
 *   mobile  both returned in the JSON body, stored in Keychain / Keystore
 *
 * A client opts in with `client`. When it is `web` the server sets cookies and
 * omits the refresh token from the body; otherwise it returns both and sets no
 * cookies. Nothing else about the API changes, so there is no second auth
 * stack to maintain and no mobile-only code path to get wrong.
 *
 * Refresh tokens rotate on every use and are tracked as a family. Presenting
 * an already-used refresh token means it leaked, so the entire family is
 * revoked and every device for that session is signed out. That is the correct
 * response to theft, and it is why refresh tokens are stored hashed.
 */

export const clientKind = z.enum(['web', 'ios', 'android', 'cli']);
export type ClientKind = z.infer<typeof clientKind>;

export const credentials = z.object({
  email: z.string().email().max(254),
  /**
   * Minimum 10. Length beats composition rules: a long passphrase is both
   * stronger and likelier to be remembered than a short string with a symbol
   * bolted on.
   */
  password: z.string().min(10).max(200),
});

export const registerRequest = credentials.extend({
  displayName: z.string().min(1).max(60).optional(),
  client: clientKind.default('web'),
  deviceLabel: z.string().max(80).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequest>;

export const loginRequest = credentials.extend({
  client: clientKind.default('web'),
  deviceLabel: z.string().max(80).optional(),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const refreshRequest = z.object({
  /** Omitted by web clients — the cookie carries it. */
  refreshToken: z.string().optional(),
  client: clientKind.default('web'),
});
export type RefreshRequest = z.infer<typeof refreshRequest>;

export const sessionUser = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(['member', 'admin']),
  tier: z.enum(['free', 'plus']),
  createdAt: instant,
});
export type SessionUser = z.infer<typeof sessionUser>;

export const authResult = z.object({
  user: sessionUser,
  accessToken: z.string(),
  /** Seconds until `accessToken` expires. Refresh before, not after. */
  expiresIn: z.number().int(),
  /** Present for non-web clients only; web receives it as an httpOnly cookie. */
  refreshToken: z.string().optional(),
});
export type AuthResult = z.infer<typeof authResult>;
