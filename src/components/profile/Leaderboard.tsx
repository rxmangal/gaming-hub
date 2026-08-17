'use client';

/**
 * Global leaderboard with three switchable boards: wins, Match-3 and Runner.
 *
 * WHY IT DEGRADES INSTEAD OF ERRORING
 * The leaderboard is the only part of the arcade that genuinely cannot work without a
 * backend. Rather than showing a broken panel or a scary error, an unconfigured install
 * gets a short explanation pointing at the README. Everything else on the profile page
 * keeps working, because it reads from the device.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import {
  type LeaderboardState,
  fetchSoloLeaderboard,
  fetchWinLeaderboard,
} from '@/lib/profile';
import { truncatePubkey } from '@/wallet/WalletProvider';

type BoardId = 'wins' | 'match-3' | 'runner';

const BOARDS: Array<{ id: BoardId; label: string; unit: string; accent: string }> = [
  { id: 'wins', label: 'Wins', unit: 'wins', accent: '#a3e635' },
  { id: 'match-3', label: 'Match-3', unit: 'pts', accent: '#fbbf24' },
  { id: 'runner', label: 'Runner', unit: 'pts', accent: '#34d399' },
];

export function Leaderboard({ mePubkey }: { mePubkey: string }) {
  const [board, setBoard] = useState<BoardId>('wins');
  const [state, setState] = useState<LeaderboardState>({ kind: 'loading' });

  /**
   * Guards against a stale response overwriting a newer one.
   *
   * Tabbing quickly between boards fires overlapping requests, and they can resolve out
   * of order — the slow first response would land after the fast second one and show the
   * wrong board's data. Every fetch is stamped and only the newest is allowed to write.
   */
  const requestIdRef = useRef(0);
  const unmountedRef = useRef(false);

  const load = useCallback(async (which: BoardId) => {
    const id = ++requestIdRef.current;
    setState({ kind: 'loading' });

    const result =
      which === 'wins' ? await fetchWinLeaderboard(10) : await fetchSoloLeaderboard(which, 10);

    // Dropped if a newer request started, or if the component went away.
    if (unmountedRef.current || id !== requestIdRef.current) return;
    setState(result);
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    void load(board);
    return () => {
      unmountedRef.current = true;
    };
  }, [board, load]);

  const active = BOARDS.find((b) => b.id === board) ?? BOARDS[0];

  return (
    <div>
      {/* Board switcher */}
      <div
        className="mb-4 flex gap-1.5 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Leaderboard"
      >
        {BOARDS.map((b) => {
          const selected = b.id === board;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setBoard(b.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-[11px] tracking-wide transition-colors ${
                selected
                  ? 'border-hud-cyan/50 bg-hud-cyan/10 text-hud-cyan'
                  : 'border-hairline bg-black/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              {b.label.toUpperCase()}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${board}:${state.kind}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {state.kind === 'loading' && (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-xl border border-hairline bg-black/50"
                />
              ))}
            </div>
          )}

          {state.kind === 'unavailable' && (
            <div className="rounded-2xl border border-hairline bg-black/40 px-4 py-5 text-center">
              <p className="hud-label text-hud-amber">Leaderboard offline</p>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
                Your own stats and personal bests are saved on this device and work fine. A
                shared leaderboard needs the two Supabase keys — see step 4 of the README.
              </p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/5 px-4 py-5 text-center">
              <p className="hud-label text-red-400">Could not load</p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">{state.message}</p>
              <button
                type="button"
                onClick={() => void load(board)}
                className="mt-4 rounded-lg border border-hairline px-3 py-1.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-hud-cyan/40 hover:text-hud-cyan"
              >
                RETRY
              </button>
            </div>
          )}

          {state.kind === 'ready' && state.rows.length === 0 && (
            <p className="rounded-2xl border border-hairline bg-black/40 px-4 py-6 text-center text-xs text-zinc-600">
              No scores posted yet. Be the first.
            </p>
          )}

          {state.kind === 'ready' && state.rows.length > 0 && (
            <ol className="space-y-1.5">
              {state.rows.map((row, index) => {
                const isMe = row.chainPubkey === mePubkey;
                return (
                  <motion.li
                    key={row.chainPubkey}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.04 }}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                      isMe
                        ? 'border-hud-cyan/40 bg-hud-cyan/[0.07]'
                        : 'border-hairline bg-black/40'
                    }`}
                  >
                    {/* Rank */}
                    <span
                      className={`w-6 shrink-0 text-center font-mono text-xs tabular-nums ${
                        index === 0
                          ? 'text-hud-amber'
                          : index < 3
                            ? 'text-zinc-300'
                            : 'text-zinc-600'
                      }`}
                    >
                      {index + 1}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-zinc-200">
                        {row.displayName || truncatePubkey(row.chainPubkey)}
                        {isMe && <span className="ml-2 hud-label text-hud-cyan">you</span>}
                      </span>
                      {row.played !== undefined && (
                        <span className="hud-label text-zinc-700">
                          {row.played} played
                        </span>
                      )}
                    </span>

                    <span
                      className="shrink-0 font-mono text-sm tabular-nums"
                      style={{ color: active.accent }}
                    >
                      {row.value.toLocaleString()}
                      <span className="ml-1 hud-label text-zinc-700">{active.unit}</span>
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
