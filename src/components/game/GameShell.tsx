'use client';

/**
 * GameShell — the common frame every game screen sits inside.
 *
 * Keeps the arcade's OLED/HUD aesthetic consistent and hosts the back link and
 * wallet indicator so individual games never re-implement chrome.
 */

import Link from 'next/link';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { WalletIndicator } from '@/components/WalletIndicator';

export function GameShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-void">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute inset-0 hud-grid opacity-[0.3]" />
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-hud-cyan/[0.06] blur-[130px]" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-hud-magenta/[0.05] blur-[130px]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-hairline bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Back to arcade"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-hairline bg-panel text-zinc-400 transition-colors hover:border-hud-cyan/40 hover:text-hud-cyan"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-100">
                {title}
              </h1>
              {subtitle && <p className="truncate hud-label text-zinc-600">{subtitle}</p>}
            </div>
          </div>

          <WalletIndicator />
        </div>

        <div className="relative h-px overflow-hidden" aria-hidden="true">
          <motion.div
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-hud-cyan/60 to-transparent"
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">{children}</main>
    </div>
  );
}
