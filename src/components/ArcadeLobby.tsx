'use client';

/**
 * ArcadeLobby — the main arcade shell.
 *
 * Renders only for a connected wallet (see ConnectGate).
 *
 * Design: Bright Aurora light glassmorphism, bento-box grid, HUD accents,
 * motion-driven entrance and hover states, responsive from 360px up.
 *
 * This file stays presentational — game rules live in src/games/*, and the realtime
 * transport lives in src/multiplayer/*.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { EXTRA_GAMES, FEATURED_GAMES } from '@/lib/games';
import { ARCADE_NETWORK } from '@/lib/sphere-config';
import {
  type ActivityEntry,
  announceConnect,
  fetchRecentActivity,
  recordLocalConnect,
  relativeTime,
  truncateKey,
} from '@/lib/activity';
import { useWallet } from '@/wallet/WalletProvider';
import { GameCard } from '@/components/GameCard';
import { WalletIndicator } from '@/components/WalletIndicator';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Recent Activity — the last 10 wallets seen.
 *
 * Labels itself honestly: without Supabase keys this can only be "wallets that
 * connected in this browser", and claiming otherwise would be a lie dressed as a
 * feature. See src/lib/activity.ts.
 */
function RecentActivity({ delay }: { delay: number }) {
  const { player } = useWallet();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [scope, setScope] = useState<'local' | 'global'>('local');

  // Guards against setState after unmount — this component can be replaced by a route
  // change while the presence round-trip is still in flight.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!player) return;

    // Optimistic: show this player immediately from local storage, then reconcile
    // with the shared table if one is configured.
    setEntries(recordLocalConnect(player));

    void (async () => {
      await announceConnect(player);
      const feed = await fetchRecentActivity();
      if (!aliveRef.current) return;
      setScope(feed.kind);
      if (feed.entries.length > 0) setEntries(feed.entries);
    })();
  }, [player]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className="glass mt-8 overflow-hidden rounded-3xl"
      aria-labelledby="activity-heading"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div>
          <h2 id="activity-heading" className="text-sm font-semibold tracking-tight text-ink">
            Recent activity
          </h2>
          <p className="mt-0.5 hud-label text-ink-faint">
            {scope === 'global' ? 'Last 10 wallets in the arcade' : 'Last 10 wallets on this device'}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-hud-cyan/30 bg-hud-cyan/[0.08] px-3 py-1.5 hud-label text-hud-cyan">
          {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-6 text-xs text-ink-faint">No connects recorded yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {entries.map((entry, i) => {
            const isYou = entry.chainPubkey === player?.chainPubkey;
            return (
              <motion.li
                key={entry.chainPubkey}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: delay + i * 0.04, ease: EASE }}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-hud-lime"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                  {entry.displayName}
                  {isYou && (
                    <span className="ml-2 rounded-full border border-hud-cyan/30 bg-hud-cyan/[0.08] px-1.5 py-0.5 hud-label text-hud-cyan">
                      You
                    </span>
                  )}
                </span>
                <span className="hidden shrink-0 font-mono text-[10px] text-ink-faint sm:block">
                  {truncateKey(entry.chainPubkey)}
                </span>
                <span className="shrink-0 hud-label text-ink-faint">
                  {relativeTime(entry.connectedAt)}
                </span>
              </motion.li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

