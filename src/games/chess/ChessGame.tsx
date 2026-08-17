'use client';

/**
 * Chess — local, online and single-player AI, with chess.js as the rule engine.
 *
 * Input model: tap/click a piece to select it, then tap/click a highlighted square to
 * move. Tap-to-move (rather than drag-and-drop) works identically with a mouse and a
 * touchscreen, which is why it is the primary interaction.
 *
 * Online sync: we broadcast `{ from, to, promotion }` and each client applies it through
 * its own chess.js instance, so an illegal or forged move is simply rejected locally.
 * Seat 0 plays white.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Chess, type Move, type Square } from 'chess.js';

import { GameShell } from '@/components/game/GameShell';
import { ModeSelect, type AiDifficulty, type PlayMode } from '@/components/game/ModeSelect';
import { RoomJoin, RoomLobby } from '@/components/game/RoomPanel';
import { useRoom } from '@/multiplayer/useRoom';
import type { GameMessage } from '@/multiplayer/types';
import { type MatchOutcome, recordMatch } from '@/lib/profile';
import { useWallet } from '@/wallet/WalletProvider';


import { chooseChessMove } from './ai';

/** Unicode glyphs. Filled shapes for both colours; CSS supplies the contrast. */
const GLYPH: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

interface ChessMovePayload {
  from: string;
  to: string;
  promotion?: string;
}

/** A board cell as rendered. */
interface Cell {
  square: Square;
  piece: { type: string; color: 'w' | 'b' } | null;
  isLight: boolean;
}

