/**
 * Chess AI — negamax + alpha-beta pruning over the chess.js rule engine.
 *
 * chess.js 1.4.0 API notes (verified against the installed package):
 *   - `move()` THROWS on an illegal move (it does not return null), so every call is guarded.
 *   - `moves({ verbose: true })` yields Move objects with from/to/san/captured/promotion.
 *   - Terminal tests are `isCheckmate()`, `isStalemate()`, `isDraw()`, `isGameOver()`.
 *
 * Search design:
 *   - ITERATIVE DEEPENING under a wall-clock budget. A fixed depth can hang the tab on a
 *     busy position; a time budget keeps the UI responsive and always returns a legal move.
 *   - MOVE ORDERING (MVV-LVA + promotions + checks) so alpha-beta prunes aggressively.
 *   - Evaluation = material + piece-square tables + mobility + mate/stalemate terms.
 */

import { Chess, type Move } from 'chess.js';

export type ChessDifficulty = 'normal' | 'hard' | 'advanced';

/** Centipawn values. */
const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/**
 * Piece-square tables, written from WHITE's point of view, rank 8 first.
 * They encode ordinary positional wisdom: knights want the centre, pawns want to
 * advance, the king wants to stay tucked away in the middlegame.
 */
const PST: Record<string, number[]> = {
  p: [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

const MATE_SCORE = 100_000;

/** Converts an algebraic square to a PST index (0 = a8 … 63 = h1). */
function squareIndex(square: string): number {
  const file = square.charCodeAt(0) - 97; // a..h -> 0..7
  const rank = Number(square[1]); // 1..8
  return (8 - rank) * 8 + file;
}

/**
 * Static evaluation, always from WHITE's perspective (positive = white is better).
 *
 * PERFORMANCE: this must NOT call isCheckmate()/isDraw()/isStalemate(). Each of those
 * generates the full legal-move list, and the caller has already determined that the
 * position is not terminal. Calling them here cost ~5 redundant move generations per
 * leaf node and pinned the search at depth 2.
 */
function evaluatePosition(game: Chess): number {
  let score = 0;

  for (const row of game.board()) {
    for (const cell of row) {
      if (!cell) continue;
      const value = PIECE_VALUE[cell.type] ?? 0;
      const table = PST[cell.type];
      const idx = squareIndex(cell.square);
      // Black reads the same table mirrored vertically.
      const positional = table ? table[cell.color === 'w' ? idx : 63 - idx] : 0;
      score += cell.color === 'w' ? value + positional : -(value + positional);
    }
  }
  return score;
}

/** MVV-LVA style ordering score: try the most promising moves first. */
function moveOrderScore(move: Move): number {
  let score = 0;
  if (move.captured) {
    // Most Valuable Victim minus Least Valuable Aggressor.
    score += 10 * (PIECE_VALUE[move.captured] ?? 0) - (PIECE_VALUE[move.piece] ?? 0);
  }
  if (move.promotion) score += 800;
  if (move.san.includes('+')) score += 50;
  if (move.san.includes('#')) score += 10_000;
  return score;
}

interface SearchState {
  deadline: number;
  timedOut: boolean;
  nodes: number;
}

/**
 * Negamax with alpha-beta. Returns a score from the perspective of the side to move.
 */
function negamax(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  state: SearchState,
): number {
  state.nodes++;

  // Check the clock often. Nodes here are expensive (chess.js move generation), so a
  // coarse interval let the search overshoot its budget by more than a second.
  if ((state.nodes & 63) === 0 && Date.now() > state.deadline) {
    state.timedOut = true;
  }
  if (state.timedOut) return 0;

  const perspective = game.turn() === 'w' ? 1 : -1;

  /*
   * LEAF NODES: return the static evaluation WITHOUT generating moves.
   *
   * This is the single most important optimisation in the search. Leaves are the large
   * majority of all nodes, and `moves({ verbose: true })` is very costly in chess.js
   * 1.4.0 because every Move object carries `before`/`after` FEN strings — roughly 35
   * FEN serialisations per call. Generating moves at every leaf held the search to
   * depth 2 (~1.5k nodes in 3.6s).
   *
   * The only thing we lose is mate detection exactly ON the horizon, so we still check
   * when the side to move is in check — `inCheck()` is a single attack test, and checks
   * are rare enough that this stays cheap.
   */
  if (depth <= 0) {
    if (game.inCheck() && game.moves().length === 0) {
      return -MATE_SCORE + (10 - depth); // mate found at the horizon
    }
    return evaluatePosition(game) * perspective;
  }

  const moves = game.moves({ verbose: true }) as Move[];

  if (moves.length === 0) {
    // No legal moves: mate if we're in check, stalemate otherwise.
    if (game.inCheck()) return -MATE_SCORE + (10 - depth); // prefer faster mates
    return 0; // stalemate
  }

  // Cheap draw checks that do NOT generate moves.
  if (game.isInsufficientMaterial() || game.isDrawByFiftyMoves()) return 0;

  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));


  let best = -Infinity;
  for (const move of moves) {
    // Apply by {from,to,promotion} rather than SAN: chess.js has to re-parse and
    // disambiguate SAN strings, which is measurably slower inside a hot search loop.
    try {
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
    } catch {
      continue;
    }
    const score = -negamax(game, depth - 1, -beta, -alpha, state);
    game.undo();

    if (state.timedOut) return best === -Infinity ? 0 : best;

    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // fail-high: opponent would never allow this line
  }

  return best === -Infinity ? 0 : best;
}


