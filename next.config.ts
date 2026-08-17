import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Unicity Arcade.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A STATIC EXPORT
 *
 * Every route in this app is already prerendered — `next build` reports all 8 as
 * `○ (Static)`. Nothing runs on a server: the wallet talks to Sphere from the
 * browser, the games are client-side, and Supabase is called directly over HTTPS
 * from the client. So a static export loses no functionality today.
 *
 * It also unblocks deployment: the Vercel CLI's *local* builder currently fails on
 * Windows + Node 24 with `spawn cmd.exe ENOENT`. Exporting to plain files lets us
 * build with Next directly and hand Vercel a prebuilt artifact, skipping the CLI's
 * broken build step entirely.
 *
 * TRADE-OFF, STATED PLAINLY: with `output: 'export'` there is no Node runtime, so
 * API routes, Server Actions, middleware and ISR are unavailable. If multiplayer
 * later needs a server-side secret (e.g. an authoritative match validator), this
 * line must be removed and the project deployed as a normal Vercel build. Today's
 * realtime path is Supabase-direct from the browser, so nothing needs it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  /** Emit a fully static site into `out/`. See the note above. */
  output: 'export',

  /**
   * Emit `path/index.html` rather than `path.html`.
   *
   * Directory-index files are served correctly by any static host without needing
   * clean-URL rewrite rules, which makes the output portable.
   */
  trailingSlash: true,

  /**
   * next/image's optimiser is a server feature and cannot run in an export. The
   * arcade ships no raster art — tiles use text glyphs and Phaser draws its own
   * graphics — so this only silences a build-time error, it costs nothing.
   */
  images: {
    unoptimized: true,
  },

  // Fail the build on type errors instead of shipping a broken arcade.
  typescript: {
    ignoreBuildErrors: false,
  },

  /*
   * NOTE: `async headers()` used to live here and has been REMOVED, not lost.
   *
   * `headers()` is silently unsupported under `output: 'export'` — there is no
   * server to attach them. The security headers, and critically the
   * `Cross-Origin-Opener-Policy: unsafe-none` that keeps `window.opener`
   * messaging alive for the Sphere wallet popup, are now declared in
   * `vercel.json` and mirrored into `.vercel/output/config.json`.
   *
   * If COOP ever goes missing, the wallet popup will open and then fail to talk
   * back to the arcade. That header is load-bearing.
   */
};

export default nextConfig;
