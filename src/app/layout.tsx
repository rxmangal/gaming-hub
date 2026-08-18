import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';

import './globals.css';
import { WalletProvider } from '@/wallet/WalletProvider';

/**
 * FONTS
 *
 * AUDIT FIX: `globals.css` declared `--font-display: 'Space Grotesk'` and used
 * `font-mono` in roughly thirty places, but neither font was ever loaded. Every HUD
 * readout silently fell back to whatever the OS happened to supply — Courier New on
 * Windows — which is exactly the wrong texture for a sci-fi arcade, and looked different
 * on every machine.
 *
 * `next/font` self-hosts both families from our own origin at build time. That means:
 *   - no network request to fonts.gstatic.com (faster, and no third-party tracking)
 *   - `display: 'swap'` plus an automatic size-adjusted fallback, so text is readable
 *     immediately and does not shift when the real font lands (protects CLS)
 *   - only the Latin subset ships, keeping the payload small
 *
 * Each font exposes a CSS variable that `globals.css` consumes, so the utilities
 * `font-display` / `font-mono` / the default sans all resolve to real fonts.
 */
const display = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display-family',
  weight: ['400', '500', '600', '700'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-family',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Unicity Arcade — Free-to-play multiplayer',
  description:
    'A free-to-play browser multiplayer arcade on Unicity. Your Sphere wallet is your player identity.',
  applicationName: 'Unicity Arcade',
  // Helps the arcade look correct when a room link is pasted into a chat app.
  openGraph: {
    title: 'Unicity Arcade',
    description:
      'Chess, Tic-Tac-Toe, Neon Nexus and Block Dash. Free to play. Your Sphere wallet is your identity.',
    type: 'website',
  },
  // Installable-app polish: iOS uses this when the arcade is added to the home screen.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Arcade' },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  // Games sit inside fixed-aspect canvases, so a pinch-zoom only ever crops the play
  // area. Zoom stays enabled (never disable it — it is an accessibility need) but the
  // page is capped so an accidental double-tap during a run cannot wreck the layout.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${display.variable} ${mono.variable}`}>
      <body className="bg-void text-zinc-200 antialiased">
        {/* The wallet provider wraps everything: identity is app-wide state. */}
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
