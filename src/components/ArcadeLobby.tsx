'use client';

/**
 * ArcadeLobby — the main arcade shell.
 *
 * Renders only for a connected wallet (see ConnectGate).
 *
 * Design: OLED true-black canvas, bento-box grid, HUD/sci-fi accents,
 * motion-driven entrance and hover states, responsive from 360px up.
 *
 * This file stays presentational — game rules live in src/games/*, and the realtime
 * transport lives in src/multiplayer/*.
 */


import { motion } from 'motion/react';

import { ARCADE_GAMES } from '@/lib/games';
import { ARCADE_NETWORK } from '@/lib/sphere-config';
import { useWallet } from '@/wallet/WalletProvider';
import { GameCard } from '@/components/GameCard';
import { WalletIndicator } from '@/components/WalletIndicator';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Small stat tile used in the bento side column. */
function StatTile({
  label,
  value,
  hint,
  delay,
}: {
  label: string;
  value: string;
  hint?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5"
    >
      <p className="hud-label text-zinc-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-zinc-600">{hint}</p>}
    </motion.div>
  );
}

export function ArcadeLobby() {
  const { player, isLocked } = useWallet();

  return (
    <div className="relative min-h-dvh bg-void">
      {/* Ambient background: blueprint grid + corner glows */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute inset-0 hud-grid opacity-[0.35]" />
        <div className="absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-hud-cyan/[0.07] blur-[130px]" />
        <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] rounded-full bg-hud-magenta/[0.06] blur-[130px]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* ---------------- Sticky HUD header ---------------- */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <motion.span
              className="text-xl text-hud-cyan text-glow-cyan"
              animate={{ rotate: [0, 90, 180, 270, 360] }}
              transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
              aria-hidden="true"
            >
              ◈
            </motion.span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-zinc-100">
                Unicity <span className="text-hud-cyan">Arcade</span>
              </p>
              <p className="hidden hud-label text-zinc-600 sm:block">
                {ARCADE_NETWORK.name ?? `network ${ARCADE_NETWORK.id}`} · free to play
              </p>
            </div>
          </div>

          <WalletIndicator />
        </div>

        {/* Thin scan bar under the header — pure HUD flavour */}
        <div className="relative h-px overflow-hidden" aria-hidden="true">
          <motion.div
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-hud-cyan/60 to-transparent"
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* ---------------- Welcome ---------------- */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: EASE }}
          className="mb-10"
        >
          <p className="hud-label text-hud-cyan">Player online</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            Welcome back,{' '}
            <span className="text-hud-cyan text-glow-cyan">
              {player?.displayName ?? 'player'}
            </span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
            Pick a cabinet to play. Chess and Tic-Tac-Toe are live — take on the AI, share a
            screen with a friend, or open a room and play someone online. Matches are free and
            nothing is ever wagered without your explicit approval.
          </p>


          {isLocked && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-5 flex items-start gap-3 overflow-hidden rounded-2xl border border-hud-amber/30 bg-hud-amber/[0.07] px-4 py-3"
            >
              <span className="mt-0.5 text-hud-amber" aria-hidden="true">
                ⚿
              </span>
              <p className="text-xs leading-relaxed text-amber-200">
                <span className="font-semibold">Wallet locked.</span> Your arcade session is
                still alive — unlock Sphere and you will be reconnected automatically.
              </p>
            </motion.div>
          )}
        </motion.section>

        {/* ---------------- Bento grid ---------------- */}
        <section aria-labelledby="library-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 id="library-heading" className="text-lg font-semibold tracking-tight text-zinc-100">
                Game library
              </h2>
              <p className="mt-1 hud-label text-zinc-600">{ARCADE_GAMES.length} cabinets</p>
            </div>
            <span className="rounded-full border border-hud-lime/30 bg-hud-lime/[0.08] px-3 py-1.5 hud-label text-hud-lime">
              {ARCADE_GAMES.filter((g) => g.href).length} playable now
            </span>

          </div>

          {/*
            Bento box: 1 column on mobile, 2 on tablet, 4 on desktop.
            Tiles claim uneven footprints via `game.span` (see src/lib/games.ts),
            with auto-rows giving the grid its characteristic bento rhythm.
          */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:auto-rows-[11.5rem] md:grid-cols-4">
            {ARCADE_GAMES.map((game, index) => (
              <GameCard key={game.id} game={game} index={index} />
            ))}

            {/* Identity tile — the wallet IS the account, so we show it in the grid. */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
              className="relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-br from-panel-raised to-panel p-5 md:col-span-2"
            >
              <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />
              <p className="hud-label text-zinc-600">Your player identity</p>
              <p className="mt-2 truncate text-xl font-semibold tracking-tight text-zinc-50">
                {player?.nametag ?? 'Unnamed player'}
              </p>
              <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-zinc-600">
                {player?.chainPubkey}
              </p>
              <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isLocked ? 'bg-hud-amber' : 'bg-hud-lime'
                  }`}
                  aria-hidden="true"
                />
                <span className="hud-label text-zinc-500">
                  {isLocked ? 'Locked · session alive' : 'Wallet connected'}
                </span>
              </div>
            </motion.div>

            {/* Stats */}
            <StatTile
              label="Cabinets live"
              value={`${ARCADE_GAMES.filter((g) => g.href).length}`}
              hint="Chess · Tic-Tac-Toe"
              delay={0.36}
            />
            <StatTile label="Win rate" value="—" hint="Ranked stats coming soon" delay={0.42} />

          </div>
        </section>

        {/* ---------------- Roadmap strip ---------------- */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-12 overflow-hidden rounded-3xl border border-hairline bg-panel/60"
        >
          <div className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { step: '01', title: 'Wallet identity', body: 'Connect with Sphere. Done.', done: true },
              {
                step: '02',
                title: 'Chess & Tic-Tac-Toe',
                body: 'Single player, local and online rooms.',
                done: true,
              },
              {
                step: '03',
                title: 'Match-3 & Runner',
                body: 'Real-time cabinets, plus ranked leaderboards.',
                done: false,
              },

            ].map((item) => (
              <div key={item.step} className="p-5">
                <div className="flex items-center gap-2">
                  <span className="hud-label text-zinc-700">{item.step}</span>
                  {item.done && (
                    <span className="rounded-full border border-hud-lime/30 bg-hud-lime/10 px-2 py-0.5 hud-label text-hud-lime">
                      Live
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold text-zinc-200">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">{item.body}</p>
              </div>
            ))}
          </div>
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 sm:flex-row sm:px-6">
          <p className="hud-label text-zinc-700">Unicity Arcade</p>

          <p className="hud-label text-zinc-700">
            sphere-sdk 0.14.9 · {ARCADE_NETWORK.name ?? ARCADE_NETWORK.id}
          </p>
        </div>
      </footer>
    </div>
  );
}
