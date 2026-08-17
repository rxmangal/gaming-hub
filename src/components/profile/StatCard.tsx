'use client';

/**
 * Small presentational pieces used by the profile page.
 *
 * Kept in one file because they are tiny, share the same visual language, and are only
 * ever used together. Splitting them into four files would add navigation cost with no
 * reuse benefit.
 */

import { motion } from 'motion/react';

const EASE = [0.16, 1, 0.3, 1] as const;

/** One headline number in the bento grid. */
export function StatCard({
  label,
  value,
  accent = '#22d3ee',
  sub,
  delay = 0,
}: {
  label: string;
  value: string;
  accent?: string;
  sub?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
      className="group relative overflow-hidden rounded-2xl border border-hairline bg-panel p-4"
    >
      <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />
      <p className="hud-label text-zinc-600">{label}</p>
      <p
        className="mt-1.5 font-mono text-2xl tabular-nums sm:text-3xl"
        style={{ color: accent }}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{sub}</p>}
    </motion.div>
  );
}

/** A labelled section wrapper so the page reads as distinct blocks. */
export function Panel({
  title,
  hint,
  children,
  delay = 0,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className="relative overflow-hidden rounded-3xl border border-hairline bg-panel/70"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h2>
        {hint && <p className="hud-label text-zinc-700">{hint}</p>}
      </div>
      <div className="p-5">{children}</div>
    </motion.section>
  );
}

/**
 * Win/loss/draw as a single proportional bar.
 *
 * Chosen over three separate numbers because the shape of the bar communicates form at a
 * glance. The numbers are still shown underneath for anyone who wants exact figures.
 */
export function OutcomeBar({
  wins,
  losses,
  draws,
}: {
  wins: number;
  losses: number;
  draws: number;
}) {
  const total = wins + losses + draws;
  if (total === 0) {
    return (
      <p className="text-xs leading-relaxed text-zinc-600">
        No completed matches yet. Play Chess or Tic-Tac-Toe to start building a record.
      </p>
    );
  }

  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-black"
        role="img"
        aria-label={`${wins} wins, ${losses} losses, ${draws} draws`}
      >
        {wins > 0 && (
          <motion.div
            className="bg-hud-lime"
            initial={{ width: 0 }}
            animate={{ width: pct(wins) }}
            transition={{ duration: 0.7, ease: EASE }}
          />
        )}
        {draws > 0 && (
          <motion.div
            className="bg-zinc-600"
            initial={{ width: 0 }}
            animate={{ width: pct(draws) }}
            transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
          />
        )}
        {losses > 0 && (
          <motion.div
            className="bg-red-500/80"
            initial={{ width: 0 }}
            animate={{ width: pct(losses) }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {[
          { label: 'Wins', value: wins, dot: 'bg-hud-lime' },
          { label: 'Draws', value: draws, dot: 'bg-zinc-600' },
          { label: 'Losses', value: losses, dot: 'bg-red-500/80' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${item.dot}`} aria-hidden="true" />
            <span className="hud-label text-zinc-600">{item.label}</span>
            <span className="font-mono text-xs tabular-nums text-zinc-300">{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Recent form: newest on the left, one pip per match. */
export function FormStrip({ outcomes }: { outcomes: Array<'win' | 'loss' | 'draw'> }) {
  if (outcomes.length === 0) {
    return <p className="text-xs text-zinc-600">Nothing played yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {outcomes.map((outcome, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, delay: i * 0.025 }}
          title={outcome}
          className={`grid h-6 w-6 place-items-center rounded-md border font-mono text-[10px] uppercase ${
            outcome === 'win'
              ? 'border-hud-lime/40 bg-hud-lime/15 text-hud-lime'
              : outcome === 'loss'
                ? 'border-red-500/40 bg-red-500/10 text-red-400'
                : 'border-hairline bg-black text-zinc-500'
          }`}
        >
          {outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : 'D'}
        </motion.span>
      ))}
    </div>
  );
}
