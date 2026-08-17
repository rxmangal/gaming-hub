'use client';

/**
 * ModeSelect — shared mode/difficulty chooser for every game.
 *
 * Bento-style option cards matching the lobby aesthetic.
 */

import { motion } from 'motion/react';

import { isOnlineConfigured } from '@/lib/supabase';

export type PlayMode = 'local' | 'online' | 'ai';
export type AiDifficulty = 'normal' | 'hard' | 'advanced';

const EASE = [0.16, 1, 0.3, 1] as const;

const MODES: Array<{
  id: PlayMode;
  title: string;
  body: string;
  glyph: string;
  glow: string;
}> = [
  {
    id: 'ai',
    title: 'Single player',
    body: 'Play the machine. Three difficulty tiers.',
    glyph: '⚙',
    glow: '#22d3ee',
  },
  {
    id: 'local',
    title: 'Local multiplayer',
    body: 'Two players, one device. Pass and play.',
    glyph: '⇄',
    glow: '#a3e635',
  },
  {
    id: 'online',
    title: 'Online multiplayer',
    body: 'Share a room code and play in real time.',
    glyph: '⧉',
    glow: '#e879f9',
  },
];

const DIFFICULTIES: Array<{ id: AiDifficulty; title: string; body: string }> = [
  { id: 'normal', title: 'Normal', body: 'Makes mistakes. Good for learning.' },
  { id: 'hard', title: 'Hard', body: 'Tactical. Never misses a win or block.' },
  { id: 'advanced', title: 'Advanced', body: 'Ruthless. Play for a draw.' },
];

export function ModeSelect({
  gameTitle,
  tagline,
  onStart,
}: {
  gameTitle: string;
  tagline: string;
  onStart: (mode: PlayMode, difficulty: AiDifficulty) => void;
}) {
  const onlineReady = isOnlineConfigured();

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mb-8 text-center"
      >
        <p className="hud-label text-hud-cyan">Select mode</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {gameTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-500">{tagline}</p>
      </motion.div>

      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map((mode, i) => {
          const disabled = mode.id === 'online' && !onlineReady;
          return (
            <motion.button
              key={mode.id}
              type="button"
              disabled={disabled}
              onClick={() => onStart(mode.id, 'normal')}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06 * i, ease: EASE }}
              whileHover={disabled ? undefined : { y: -4 }}
              whileTap={disabled ? undefined : { scale: 0.98 }}
              className="group relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5 text-left transition-colors hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div
                className="hud-corners pointer-events-none absolute inset-0"
                aria-hidden="true"
              />
              <div
                className="mb-3 text-3xl"
                style={{ color: mode.glow }}
                aria-hidden="true"
              >
                {mode.glyph}
              </div>
              <p className="text-sm font-semibold text-zinc-100">{mode.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{mode.body}</p>
              {disabled && (
                <p className="mt-3 hud-label text-hud-amber">Needs Supabase keys</p>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* AI difficulty — a second row of quick-start buttons. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.25 }}
        className="mt-8"
      >
        <p className="mb-3 hud-label text-zinc-600">Single-player difficulty</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {DIFFICULTIES.map((d) => (
            <motion.button
              key={d.id}
              type="button"
              onClick={() => onStart('ai', d.id)}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              className="group relative overflow-hidden rounded-2xl border border-hairline bg-panel/60 p-4 text-left transition-colors hover:border-hud-cyan/40"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-100">{d.title}</p>
                <span className="hud-label text-zinc-700 transition-colors group-hover:text-hud-cyan">
                  Play
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{d.body}</p>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {!onlineReady && (
        <p className="mt-8 rounded-2xl border border-hairline bg-panel/50 px-4 py-3 text-center text-[11px] leading-relaxed text-zinc-600">
          Online multiplayer needs two environment variables. Local and single-player modes
          work right now with no setup — see the README.
        </p>
      )}
    </div>
  );
}
