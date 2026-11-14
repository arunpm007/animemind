import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/**
 * Access tokens are short-lived JWTs; refresh tokens are long-lived opaque
 * random strings stored only as a hash.
 *
 * Why not a JWT refresh token: a JWT cannot be revoked without a server-side
 * list, at which point it is a database lookup with extra steps. An opaque
 * token is a lookup by definition, and stolen-token detection needs that
 * lookup anyway.
 */

const secretText = process.env.AUTH_SECRET;
if (!secretText || secretText.length < 32) {
  throw new Error(
    'AUTH_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 48',
  );
}
const secret = new TextEncoder().encode(secretText);

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 60 * 24 * 60 * 60;

const ISSUER = 'animemind';
const AUDIENCE = 'animemind-api';

export interface AccessClaims {
  sub: string;
  role: 'member' | 'admin';
  tier: 'free' | 'plus';
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, tier: claims.tier })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // pinned: never let the token choose `none`
    });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      role: (payload.role as AccessClaims['role']) ?? 'member',
      tier: (payload.tier as AccessClaims['tier']) ?? 'free',
    };
  } catch {
    return null;
  }
}

/** 256 bits of entropy, URL-safe so it survives headers, cookies and Keychain. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Refresh tokens are stored hashed. A database dump then does not hand the
 * attacker live sessions. Plain SHA-256 is correct here and argon2 is not:
 * the input is already 256 bits of entropy, so there is nothing to brute
 * force, and the lookup happens on every refresh.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
