'use client';

/**
 * LeaderboardScreen — the /leaderboard page shell.
 *
 * One tab per cabinet, each showing that game's own Top 30. Tabs are driven straight
 * from ARCADE_GAMES so adding a game to the library adds its board automatically —
 * there is no second list to keep in sync.
 *
 * Styling matches the lobby: Bright Aurora glass, HUD accents, motion-driven.
 */

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';

import { ARCADE_GAMES } from '@/lib/games';
import { ARCADE_NETWORK } from '@/lib/sphere-config';
import type { LeaderboardGameId } from '@/lib/leaderboard';
import { useWallet } from '@/wallet/WalletProvider';
import { GameLeaderboard } from '@/components/leaderboard/GameLeaderboard';
import { WalletIndicator } from '@/components/WalletIndicator';

const EASE = [0.16, 1, 0.3, 1] as const;

export function LeaderboardScreen() {
  const { player } = useWallet();
  const [active, setActive] = useState<LeaderboardGameId>(
    ARCADE_GAMES[0].id as LeaderboardGameId,
  );

  const activeGame = ARCADE_GAMES.find((g) => g.id === active) ?? ARCADE_GAMES[0];

  return (
    <div className="relative min-h-dvh bg-void">
      {/* Ambient background, matching the lobby */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute inset-0 hud-grid opacity-60" />
        <div className="absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-hud-cyan/[0.10] blur-[130px]" />
        <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] rounded-full bg-hud-magenta/[0.09] blur-[130px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-panel backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="shrink-0 rounded-lg border border-hairline px-2.5 py-1.5 hud-label text-ink-soft transition-colors hover:border-hud-cyan/40 hover:text-hud-cyan"
              aria-label="Back to the arcade lobby"
            >
              ← Lobby
            </Link>
            <p className="truncate text-sm font-semibold tracking-tight text-ink">
              Leader<span className="text-hud-cyan">boards</span>
            </p>
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

      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pt-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <p className="hud-label text-hud-cyan">Hall of fame</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Top 30, per game
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            Chess and Tic-Tac-Toe rank by wins; Neon Nexus and Block Dash rank by high
            score. Pass-and-play results are left out — two people sharing one wallet
            cannot be told apart, so counting those would make the ladder meaningless.
          </p>
        </motion.div>

        {/* Game tabs */}
        <div
          className="mt-8 mb-6 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Choose a game"
        >
          {ARCADE_GAMES.map((game) => {
            const selected = game.id === active;
            return (
              <button
                key={game.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(game.id as LeaderboardGameId)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-hud-cyan/50 bg-hud-cyan/10 text-hud-cyan'
                    : 'border-hairline bg-panel text-ink-soft hover:border-hud-cyan/30 hover:text-ink'
                }`}
              >
                <span aria-hidden="true" style={{ color: selected ? undefined : game.glow }}>
                  {game.glyph}
                </span>
                {game.title}
              </button>
            );
          })}
        </div>

        {/* Active board */}
        <motion.section
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="glass relative overflow-hidden rounded-3xl p-5"
          aria-label={`${activeGame.title} leaderboard`}
        >
          <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />

          <div className="mb-5 flex items-center gap-3">
            <span className="text-3xl" style={{ color: activeGame.glow }} aria-hidden="true">
              {activeGame.glyph}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                {activeGame.title}
              </h2>
              <p className="mt-0.5 hud-label text-ink-faint">{activeGame.mode}</p>
            </div>
          </div>

          <GameLeaderboard
            gameId={active}
            accent={activeGame.glow}
            mePubkey={player?.chainPubkey ?? null}
          />
        </motion.section>

        <p className="mt-6 text-center hud-label text-ink-faint">
          Boards update live as scores are posted
        </p>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 sm:flex-row sm:px-6">
          <Link href="/" className="hud-label text-ink-faint transition-colors hover:text-hud-cyan">
            ← Back to the arcade
          </Link>
          <p className="hud-label text-ink-faint">
            {ARCADE_NETWORK.name ?? ARCADE_NETWORK.id}
          </p>
        </div>
      </footer>
    </div>
  );
}
