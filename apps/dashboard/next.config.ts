import type { NextConfig } from 'next';

/** Static hardening headers for every response; CSP (per-request nonce) lives in src/proxy.ts. */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Minimal runtime image for self-hosting (see the root Dockerfile).
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // No cacheComponents / partial prerendering: the CSP nonce must be applied
  // to every script at request time, and a prerendered static shell cannot
  // carry it (see the Next.js CSP guide). Pages render dynamically.
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
