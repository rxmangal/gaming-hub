/**
 * Tic-Tac-Toe rules engine + AI.
 *
 * Pure functions, zero React, zero I/O — which makes the AI trivially testable and
 * lets the exact same code run for local, online and single-player modes.
 */

export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Board = Cell[]; // length 9, index 0..8 reading left-to-right, top-to-bottom

export type Difficulty = 'normal' | 'hard' | 'advanced';

export interface GameResult {
  winner: Mark | null;
  /** Indices of the winning line, for the strike-through animation. */
  line: number[] | null;
  isDraw: boolean;
}

export const WIN_LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8], // rows
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8], // columns
  [0, 4, 8],
  [2, 4, 6], // diagonals
];

export const emptyBoard = (): Board => Array<Cell>(9).fill(null);

export function evaluate(board: Board): GameResult {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) {
      return { winner: mark, line, isDraw: false };
    }
  }
  const full = board.every((cell) => cell !== null);
  return { winner: null, line: null, isDraw: full };
}

export const legalMoves = (board: Board): number[] =>
  board.reduce<number[]>((acc, cell, i) => (cell === null ? (acc.push(i), acc) : acc), []);

export const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

/* ------------------------------------------------------------------ *
 * AI
 * ------------------------------------------------------------------ */

/**
 * Minimax with depth-aware scoring.
 *
 * Depth matters: it makes the AI prefer winning SOON and losing LATE. Without it the
 * engine plays technically-correct but bizarre moves, e.g. ignoring an immediate win
 * because a slower win scores identically.
 */
function minimax(board: Board, aiMark: Mark, turn: Mark, depth: number): number {
  const { winner, isDraw } = evaluate(board);
  if (winner === aiMark) return 10 - depth;
  if (winner) return depth - 10;
  if (isDraw) return 0;

  const moves = legalMoves(board);
  const maximizing = turn === aiMark;
  let best = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    board[move] = turn;
    const score = minimax(board, aiMark, other(turn), depth + 1);
    board[move] = null; // undo — we mutate in place to avoid 500k array copies
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

/** Every move ranked by minimax score. */
function scoredMoves(board: Board, aiMark: Mark): Array<{ move: number; score: number }> {
  const work = [...board];
  return legalMoves(work)
    .map((move) => {
      work[move] = aiMark;
      const score = minimax(work, aiMark, other(aiMark), 1);
      work[move] = null;
      return { move, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Immediate win/block detection — the basis of "tactical" play. */
function findCriticalMove(board: Board, mark: Mark): number | null {
  for (const move of legalMoves(board)) {
    const probe = [...board];
    probe[move] = mark;
    if (evaluate(probe).winner === mark) return move;
  }
  return null;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Chooses the AI's move.
 *
 * - `normal`   — ~45% random. Beatable, and forgiving for new players.
 * - `hard`     — always takes a win and always blocks, otherwise strong heuristics,
 *                but skips deep minimax so a clever fork can still beat it.
 * - `advanced` — full minimax. Mathematically unbeatable; best case is a draw.
 */
export function chooseAiMove(board: Board, aiMark: Mark, difficulty: Difficulty): number | null {
  const moves = legalMoves(board);
  if (moves.length === 0) return null;

  const human = other(aiMark);

  if (difficulty === 'normal') {
    // A deliberate blunder rate. Still takes an obvious win so it doesn't feel broken.
    const win = findCriticalMove(board, aiMark);
    if (win !== null && Math.random() > 0.25) return win;
    if (Math.random() < 0.45) return pickRandom(moves);
    const block = findCriticalMove(board, human);
    if (block !== null && Math.random() > 0.4) return block;
    const best = scoredMoves(board, aiMark);
    // Choose from the top half — decent, not surgical.
    const pool = best.slice(0, Math.max(1, Math.ceil(best.length / 2)));
    return pickRandom(pool).move;
  }

  if (difficulty === 'hard') {
    // Tactical: never misses a win or a block.
    const win = findCriticalMove(board, aiMark);
    if (win !== null) return win;
    const block = findCriticalMove(board, human);
    if (block !== null) return block;

    // Positional heuristics rather than exhaustive search — this is the gap that
    // lets a strong human construct a double-threat fork and win.
    if (board[4] === null) return 4;
    const corners = [0, 2, 6, 8].filter((i) => board[i] === null);
    if (corners.length > 0) return pickRandom(corners);
    const edges = [1, 3, 5, 7].filter((i) => board[i] === null);
    if (edges.length > 0) return pickRandom(edges);
    return moves[0];
  }

  // advanced — perfect play. Ties are broken randomly so games are not identical.
  const ranked = scoredMoves(board, aiMark);
  const topScore = ranked[0].score;
  return pickRandom(ranked.filter((m) => m.score === topScore)).move;
}
