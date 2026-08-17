'use client';

/**
 * GameCard — a single bento tile in the game library.
 *
 * Motion-driven: the tile lifts, its glyph parallaxes, a glow follows the cursor,
 * and the HUD corner brackets light up on hover.
 *
 * Playable tiles (`game.href`) render as a Next.js <Link>; unbuilt ones stay inert
 * and are marked aria-disabled so assistive tech doesn't advertise a dead control.
 *
 * SIZING: every tile is identical. The card fills its grid cell (`h-full`) and the
 * grid supplies one fixed row height for the whole row, so all four cabinets match
 * exactly. `min-h-*` sets the floor for the mobile single-column case, where rows
 * are content-sized rather than fixed. The old per-game `span` classes are gone —
 * see the layout note in src/lib/games.ts.
 */

import Link from 'next/link';
import { motion, useMotionTemplate, useMotionValue } from 'motion/react';

import type { ArcadeGame } from '@/lib/games';

export function GameCard({ game, index }: { game: ArcadeGame; index: number }) {
  // Cursor position drives a radial spotlight on the tile surface.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  // 22 (~13% alpha) reads on white; the old 18 was tuned for a black surface and
  // vanished entirely once the theme went light.
  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, ${game.glow}22, transparent 70%)`;

  const isLive = game.href !== null;

  const inner = (
    <>
      {/* Cursor spotlight */}
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: spotlight }}
        aria-hidden="true"
      />

      {/* Static corner accent wash */}
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${game.accent} opacity-60`}
        aria-hidden="true"
      />

      {/* HUD corner brackets (see globals.css) */}
      <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* Top row: status + mode */}
      <header className="relative z-10 flex items-start justify-between gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 hud-label backdrop-blur ${
            isLive
              ? 'border-hud-lime/30 bg-hud-lime/10 text-hud-lime'
              : 'border-hairline bg-panel text-ink-faint'
          }`}
        >
          {isLive ? (
            <motion.span
              className="h-1 w-1 rounded-full bg-hud-lime"
              animate={{ opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              aria-hidden="true"
            />
          ) : (
            <span className="h-1 w-1 rounded-full bg-ink-faint" aria-hidden="true" />
          )}
          {isLive ? 'Live' : game.status === 'alpha' ? 'Alpha' : 'Soon'}
        </span>
        <span className="hud-label text-right text-ink-faint">{game.mode}</span>
      </header>

      {/* Glyph */}
      <motion.div
        className="relative z-10 my-4 select-none text-5xl leading-none sm:text-6xl"
        style={{ color: game.glow }}
        whileHover={{ scale: 1.08, rotate: -4 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        aria-hidden="true"
      >
        {game.glyph}
      </motion.div>

      {/* Body */}
      <div className="relative z-10">
        <h3 className="text-lg font-semibold tracking-tight text-ink">{game.title}</h3>
        <p className="mt-1.5 max-w-[34ch] text-xs leading-relaxed text-ink-soft">
          {game.tagline}
        </p>

        <footer className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
          <span className="hud-label text-ink-faint">{game.players}</span>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 hud-label text-ink-soft transition-colors group-hover:text-hud-cyan">
              Play
              <motion.span
                aria-hidden="true"
                className="inline-block"
                initial={{ x: 0 }}
                animate={{ x: 0 }}
                whileHover={{ x: 3 }}
              >
                →
              </motion.span>
            </span>
          ) : (
            <span className="hud-label text-ink-faint transition-colors group-hover:text-ink-soft">
              Locked
            </span>
          )}
        </footer>
      </div>
    </>
  );

  const shared = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.5,
      delay: 0.06 * index,
      ease: [0.16, 1, 0.3, 1] as const,
    },
    whileHover: { y: -4 },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      mx.set(event.clientX - rect.left);
      my.set(event.clientY - rect.top);
    },
  };

  // `glass` supplies the frosted background, border and shadow (see globals.css).
  // `h-full` makes every tile fill its grid cell, which is what guarantees the four
  // cards are the same height rather than each sizing to its own text.
  const base =
    'glass group relative flex h-full min-h-[13rem] flex-col justify-between overflow-hidden rounded-3xl p-5 transition-colors duration-300';

  if (isLive) {
    return (
      <motion.div {...shared} className={`${base} hover:border-hud-cyan/40`}>
        {/* The Link covers the whole tile so the entire surface is clickable. */}
        <Link
          href={game.href as string}
          className="absolute inset-0 z-20 rounded-3xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-cyan"
          aria-label={`Play ${game.title}`}
        />
        {inner}
      </motion.div>
    );
  }

  return (
    <motion.article {...shared} aria-disabled="true" className={`${base} hover:border-ink/20`}>
      {inner}
    </motion.article>
  );
}
