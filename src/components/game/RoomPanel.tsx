'use client';

/**
 * RoomPanel — create/join a room, then show the roster and ready-up controls.
 *
 * Purely presentational: all state comes from `useRoom`, so this same panel serves
 * Tic-Tac-Toe, Chess and any future game.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { generateRoomCode, normalizeRoomCode } from '@/multiplayer/useRoom';
import type { RoomPlayer, RoomStatus } from '@/multiplayer/types';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Step 1: pick a code. */
export function RoomJoin({ onJoin }: { onJoin: (code: string) => void }) {
  const [code, setCode] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="mx-auto max-w-md"
    >
      <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-6">
        <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />

        <p className="hud-label text-hud-magenta">Online multiplayer</p>
        <h2 className="mt-2 text-xl font-semibold text-zinc-100">Create or join a room</h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Share the 4-character code with your opponent. Your Sphere identity is your seat, so
          a reconnect puts you straight back in the same game.
        </p>

        <motion.button
          type="button"
          onClick={() => onJoin(generateRoomCode())}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
        >
          Create a new room
        </motion.button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="hud-label text-zinc-700">or join</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const clean = normalizeRoomCode(code);
            if (clean.length >= 4) onJoin(clean);
          }}
          className="flex gap-2"
        >
          <input
            value={code}
            onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
            placeholder="CODE"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Room code"
            className="min-w-0 flex-1 rounded-xl border border-hairline bg-black/60 px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-zinc-100 uppercase placeholder:tracking-normal placeholder:text-zinc-700 focus:border-hud-cyan/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={normalizeRoomCode(code).length < 4}
            className="shrink-0 rounded-xl border border-hairline bg-panel-raised px-5 text-sm font-medium text-zinc-200 transition-colors hover:border-hud-cyan/40 disabled:opacity-40"
          >
            Join
          </button>
        </form>
      </div>
    </motion.div>
  );
}

/** Step 2: waiting room with roster + ready toggle. */
export function RoomLobby({
  roomCode,
  status,
  players,
  myId,
  isReady,
  error,
  onSetReady,
  onLeave,
}: {
  roomCode: string;
  status: RoomStatus;
  players: RoomPlayer[];
  myId: string | null;
  isReady: boolean;
  error: string | null;
  onSetReady: (ready: boolean) => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — code is on screen */
    }
  }

  const statusText: Record<RoomStatus, string> = {
    idle: 'Idle',
    unavailable: 'Online play not configured',
    connecting: 'Connecting to game server…',
    waiting: 'Waiting for an opponent…',
    lobby: 'Both players here — ready up',
    ready: 'Starting…',
    opponent_left: 'Your opponent left the room',
    error: error ?? 'Connection error',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="mx-auto max-w-md"
    >
      <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-6">
        <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />

        {/* Room code */}
        <div className="text-center">
          <p className="hud-label text-zinc-600">Room code</p>
          <button
            type="button"
            onClick={copyCode}
            className="mt-2 font-mono text-4xl font-bold tracking-[0.25em] text-hud-cyan text-glow-cyan transition-opacity hover:opacity-80"
            aria-label={`Room code ${roomCode}. Click to copy.`}
          >
            {roomCode}
          </button>
          <p className="mt-2 hud-label text-zinc-700">{copied ? 'Copied' : 'Tap to copy'}</p>
        </div>

        {/* Status line */}
        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-hairline bg-black/40 px-4 py-2.5">
          {(status === 'connecting' || status === 'waiting') && (
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-hud-cyan"
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              aria-hidden="true"
            />
          )}
          <p
            className={`text-xs ${
              status === 'error' || status === 'opponent_left'
                ? 'text-hud-amber'
                : 'text-zinc-400'
            }`}
          >
            {statusText[status]}
          </p>
        </div>

        {/* Roster */}
        <div className="mt-5 space-y-2">
          {[0, 1].map((seat) => {
            const player = players.find((p) => p.seat === seat);
            const isMe = player?.id === myId;
            return (
              <div
                key={seat}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  player ? 'border-hairline bg-panel-raised' : 'border-dashed border-hairline'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="hud-label text-zinc-700">P{seat + 1}</span>
                  <span
                    className={`truncate font-mono text-xs ${
                      player ? 'text-zinc-200' : 'text-zinc-700'
                    }`}
                  >
                    {player ? player.name : 'Empty seat'}
                  </span>
                  {isMe && <span className="hud-label text-hud-cyan">You</span>}
                </div>
                {player && (
                  <span
                    className={`hud-label ${player.ready ? 'text-hud-lime' : 'text-zinc-600'}`}
                  >
                    {player.ready ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2.5">
          <AnimatePresence mode="wait">
            {players.length === 2 && (
              <motion.button
                key="ready"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                type="button"
                onClick={() => onSetReady(!isReady)}
                className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors ${
                  isReady
                    ? 'border border-hud-lime/40 bg-hud-lime/10 text-hud-lime hover:bg-hud-lime/20'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {isReady ? 'Ready — waiting for opponent' : "I'm ready"}
              </motion.button>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={onLeave}
            className="w-full rounded-xl border border-hairline py-3 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            Leave room
          </button>
        </div>
      </div>
    </motion.div>
  );
}