/** Per-difficulty search + behaviour settings. */
const SETTINGS: Record<
  ChessDifficulty,
  { maxDepth: number; budgetMs: number; blunderChance: number; topN: number }
> = {
  // Shallow and deliberately erratic: picks from a wider band and sometimes throws
  // a move away entirely, so a beginner can win.
  normal: { maxDepth: 2, budgetMs: 400, blunderChance: 0.3, topN: 4 },
  // Tactical: `topN: 1` is important — it must ALWAYS play the best move it found.
  // With topN > 1 it randomly played second-best and missed free material.
  hard: { maxDepth: 3, budgetMs: 1200, blunderChance: 0, topN: 1 },
  // Deepest search we can afford in a browser tab without freezing it.
  advanced: { maxDepth: 5, budgetMs: 2500, blunderChance: 0, topN: 1 },
};


export interface AiMoveResult {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  /** Search depth actually reached. Useful for the HUD. */
  depth: number;
  nodes: number;
}

/**
 * Picks a move for the side currently to play.
 *
 * Uses iterative deepening so we always have a usable answer when the clock runs out.
 * Returns null only when the position is already over.
 */
export function chooseChessMove(fen: string, difficulty: ChessDifficulty): AiMoveResult | null {
  const cfg = SETTINGS[difficulty];
  const game = new Chess(fen);

  const rootMoves = game.moves({ verbose: true }) as Move[];
  if (rootMoves.length === 0) return null;

  // A "blunder": play a random legal move and skip the search entirely.
  if (cfg.blunderChance > 0 && Math.random() < cfg.blunderChance) {
    const random = rootMoves[Math.floor(Math.random() * rootMoves.length)];
    return {
      san: random.san,
      from: random.from,
      to: random.to,
      promotion: random.promotion,
      depth: 0,
      nodes: 0,
    };
  }

  const state: SearchState = {
    deadline: Date.now() + cfg.budgetMs,
    timedOut: false,
    nodes: 0,
  };

  let scored: Array<{ move: Move; score: number }> = rootMoves.map((move) => ({ move, score: 0 }));
  let reachedDepth = 0;

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    const results: Array<{ move: Move; score: number }> = [];

    // Search best-first from the previous iteration — that is what makes iterative
    // deepening faster than a single deep search, not slower.
    const ordered = [...scored].sort((a, b) => b.score - a.score).map((entry) => entry.move);

    for (const move of ordered) {
      try {
        game.move(move.san);
      } catch {
        continue;
      }
      const score = -negamax(game, depth - 1, -Infinity, Infinity, state);
      game.undo();

      if (state.timedOut) break;
      results.push({ move, score });
    }

    if (state.timedOut || results.length === 0) break;
    scored = results;
    reachedDepth = depth;
  }

  scored.sort((a, b) => b.score - a.score);

  // Choose among the top N so repeat games are not identical.
  const pool = scored.slice(0, Math.max(1, Math.min(cfg.topN, scored.length)));
  const chosen = pool[Math.floor(Math.random() * pool.length)].move;

  return {
    san: chosen.san,
    from: chosen.from,
    to: chosen.to,
    promotion: chosen.promotion,
    depth: reachedDepth,
    nodes: state.nodes,
  };
}
