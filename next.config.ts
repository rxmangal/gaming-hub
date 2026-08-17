import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Unicity Arcade.
 *
 * Notes for Vercel:
 * - No `output: 'export'` — we keep the standard Vercel build target so we can add
 *   API routes / realtime endpoints later for multiplayer without re-architecting.
 * - The Sphere Connect client we use (`@unicitylabs/sphere-sdk/connect/browser`) is a
 *   dependency-free browser bundle, so no Node polyfill (crypto/buffer) config is needed.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the Vercel build on type errors instead of shipping a broken arcade.
  typescript: {
    ignoreBuildErrors: false,
  },

  // The wallet runs in a popup that talks back to us via window.postMessage.
  // These headers must NOT be COOP-isolated, or `window.opener` messaging breaks.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Explicitly allow popups to keep a handle on us (Sphere popup transport).
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
    ];
  },
};

export default nextConfig;
