'use client';

/**
 * GameLeaderboard — a Top 30 board for one game.
 *
 * Shows rank, the wallet's nametag AND its address, the mode/difficulty the player
 * mainly plays, and the ranking figure (wins for Chess/Tic-Tac-Toe, high score for
 * Neon Nexus/Block Dash). Versus boards additionally show the full W-L-D record,
 * because "12 wins" means something very different at 12-1 than at 12-40.
 *
 * Live: subscribes to inserts on the underlying table and refetches, so a score posted
 * by another player appears without a manual reload. See subscribeToLeaderboard for why
 * that is best-effort rather than guaranteed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import {
  BOARD_KIND,
  LEADERBOARD_LIMIT,
  type LeaderboardGameId,
  type LeaderboardState,
  fetchGameLeaderboard,
  shortAddress,
  subscribeToLeaderboard,
} from '@/lib/leaderboard';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Medal colours for the top three, then a muted tone for everyone else. */
function rankColor(rank: number): string {
  if (rank === 1) return 'text-hud-amber';
  if (rank === 2) return 'text-ink';
  if (rank === 3) return 'text-hud-cyan';
  return 'text-ink-faint';
}

export function GameLeaderboard({
  gameId,
  accent,
  mePubkey,
}: {
  gameId: LeaderboardGameId;
  /** Hex accent from the game's tile, used for the value column. */
  accent: string;
  /** The viewer's wallet, so their own row can be highlighted. */
  mePubkey: string | null;
}) {
  const [state, setState] = useState<LeaderboardState>({ kind: 'loading' });

  const isVersus = BOARD_KIND[gameId] === 'versus';
  const unit = isVersus ? 'wins' : 'pts';

  /**
   * Guards against a stale response overwriting a newer one. Switching games fires
   * overlapping requests which can resolve out of order; only the newest may write.
   */
  const requestIdRef = useRef(0);
  const unmountedRef = useRef(false);

  const load = useCallback(
    async (showSpinner: boolean) => {
      const id = ++requestIdRef.current;
      if (showSpinner) setState({ kind: 'loading' });

      const result = await fetchGameLeaderboard(gameId);

      if (unmountedRef.current || id !== requestIdRef.current) return;
      setState(result);
    },
    [gameId],
  );

  useEffect(() => {
    unmountedRef.current = false;
    void load(true);

    // Realtime refresh. Deliberately silent (no spinner) so a rival's incoming score
    // does not flash the board the viewer is reading.
    const unsubscribe = subscribeToLeaderboard(gameId, () => {
      void load(false);
    });

    return () => {
      unmountedRef.current = true;
      unsubscribe();
    };
  }, [gameId, load]);

  return (
    <div>
      {/* Board meta */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <p className="hud-label text-ink-faint">
          Top {LEADERBOARD_LIMIT} · {isVersus ? 'ranked by wins' : 'ranked by high score'}
        </p>
        {state.kind === 'ready' && (
          <p className="hud-label text-ink-faint">
            {state.entries.length} {state.entries.length === 1 ? 'player' : 'players'}
          </p>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${gameId}:${state.kind}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {state.kind === 'loading' && (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-xl border border-hairline bg-panel"
                />
              ))}
            </div>
          )}

          {/*
            Player-facing empty state — no developer instructions.
            This used to name Supabase and point at "step 5 of the README", which is a
            note to whoever deploys the arcade, not to someone who came here to see who
            is winning. A player cannot act on it, so all they are told now is that
            rankings are not being shared and their own records are safe.
          */}
          {state.kind === 'unavailable' && (
            <div className="glass rounded-2xl px-4 py-6 text-center">
              <p className="hud-label text-ink-soft">Rankings unavailable</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-soft">
                Global rankings aren&apos;t being shared right now. Your personal bests and
                match history are saved on this device.
              </p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.05] px-4 py-6 text-center">
              <p className="hud-label text-red-500">Could not load the board</p>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">{state.message}</p>
              <button
                type="button"
                onClick={() => void load(true)}
                className="mt-4 rounded-lg border border-hairline px-3 py-1.5 font-mono text-[11px] text-ink-soft transition-colors hover:border-hud-cyan/40 hover:text-hud-cyan"
              >
                RETRY
              </button>
            </div>
          )}

          {state.kind === 'ready' && state.entries.length === 0 && (
            <div className="glass rounded-2xl px-4 py-8 text-center">
              <p className="text-sm text-ink-soft">No scores posted yet.</p>
              <p className="mt-1.5 hud-label text-ink-faint">
                Play a round and you will be rank 1.
              </p>
            </div>
          )}

          {state.kind === 'ready' && state.entries.length > 0 && (
            <ol className="space-y-1.5">
              {state.entries.map((entry, index) => {
                const isMe = mePubkey !== null && entry.chainPubkey === mePubkey;
                return (
                  <motion.li
                    key={entry.chainPubkey}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.28,
                      // Cap the stagger: 30 rows at 40ms each would take 1.2s to finish.
                      delay: Math.min(index, 12) * 0.03,
                      ease: EASE,
                    }}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                      isMe ? 'border-hud-cyan/40 bg-hud-cyan/[0.07]' : 'border-hairline bg-panel'
                    }`}
                  >
                    {/* Rank */}
                    <span
                      className={`w-7 shrink-0 text-center font-mono text-xs tabular-nums ${rankColor(
                        entry.rank,
                      )}`}
                    >
                      {entry.rank}
                    </span>

                    {/* Identity: nametag on top, wallet address underneath */}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm text-ink">{entry.displayName}</span>
                        {isMe && (
                          <span className="shrink-0 rounded-full border border-hud-cyan/30 bg-hud-cyan/[0.08] px-1.5 py-0.5 hud-label text-hud-cyan">
                            You
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="truncate font-mono text-[10px] text-ink-faint">
                          {shortAddress(entry.chainPubkey)}
                        </span>
                        <span className="shrink-0 rounded-full border border-hairline px-1.5 py-0.5 hud-label text-ink-faint">
                          {entry.modeLabel}
                        </span>
                      </span>
                    </span>

                    {/* Value + record */}
                    <span className="shrink-0 text-right">
                      <span
                        className="block font-mono text-sm tabular-nums"
                        style={{ color: accent }}
                      >
                        {entry.value.toLocaleString()}
                        <span className="ml-1 hud-label text-ink-faint">{unit}</span>
                      </span>
                      {entry.record && (
                        <span className="mt-0.5 block hud-label text-ink-faint">
                          {entry.record.wins}W · {entry.record.losses}L ·{' '}
                          {entry.record.draws}D
                        </span>
                      )}
                    </span>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
