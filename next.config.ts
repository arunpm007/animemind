import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy. Everything the app loads comes from its own origin:
 * cover art is proxied through /_next/image and the API is same-origin, so no
 * third-party host needs to be allowed. 'unsafe-inline' for scripts is what
 * Next.js needs without per-request nonces; 'unsafe-eval' only in development
 * (React Fast Refresh). frame-ancestors 'none' stops clickjacking.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  // Don't advertise the framework and version to scanners.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    // Cover art is served from MyAnimeList's CDN. Narrow remote patterns
    // rather than a wildcard: this list is an allowlist of who may be
    // proxied through our own image optimiser.
    remotePatterns: [
      // Kitsu — the primary provider.
      { protocol: 'https', hostname: 'media.kitsu.app' },
      { protocol: 'https', hostname: 'media.kitsu.io' },
      // MyAnimeList, via Jikan or the official API.
      { protocol: 'https', hostname: 'cdn.myanimelist.net' },
      { protocol: 'https', hostname: 'api-cdn.myanimelist.net' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  // argon2 is a native addon and must not be bundled into the server chunks.
  serverExternalPackages: ['@node-rs/argon2'],
  // Keep generated agent scaffolding out of the repository.
  agentRules: false,
};

export default nextConfig;