export function ArcadeLobby() {
  const { player, isLocked } = useWallet();
  const [showExtra, setShowExtra] = useState(false);

  return (
    <div className="relative min-h-dvh bg-void">
      {/* Ambient background: blueprint grid + soft aurora washes */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute inset-0 hud-grid opacity-60" />
        <div className="absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-hud-cyan/[0.10] blur-[130px]" />
        <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] rounded-full bg-hud-magenta/[0.09] blur-[130px]" />
      </div>

      {/* ---------------- Sticky HUD header ---------------- */}
      {/*
        bg-panel, not bg-white/70 — the `white` token is remapped to dark ink by the
        theme's compatibility layer (see globals.css), so a literal `bg-white/70`
        would paint this header navy.
      */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-panel backdrop-blur-xl">

        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <motion.span
              className="text-xl text-hud-cyan"
              animate={{ rotate: [0, 90, 180, 270, 360] }}
              transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
              aria-hidden="true"
            >
              ◈
            </motion.span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-ink">
                Unicity <span className="text-hud-cyan">Arcade</span>
              </p>
              <p className="hidden hud-label text-ink-faint sm:block">
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

      {/*
        max-w-6xl + mx-auto + w-full is the desktop centering fix: on an ultrawide
        monitor the grid now sits centred in a readable column instead of stretching
        tiles to absurd widths or clipping at the edges.
      */}
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* ---------------- Welcome ---------------- */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: EASE }}
          className="mb-10"
        >
          <p className="hud-label text-hud-cyan">Player online</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl md:text-5xl">
            Welcome back,{' '}
            <span className="text-hud-cyan">{player?.displayName ?? 'player'}</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            Pick a cabinet to play. Take on the AI, share a screen with a friend, or open a room
            and play someone online. Matches are free and nothing is ever wagered without your
            explicit approval.
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
              <p className="text-xs leading-relaxed text-hud-amber">
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
              <h2
                id="library-heading"
                className="text-lg font-semibold tracking-tight text-ink"
              >
                Game library
              </h2>
              <p className="mt-1 hud-label text-ink-faint">Head-to-head</p>
            </div>
          </div>

          {/*
            Bento box: 1 column on mobile, 2 on tablet, 4 on desktop.
            Tiles claim uneven footprints via `game.span` (see src/lib/games.ts),
            with auto-rows giving the grid its characteristic bento rhythm.
          */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:auto-rows-[11.5rem] md:grid-cols-4">
            {FEATURED_GAMES.map((game, index) => (
              <GameCard key={game.id} game={game} index={index} />
            ))}
          </div>

          {/* ---------------- "Play More Games" toggle ---------------- */}
          <div className="mt-5">
            <motion.button
              type="button"
              onClick={() => setShowExtra((v) => !v)}
              whileTap={{ scale: 0.98 }}
              aria-expanded={showExtra}
              aria-controls="extra-games"
              className="glass group flex w-full items-center justify-between gap-3 rounded-3xl px-5 py-4 text-left transition-colors hover:border-hud-cyan/40"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold tracking-tight text-ink">
                  {showExtra ? 'Hide extra games' : 'Play more games'}
                </span>
                <span className="mt-0.5 block hud-label text-ink-faint">
                  {EXTRA_GAMES.map((g) => g.title).join(' · ')}
                </span>
              </span>
              <motion.span
                className="shrink-0 text-hud-cyan"
                animate={{ rotate: showExtra ? 180 : 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                aria-hidden="true"
              >
                ▾
              </motion.span>
            </motion.button>

            {/*
              AnimatePresence + height:auto gives the reveal a real slide rather than a
              pop. The tiles are unmounted when hidden, so their Phaser-backed routes
              are never even prefetched until the player opts in.
            */}
            <AnimatePresence initial={false}>
              {showExtra && (
                <motion.div
                  id="extra-games"
                  key="extra"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 md:auto-rows-[11.5rem] md:grid-cols-4">
                    {EXTRA_GAMES.map((game, index) => (
                      <GameCard key={game.id} game={game} index={index} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ---------------- Identity tile ---------------- */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
            className="glass relative mt-5 overflow-hidden rounded-3xl p-5"
          >
            <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />
            <p className="hud-label text-ink-faint">Your player identity</p>
            <p className="mt-2 truncate text-xl font-semibold tracking-tight text-ink">
              {player?.nametag ?? 'Unnamed player'}
            </p>
            <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-ink-faint">
              {player?.chainPubkey}
            </p>
            <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLocked ? 'bg-hud-amber' : 'bg-hud-lime'
                }`}
                aria-hidden="true"
              />
              <span className="hud-label text-ink-faint">
                {isLocked ? 'Locked · session alive' : 'Wallet connected'}
              </span>
            </div>
          </motion.div>
        </section>

        {/* ---------------- Recent activity ---------------- */}
        <RecentActivity delay={0.4} />
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 sm:flex-row sm:px-6">
          <p className="hud-label text-ink-faint">Unicity Arcade</p>
          <p className="hud-label text-ink-faint">
            sphere-sdk 0.14.9 · {ARCADE_NETWORK.name ?? ARCADE_NETWORK.id}
          </p>
        </div>
      </footer>
    </div>
  );
}
