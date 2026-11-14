import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