export function ChessGame() {
  const { player } = useWallet();

  const [mode, setMode] = useState<PlayMode | null>(null);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [roomCode, setRoomCode] = useState<string | null>(null);

  /**
   * chess.js instance is the single source of truth. It is mutable, so we keep it in a
   * ref and mirror its FEN into state to trigger renders. This avoids cloning the whole
   * engine on every move while still being fully reactive.
   */
  const engineRef = useRef<Chess>(new Chess());
  const [fen, setFen] = useState(() => engineRef.current.fen());
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  /** Pending promotion awaiting the player's piece choice. */
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const game = engineRef.current;

  /** Recomputed whenever the FEN changes. */
  const view = useMemo(() => {
    const board = game.board();
    const cells: Cell[] = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        cells.push({
          square: `${FILES[f]}${RANKS[r]}` as Square,
          piece: cell ? { type: cell.type, color: cell.color } : null,
          isLight: (r + f) % 2 === 0,
        });
      }
    }

    const history = game.history({ verbose: true }) as Move[];

    return {
      cells,
      turn: game.turn(),
      inCheck: game.inCheck(),
      isCheckmate: game.isCheckmate(),
      isStalemate: game.isStalemate(),
      isDraw: game.isDraw(),
      isGameOver: game.isGameOver(),
      isInsufficientMaterial: game.isInsufficientMaterial(),
      isThreefold: game.isThreefoldRepetition(),
      history,
    };
    // `fen` is the dependency that signals the engine mutated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, game]);

  /** Sync React state from the engine after any mutation. */
  const syncFromEngine = useCallback(() => {
    setFen(engineRef.current.fen());
  }, []);

  /* ----------------------------- online wiring ---------------------------- */

  const resetGame = useCallback(() => {
    engineRef.current = new Chess();
    setSelected(null);
    setLastMove(null);
    setPromotion(null);
    setThinking(false);
    setFen(engineRef.current.fen());
  }, []);

  const handleMessage = useCallback(
    (msg: GameMessage) => {
      if (msg.type === 'rematch') {
        resetGame();
        return;
      }
      if (msg.type !== 'move') return;

      const { from, to, promotion: promo } = msg.payload as ChessMovePayload;
      if (typeof from !== 'string' || typeof to !== 'string') return;

      // chess.js throws on an illegal move, which is exactly the validation we want:
      // a forged or out-of-turn move from the wire is simply dropped.
      try {
        engineRef.current.move({ from, to, promotion: promo });
        setLastMove({ from, to });
        setSelected(null);
        syncFromEngine();
      } catch {
        /* illegal move received — ignore it */
      }
    },
    [resetGame, syncFromEngine],
  );

  const room = useRoom({
    gameId: 'chess',
    roomCode: mode === 'online' ? roomCode : null,
    playerId: player?.chainPubkey ?? null,
    playerName: player?.displayName ?? 'Player',
    onMessage: handleMessage,
  });

  /** Seat 0 = white. Against the AI the human is always white. */
  const myColor: 'w' | 'b' = mode === 'online' ? (room.mySeat === 1 ? 'b' : 'w') : 'w';
  const aiColor: 'w' | 'b' = 'b';

  /** Board is shown from the player's own side. */
  const flipped = mode === 'online' && myColor === 'b';

  const isMyTurn =
    mode === 'local'
      ? true
      : mode === 'ai'
        ? view.turn === 'w' && !thinking
        : room.bothReady && view.turn === myColor;

  /** Legal destination squares for the selected piece. */
  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const moves = game.moves({ square: selected, verbose: true }) as Move[];
    return new Set(moves.map((m) => m.to));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fen, game]);

  /* --------------------------------- moves -------------------------------- */

  /** Applies a move locally and broadcasts it when online. */
  const commitMove = useCallback(
    (from: Square, to: Square, promo?: string) => {
      try {
        engineRef.current.move({ from, to, promotion: promo });
      } catch {
        return false; // illegal — ignore
      }
      setLastMove({ from, to });
      setSelected(null);
      setPromotion(null);
      syncFromEngine();

      if (mode === 'online') {
        void room.send<ChessMovePayload>('move', { from, to, promotion: promo });
      }
      return true;
    },
    [mode, room, syncFromEngine],
  );

  /**
   * Detects whether a move needs a promotion choice. We ask chess.js for the legal
   * moves from that square rather than guessing from rank arithmetic.
   */
  const needsPromotion = useCallback(
    (from: Square, to: Square) => {
      const moves = game.moves({ square: from, verbose: true }) as Move[];
      return moves.some((m) => m.to === to && Boolean(m.promotion));
    },
    [game],
  );

  const handleSquareClick = useCallback(
    (square: Square) => {
      if (view.isGameOver || promotion) return;

      // Selecting one of your own pieces.
      const piece = game.get(square);
      const movableColor = mode === 'local' ? view.turn : mode === 'ai' ? 'w' : myColor;

      if (selected === square) {
        setSelected(null);
        return;
      }

      if (selected && legalTargets.has(square)) {
        if (!isMyTurn) return;
        if (needsPromotion(selected, square)) {
          setPromotion({ from: selected, to: square });
          return;
        }
        commitMove(selected, square);
        return;
      }

      if (piece && piece.color === movableColor && piece.color === view.turn) {
        setSelected(square);
        return;
      }

      setSelected(null);
    },
    [
      view.isGameOver,
      view.turn,
      promotion,
      game,
      mode,
      myColor,
      selected,
      legalTargets,
      isMyTurn,
      needsPromotion,
      commitMove,
    ],
  );

  /* ---------------------------------- AI ---------------------------------- */

  useEffect(() => {
    if (mode !== 'ai' || view.isGameOver || view.turn !== aiColor) return;

    let cancelled = false;
    setThinking(true);

    // Defer to a macrotask so React can paint the player's move (and the "thinking"
    // indicator) before the search blocks the main thread.
    const timer = window.setTimeout(() => {
      const result = chooseChessMove(engineRef.current.fen(), difficulty);
      if (cancelled) return;

      if (result) {
        try {
          engineRef.current.move({
            from: result.from,
            to: result.to,
            promotion: result.promotion,
          });
          setLastMove({ from: result.from, to: result.to });
          syncFromEngine();
        } catch {
          /* should not happen: the move came from the engine's own list */
        }
      }
      setThinking(false);
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setThinking(false);
    };
  }, [mode, view.isGameOver, view.turn, fen, difficulty, aiColor, syncFromEngine]);

  /* ------------------------------- profile -------------------------------- */

  /**
   * Records the finished game once.
   *
   * The winner is derived from whose turn it is at checkmate — in chess.js, checkmate
   * means the side *to move* has no legal reply, so that side lost. Every other terminal
   * state (stalemate, insufficient material, threefold, 50-move) is a draw.
   */
  const recordedRef = useRef(false);

  useEffect(() => {
    if (!view.isGameOver) {
      // A new game resets the guard so the next result is recorded.
      recordedRef.current = false;
      return;
    }
    if (recordedRef.current || !player || !mode) return;
    recordedRef.current = true;

    const loser = view.turn; // side to move at game over
    const mine: 'w' | 'b' = mode === 'online' ? myColor : 'w';
    const outcome: MatchOutcome = view.isCheckmate ? (loser === mine ? 'loss' : 'win') : 'draw';

    recordMatch(player.chainPubkey, player.displayName, {
      gameId: 'chess',
      mode,
      outcome,
      difficulty: mode === 'ai' ? difficulty : undefined,
      endedAt: Date.now(),
    });
    // Fires only on the transition into/out of a finished game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.isGameOver, view.isCheckmate, view.turn]);

  /* --------------------------------- misc --------------------------------- */

  const handleUndo = useCallback(() => {

    // Undo is offline-only: rewinding a shared game needs opponent consent.
    if (mode === 'online') return;
    engineRef.current.undo();
    // Against the AI, undo the pair so it's the human's turn again.
    if (mode === 'ai') engineRef.current.undo();
    setSelected(null);
    setLastMove(null);
    syncFromEngine();
  }, [mode, syncFromEngine]);

  const handleRematch = useCallback(() => {
    resetGame();
    if (mode === 'online') void room.send('rematch', {});
  }, [resetGame, mode, room]);

  const exitToMenu = useCallback(() => {
    void room.leave();
    setMode(null);
    setRoomCode(null);
    resetGame();
  }, [room, resetGame]);

  /* --------------------------------- render -------------------------------- */

  if (mode === null) {
    return (
      <GameShell title="Chess" subtitle="Full rules, no mercy">
        <ModeSelect
          gameTitle="Chess"
          tagline="Complete rules via chess.js — castling, en passant, promotion, checkmate and stalemate."
          onStart={(m, d) => {
            setMode(m);
            setDifficulty(d);
            resetGame();
          }}
        />
      </GameShell>
    );
  }

  if (mode === 'online' && (!roomCode || !room.bothReady)) {
    return (
      <GameShell title="Chess" subtitle="Online multiplayer">
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

  // Status line.
  let statusText: string;
  if (view.isCheckmate) {
    const winner = view.turn === 'w' ? 'Black' : 'White';
    statusText = `Checkmate — ${winner} wins`;
  } else if (view.isStalemate) {
    statusText = 'Stalemate — draw';
  } else if (view.isInsufficientMaterial) {
    statusText = 'Draw — insufficient material';
  } else if (view.isThreefold) {
    statusText = 'Draw — threefold repetition';
  } else if (view.isDraw) {
    statusText = 'Draw';
  } else if (thinking) {
    statusText = 'AI thinking…';
  } else if (view.inCheck) {
    statusText = `${view.turn === 'w' ? 'White' : 'Black'} is in check`;
  } else if (mode === 'online') {
    statusText = isMyTurn ? 'Your turn' : "Opponent's turn";
  } else if (mode === 'ai') {
    statusText = view.turn === 'w' ? 'Your turn' : 'AI to move';
  } else {
    statusText = `${view.turn === 'w' ? 'White' : 'Black'} to move`;
  }

  const orderedCells = flipped ? [...view.cells].reverse() : view.cells;

  // Move history as SAN pairs for the sidebar.
  const movePairs: Array<{ no: number; white?: string; black?: string }> = [];
  view.history.forEach((move, i) => {
    const pairIndex = Math.floor(i / 2);
    if (!movePairs[pairIndex]) movePairs[pairIndex] = { no: pairIndex + 1 };
    if (i % 2 === 0) movePairs[pairIndex].white = move.san;
    else movePairs[pairIndex].black = move.san;
  });

  return (
    <GameShell title="Chess" subtitle={subtitle}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ------------------------------ Board ----------------------------- */}
        <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-4 sm:p-6">
          <div className="hud-corners pointer-events-none absolute inset-0" aria-hidden="true" />

          {/* Status bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!view.isGameOver && (
                <motion.span
                  className={`h-1.5 w-1.5 rounded-full ${
                    view.inCheck ? 'bg-hud-amber' : 'bg-hud-cyan'
                  }`}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  aria-hidden="true"
                />
              )}
              <p
                className={`text-sm font-semibold ${
                  view.isGameOver
                    ? 'text-hud-lime'
                    : view.inCheck
                      ? 'text-hud-amber'
                      : 'text-zinc-200'
                }`}
                aria-live="polite"
              >
                {statusText}
              </p>
            </div>
            {mode === 'online' && (
              <span className="hud-label text-zinc-600">
                You are {myColor === 'w' ? 'White' : 'Black'}
              </span>
            )}
          </div>

          {/* 8x8 board */}
          <div
            className="mx-auto grid aspect-square w-full max-w-[min(88vw,34rem)] grid-cols-8 overflow-hidden rounded-xl border border-white/10"
            role="grid"
            aria-label="Chess board"
          >
            {orderedCells.map((cell) => {
              const isSelected = selected === cell.square;
              const isTarget = legalTargets.has(cell.square);
              const isLast =
                lastMove?.from === cell.square || lastMove?.to === cell.square;
              const isCapture = isTarget && cell.piece !== null;
              const kingInCheck =
                view.inCheck &&
                cell.piece?.type === 'k' &&
                cell.piece.color === view.turn;

              return (
                <button
                  key={cell.square}
                  type="button"
                  role="gridcell"
                  aria-label={`${cell.square}${
                    cell.piece
                      ? `, ${cell.piece.color === 'w' ? 'white' : 'black'} ${cell.piece.type}`
                      : ', empty'
                  }`}
                  onClick={() => handleSquareClick(cell.square)}
                  className={`relative flex touch-manipulation select-none items-center justify-center transition-colors duration-150 ${
                    cell.isLight ? 'bg-[#2a2e35]' : 'bg-[#15181d]'
                  } ${isSelected ? '!bg-hud-cyan/25' : ''} ${
                    isLast && !isSelected ? '!bg-hud-cyan/[0.08]' : ''
                  } ${kingInCheck ? '!bg-red-500/25' : ''}`}
                >
                  {/* Legal-move indicator */}
                  {isTarget && !isCapture && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute h-1/4 w-1/4 rounded-full bg-hud-cyan/45"
                      aria-hidden="true"
                    />
                  )}
                  {isCapture && (
                    <motion.span
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="absolute inset-[6%] rounded-md ring-2 ring-hud-magenta/70"
                      aria-hidden="true"
                    />
                  )}

                  {cell.piece && (
                    <motion.span
                      layoutId={`piece-${cell.square}-${cell.piece.color}${cell.piece.type}`}
                      initial={false}
                      className={`relative z-10 text-[clamp(1.4rem,5.2vw,2.5rem)] leading-none ${
                        cell.piece.color === 'w'
                          ? 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]'
                          : 'text-[#0c0d10] [text-shadow:0_0_1px_rgba(255,255,255,0.45)]'
                      }`}
                    >
                      {GLYPH[cell.piece.type]}
                    </motion.span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Promotion picker */}
          <AnimatePresence>
            {promotion && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 10 }}
                  animate={{ scale: 1, y: 0 }}
                  className="rounded-2xl border border-hairline bg-panel-raised p-5 text-center"
                >
                  <p className="hud-label mb-4 text-hud-cyan">Promote to</p>
                  <div className="flex gap-2">
                    {(['q', 'r', 'b', 'n'] as const).map((piece) => (
                      <button
                        key={piece}
                        type="button"
                        onClick={() => commitMove(promotion.from, promotion.to, piece)}
                        className="flex h-14 w-14 items-center justify-center rounded-xl border border-hairline bg-black/50 text-3xl text-white transition-colors hover:border-hud-cyan/60 hover:bg-hud-cyan/10"
                        aria-label={`Promote to ${piece}`}
                      >
                        {GLYPH[piece]}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Game over */}
          <AnimatePresence>
            {view.isGameOver && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 flex flex-col items-center gap-3"
              >
                <div className="flex gap-2.5">
                  <motion.button
                    type="button"
                    onClick={handleRematch}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
                  >
                    New game
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
          {/* Move history */}
          <div className="relative overflow-hidden rounded-3xl border border-hairline bg-panel p-5">
            <div className="flex items-center justify-between">
              <p className="hud-label text-zinc-600">Move history</p>
              <span className="hud-label text-zinc-700">{view.history.length} plies</span>
            </div>

            <div className="mt-3 max-h-64 overflow-y-auto pr-1">
              {movePairs.length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-700">No moves yet</p>
              ) : (
                <table className="w-full font-mono text-xs">
                  <tbody>
                    {movePairs.map((pair) => (
                      <tr key={pair.no} className="border-b border-hairline/50 last:border-0">
                        <td className="w-8 py-1.5 text-zinc-700">{pair.no}.</td>
                        <td className="py-1.5 text-zinc-200">{pair.white ?? ''}</td>
                        <td className="py-1.5 text-zinc-400">{pair.black ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Opponent */}
          {mode === 'online' && room.opponent && (
            <div className="rounded-3xl border border-hairline bg-panel p-5">
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

          {mode === 'online' && room.status === 'opponent_left' && (
            <div className="rounded-3xl border border-hud-amber/30 bg-hud-amber/[0.07] p-5">
              <p className="text-xs leading-relaxed text-amber-200">
                Your opponent disconnected. The position is preserved — they can rejoin with the
                same room code.
              </p>
            </div>
          )}

          {/* Controls */}
          <div className="rounded-3xl border border-hairline bg-panel p-5">
            <p className="hud-label text-zinc-600">Controls</p>
            <div className="mt-3 flex flex-col gap-2">
              {mode !== 'online' && (
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={view.history.length === 0 || thinking}
                  className="w-full rounded-xl border border-hairline bg-black/40 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-hud-cyan/40 hover:text-white disabled:opacity-40"
                >
                  Undo move
                </button>
              )}
              <button
                type="button"
                onClick={handleRematch}
                className="w-full rounded-xl border border-hairline bg-black/40 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-hud-cyan/40 hover:text-white"
              >
                New game
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
