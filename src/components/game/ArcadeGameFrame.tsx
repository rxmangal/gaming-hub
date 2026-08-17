'use client';

/**
 * Shared chrome for the two solo arcade games.
 *
 * Match-3 and Runner have completely different rules but identical *surroundings*: a live
 * score readout, a transient status line, a results overlay, a replay button, and a
 * personal-best row. Factoring that out means each game file contains only its own
 * concerns, and the two screens cannot drift apart visually.
 *
 * WHY THE CANVAS IS KEYED
 * Replay works by incrementing `runId`, which is fed into the PhaserCanvas `key`. React
 * then unmounts the old canvas and mounts a fresh one, so Phaser tears the whole game
 * down and rebuilds it. Trying to "reset" a live scene instead is where subtle state bugs
 * breed — leftover tweens, stale timers, half-finished cascades. A hard remount is the
 * only reset that is guaranteed complete.
 */

import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { type SoloGameId, type SubmitOutcome, readPersonalBest, submitSoloRun } from '@/lib/scores';
import { recordSoloPlay } from '@/lib/profile';
import { useWallet } from '@/wallet/WalletProvider';


export interface ResultRow {
  label: string;
  value: string;
}

interface ArcadeGameFrameProps<TResult> {
  gameId: SoloGameId;
  /** Renders the canvas. `runId` must be used as the React key by the caller's design. */
  renderCanvas: (args: {
    runId: number;
    onScore: (score: number) => void;
    onStatus: (text: string) => void;
    onGameOver: (result: TResult) => void;
  }) => ReactNode;
  /** Pulls the headline number out of a result. */
  scoreOf: (result: TResult) => number;
  /** Extra per-game stats for the results panel. */
  rowsOf: (result: TResult) => ResultRow[];
  /** Numeric detail persisted with the score row. */
  detailOf: (result: TResult) => Record<string, number>;
  /** Short control reminder shown under the canvas. */
  controls: string;
}

export function ArcadeGameFrame<TResult>({
  gameId,
  renderCanvas,
  scoreOf,
  rowsOf,
  detailOf,
  controls,
}: ArcadeGameFrameProps<TResult>) {
  const { player } = useWallet();

  const [runId, setRunId] = useState(0);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [best, setBest] = useState<number | null>(null);

  // Guards against a double submit. React 19 Strict Mode and a fast double-tap on the
  // canvas can both deliver game-over twice; the ref makes the write idempotent per run.
  const submitted = useRef(false);

  /**
   * AUDIT FIX: set on unmount so the async score submission cannot call setState on a
   * component that is gone. Leaving a game the instant it ends (tapping "back" as the
   * results panel appears) previously raced the awaited write and updated dead state.
   */
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Personal best is read on the client only — localStorage does not exist during SSR.
  useEffect(() => {
    if (!player) return;
    const stored = readPersonalBest(gameId, player.chainPubkey);
    setBest(stored?.score ?? null);
  }, [gameId, player]);


  // Status messages ("Chain reaction x3!") auto-expire so they never linger as clutter.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 1800);
    return () => window.clearTimeout(timer);
  }, [status]);

  const handleGameOver = useCallback(
    (r: TResult) => {
      if (submitted.current) return;
      submitted.current = true;

      setResult(r);
      if (!player) return;

      // Count the run on the player's profile. Synchronous and local, so the profile page
      // is correct even if the network write below never lands.
      recordSoloPlay(player.chainPubkey, gameId);

      void submitSoloRun(
        { gameId, score: scoreOf(r), detail: detailOf(r) },
        player,
      ).then((res) => {
        // The player may have navigated away while this was in flight.
        if (unmountedRef.current) return;
        setOutcome(res);
        if (res.isRecord) setBest(scoreOf(r));
      });
    },
    [detailOf, gameId, player, scoreOf],
  );


  const replay = useCallback(() => {
    submitted.current = false;
    setResult(null);
    setOutcome(null);
    setScore(0);
    setStatus(null);
    setRunId((n) => n + 1);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Score strip */}
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="hud-label text-zinc-600">Score</p>
          <p className="font-mono text-2xl tabular-nums text-zinc-100">
            {score.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="hud-label text-zinc-600">Personal best</p>
          <p className="font-mono text-sm tabular-nums text-hud-cyan">
            {best === null ? '—' : best.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="relative">
        {renderCanvas({
          runId,
          onScore: setScore,
          onStatus: setStatus,
          onGameOver: handleGameOver,
        })}

        {/* Transient status toast */}
        <AnimatePresence>
          {status && !result && (
            <motion.div
              key={status}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center"
            >
              <span className="rounded-full border border-hud-cyan/30 bg-black/85 px-4 py-1.5 font-mono text-xs tracking-wide text-hud-cyan">
                {status}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results overlay */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 grid place-items-center rounded-2xl bg-black/85 p-6 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.94, y: 12 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="w-full max-w-xs rounded-2xl border border-hairline bg-panel p-5"
              >
                <p className="hud-label text-zinc-600">Run complete</p>
                <p className="mt-1 font-mono text-4xl tabular-nums text-zinc-50">
                  {scoreOf(result).toLocaleString()}
                </p>

                {outcome?.isRecord && (
                  <p className="mt-2 font-mono text-xs tracking-wide text-hud-lime">
                    NEW PERSONAL BEST
                  </p>
                )}

                <dl className="mt-4 space-y-2 border-t border-hairline pt-4">
                  {rowsOf(result).map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <dt className="hud-label text-zinc-600">{row.label}</dt>
                      <dd className="font-mono text-sm tabular-nums text-zinc-300">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {/* Leaderboard state is surfaced honestly rather than hidden — the player
                    should know whether their run left the device. */}
                {outcome && outcome.remote !== 'sent' && (
                  <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                    {outcome.remote === 'skipped'
                      ? 'Saved locally. Add Supabase keys to publish to the global leaderboard.'
                      : 'Saved locally. Could not reach the leaderboard.'}
                  </p>
                )}

                <button
                  type="button"
                  onClick={replay}
                  className="mt-5 w-full rounded-xl border border-hud-cyan/40 bg-hud-cyan/10 px-4 py-2.5 font-mono text-sm tracking-wide text-hud-cyan transition-colors hover:bg-hud-cyan/20"
                >
                  PLAY AGAIN
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="mt-3 text-center font-mono text-[11px] leading-relaxed text-zinc-600">
        {controls}
      </p>
    </div>
  );
}
