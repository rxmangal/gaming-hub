'use client';

/**
 * Tic-Tac-Toe — local, online and single-player AI.
 *
 * Online sync model: each client owns its own mark and broadcasts `{ index, mark }`.
 * The receiver validates that (a) the cell is empty and (b) it really is the sender's
 * turn, then applies it. Because both sides run identical deterministic rules, the
 * boards cannot diverge — and a malicious client can't move for its opponent.
 *
 * Seat 0 always plays X and moves first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { GameShell } from '@/components/game/GameShell';
import { ModeSelect, type AiDifficulty, type PlayMode } from '@/components/game/ModeSelect';
import { RoomJoin, RoomLobby } from '@/components/game/RoomPanel';
import { useRoom } from '@/multiplayer/useRoom';
import type { GameMessage } from '@/multiplayer/types';
import { type MatchOutcome, recordMatch } from '@/lib/profile';
import { useWallet } from '@/wallet/WalletProvider';


import {
  chooseAiMove,
  emptyBoard,
  evaluate,
  other,
  type Board,
  type Mark,
} from './engine';

interface MovePayload {

  index: number;
  mark: Mark;
}

export function TicTacToeGame() {
  const { player } = useWallet();

  const [mode, setMode] = useState<PlayMode | null>(null);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [roomCode, setRoomCode] = useState<string | null>(null);

  const [board, setBoard] = useState<Board>(emptyBoard);
  const [turn, setTurn] = useState<Mark>('X');
  const [scores, setScores] = useState({ X: 0, O: 0, draws: 0 });
  /** Guards against double-counting a result across re-renders. */
  const scoredRef = useRef(false);

  const result = useMemo(() => evaluate(board), [board]);
  const gameOver = result.winner !== null || result.isDraw;

  /* ----------------------------- online wiring ---------------------------- */

  const resetBoard = useCallback(() => {
    setBoard(emptyBoard());
    setTurn('X');
    scoredRef.current = false;
  }, []);

  /** Single handler for every opponent message. */
  const handleMessage = useCallback(
    (msg: GameMessage) => {
      if (msg.type === 'rematch') {
        resetBoard();
        return;
      }

      if (msg.type !== 'move') return;
      const { index, mark } = msg.payload as MovePayload;
      if (typeof index !== 'number' || index < 0 || index > 8) return;
      if (mark !== 'X' && mark !== 'O') return;

      setBoard((prev) => {
        // Validate against our own state — never trust the wire.
        if (prev[index] !== null) return prev;
        if (evaluate(prev).winner !== null) return prev;
        const next = [...prev];
        next[index] = mark;
        return next;
      });
      setTurn(other(mark));
    },
    [resetBoard],
  );


  const room = useRoom({
    gameId: 'ttt',
    roomCode: mode === 'online' ? roomCode : null,
    playerId: player?.chainPubkey ?? null,
    playerName: player?.displayName ?? 'Player',
    onMessage: handleMessage,
  });

  /** Seat 0 is X, seat 1 is O. */
  const myMark: Mark = room.mySeat === 1 ? 'O' : 'X';
  const aiMark: Mark = 'O'; // human is always X against the AI

  const isMyTurn =
    mode === 'online' ? room.bothReady && turn === myMark : mode === 'ai' ? turn === 'X' : true;

  /* ------------------------------- scoring -------------------------------- */

  useEffect(() => {
    if (!gameOver || scoredRef.current) return;
    scoredRef.current = true;

    setScores((prev) => {
      if (result.winner === 'X') return { ...prev, X: prev.X + 1 };
      if (result.winner === 'O') return { ...prev, O: prev.O + 1 };
      return { ...prev, draws: prev.draws + 1 };
    });

    // Persist to the player's profile. `myMark` decides win vs loss: against the AI the
    // human is always X, and online it depends on the seat. In pass-and-play both players
    // share this wallet, so recordMatch() deliberately banks it as a draw.
    if (!player || !mode) return;
    const mine: Mark = mode === 'online' ? myMark : 'X';
    const outcome: MatchOutcome =
      result.winner === null ? 'draw' : result.winner === mine ? 'win' : 'loss';

    recordMatch(player.chainPubkey, player.displayName, {
      gameId: 'tic-tac-toe',
      mode,
      outcome,
      difficulty: mode === 'ai' ? difficulty : undefined,
      endedAt: Date.now(),
    });
    // Only the transition into "game over" should write, so the result fields are the
    // sole dependencies; mode/player/difficulty are stable for the life of a match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver, result.winner]);


  /* --------------------------------- moves -------------------------------- */

  const applyMove = useCallback(
    (index: number, mark: Mark) => {
      setBoard((prev) => {
        if (prev[index] !== null || evaluate(prev).winner !== null) return prev;
        const next = [...prev];
        next[index] = mark;
        return next;
      });
      setTurn(other(mark));
    },
    [],
  );

  const handleCellClick = useCallback(
    (index: number) => {
      if (gameOver || board[index] !== null) return;

      if (mode === 'local') {
        applyMove(index, turn);
        return;
      }

      if (mode === 'ai') {
        if (turn !== 'X') return; // human is X; AI moves on its own
        applyMove(index, 'X');
        return;
      }

      if (mode === 'online') {
        if (!room.bothReady || turn !== myMark) return;
        applyMove(index, myMark);
        void room.send<MovePayload>('move', { index, mark: myMark });
      }
    },
    [gameOver, board, mode, turn, applyMove, room, myMark],
  );

  /** AI turn. The delay is deliberate — instant replies feel robotic. */
  useEffect(() => {
    if (mode !== 'ai' || gameOver || turn !== aiMark) return;
    const timer = window.setTimeout(() => {
      const move = chooseAiMove(board, aiMark, difficulty);
      if (move !== null) applyMove(move, aiMark);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [mode, gameOver, turn, board, difficulty, applyMove, aiMark]);

  /* -------------------------------- resets -------------------------------- */

  /** Resets locally and tells the opponent to do the same. */
  const handleRematch = useCallback(() => {
    resetBoard();
    if (mode === 'online') void room.send('rematch', {});
  }, [resetBoard, mode, room]);

  const exitToMenu = useCallback(() => {

    void room.leave();
    setMode(null);
    setRoomCode(null);
    resetBoard();
    setScores({ X: 0, O: 0, draws: 0 });
  }, [room, resetBoard]);

  /* --------------------------------- render -------------------------------- */

  if (mode === null) {
    return (
      <GameShell title="Tic-Tac-Toe" subtitle="Ten-second duels">
        <ModeSelect
          gameTitle="Tic-Tac-Toe"
          tagline="Three in a row. Pick your poison: the machine, a friend beside you, or a stranger online."
          onStart={(m, d) => {
            setMode(m);
            setDifficulty(d);
            resetBoard();
          }}
        />
      </GameShell>
    );
  }

  // Online: room selection / lobby gates the board.
  if (mode === 'online' && (!roomCode || !room.bothReady)) {
    return (
      <GameShell title="Tic-Tac-Toe" subtitle="Online multiplayer">
        {!roomCode ? (
          <RoomJoin onJoin={setRoomCode} />
        ) : (
          <RoomLobby
            roomCode={roomCode}
            status={room.status}
            players={room.players}
            myId={player?.chainPubkey ?? null}
            isReady={room.isReady}
            error={room.error}
            onSetReady={(r) => void room.setReady(r)}
            onLeave={exitToMenu}
          />
        )}
      </GameShell>
    );
  }

  const subtitle =
    mode === 'ai'
      ? `Single player · ${difficulty}`
      : mode === 'local'
        ? 'Local multiplayer'
        : `Online · room ${roomCode}`;

  const turnLabel = gameOver
    ? result.winner
      ? `${result.winner} wins`
      : 'Draw'
    : mode === 'online'
      ? isMyTurn
        ? 'Your turn'
        : "Opponent's turn"
      : mode === 'ai'
        ? turn === 'X'
          ? 'Your turn'
          : 'AI thinking…'
        : `${turn} to play`;

  return (
    <GameShell title="Tic-Tac-Toe" subtitle={subtitle}>
      <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1fr_18rem]">
        {/* ----------------------------- Board ----------------------------- */}
        <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5 sm:p-7">
          <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />

          {/* Turn banner */}
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {!gameOver && (
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-hud-cyan"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  aria-hidden="true"
                />
              )}
              <p
                className={`text-sm font-semibold ${
                  gameOver ? 'text-hud-lime' : 'text-zinc-200'
                }`}
                aria-live="polite"
              >
                {turnLabel}
              </p>
            </div>
            {mode === 'online' && (
              <span className="hud-label text-zinc-600">You are {myMark}</span>
            )}
          </div>

          {/* 3x3 grid */}
          <div
            className="relative mx-auto grid aspect-square w-full max-w-md grid-cols-3 gap-2.5"
            role="grid"
            aria-label="Tic-tac-toe board"
          >
            {board.map((cell, index) => {
              const isWinning = result.line?.includes(index) ?? false;
              const clickable = !gameOver && cell === null && isMyTurn;

              return (
                <motion.button
                  key={index}
                  type="button"
                  role="gridcell"
                  aria-label={`Cell ${index + 1}${cell ? `, ${cell}` : ', empty'}`}
                  disabled={!clickable}
                  onClick={() => handleCellClick(index)}
                  whileHover={clickable ? { scale: 1.04 } : undefined}
                  whileTap={clickable ? { scale: 0.95 } : undefined}
                  className={`group relative flex items-center justify-center rounded-2xl border text-4xl font-bold transition-colors duration-200 sm:text-5xl ${
                    isWinning
                      ? 'border-hud-lime/60 bg-hud-lime/10'
                      : 'border-hairline bg-black/50'
                  } ${clickable ? 'cursor-pointer hover:border-hud-cyan/50 hover:bg-hud-cyan/[0.06]' : 'cursor-default'}`}
                >
                  <AnimatePresence>
                    {cell && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0, rotate: -25 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                        className={
                          cell === 'X'
                            ? 'text-hud-cyan text-glow-cyan'
                            : 'text-hud-magenta'
                        }
                      >
                        {cell}
                      </motion.span>
                    )}
                  </AnimatePresence>

                  {/* Ghost preview of the mark you would place */}
                  {clickable && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100">
                      {mode === 'online' ? myMark : turn}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* Result + rematch */}
          <AnimatePresence>
            {gameOver && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-6 flex flex-col items-center gap-3"
              >
                <p className="text-lg font-semibold text-zinc-100">
                  {result.isDraw
                    ? 'Draw — nobody blinked.'
                    : mode === 'ai'
                      ? result.winner === 'X'
                        ? 'You win.'
                        : 'The machine wins.'
                      : mode === 'online'
                        ? result.winner === myMark
                          ? 'You win.'
                          : 'You lose.'
                        : `${result.winner} takes it.`}
                </p>
                <div className="flex gap-2.5">
                  <motion.button
                    type="button"
                    onClick={handleRematch}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
                  >
                    Play again
                  </motion.button>
                  <button
                    type="button"
                    onClick={exitToMenu}
                    className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                  >
                    Change mode
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ----------------------------- Sidebar ---------------------------- */}
        <div className="space-y-4">
          {/* Scoreboard */}
          <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5">
            <p className="hud-label text-zinc-600">Scoreboard</p>
            <div className="mt-4 space-y-3">
              {[
                { mark: 'X' as Mark, value: scores.X, color: 'text-hud-cyan' },
                { mark: 'O' as Mark, value: scores.O, color: 'text-hud-magenta' },
              ].map((row) => (
                <div key={row.mark} className="flex items-center justify-between">
                  <span className={`text-lg font-bold ${row.color}`}>{row.mark}</span>
                  <span className="font-mono text-lg text-zinc-200">{row.value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-hairline pt-3">
                <span className="hud-label text-zinc-600">Draws</span>
                <span className="font-mono text-sm text-zinc-400">{scores.draws}</span>
              </div>
            </div>
          </div>

          {/* Opponent card */}
          {mode === 'online' && room.opponent && (
            <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5">
              <p className="hud-label text-zinc-600">Opponent</p>
              <p className="mt-2 truncate font-mono text-sm text-zinc-200">
                {room.opponent.name}
              </p>
              <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    room.status === 'opponent_left' ? 'bg-red-500' : 'bg-hud-lime'
                  }`}
                  aria-hidden="true"
                />
                <span className="hud-label text-zinc-500">
                  {room.status === 'opponent_left' ? 'Disconnected' : 'Connected'}
                </span>
              </div>
            </div>
          )}

          {/* Opponent-left notice */}
          {mode === 'online' && room.status === 'opponent_left' && (
            <div className="rounded-3xl border border-hud-amber/30 bg-hud-amber/[0.07] p-5">
              <p className="text-xs leading-relaxed text-amber-200">
                Your opponent disconnected. They can rejoin with the same room code, or you can
                head back and start a new game.
              </p>
              <button
                type="button"
                onClick={exitToMenu}
                className="mt-3 w-full rounded-xl border border-hairline py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700"
              >
                Back to modes
              </button>
            </div>
          )}

          {/* Controls */}
          <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5">
            <p className="hud-label text-zinc-600">Controls</p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleRematch}
                className="w-full rounded-xl border border-hairline bg-black/40 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-hud-cyan/40 hover:text-white"
              >
                Reset board
              </button>
              <button
                type="button"
                onClick={exitToMenu}
                className="w-full rounded-xl border border-hairline py-2.5 text-xs font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
              >
                Change mode
              </button>
            </div>
          </div>
        </div>
      </div>
    </GameShell>
  );
}
