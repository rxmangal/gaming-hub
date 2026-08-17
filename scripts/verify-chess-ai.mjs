/**
 * Sanity checks for the chess AI.
 *
 *  1. Mate-in-one must be found by hard + advanced.
 *  2. A free queen capture must be taken by hard + advanced.
 *  3. Advanced must not exceed its time budget (UI responsiveness).
 *  4. A full advanced-vs-normal game must terminate legally.
 *  5. Advanced should beat Normal over several games (difficulty ordering is real).
 *
 * Run: node scripts/verify-chess-ai.mjs
 */
import { Chess } from 'chess.js';
// Compiled by `npm run verify:ai` (tsc mirrors the src/games/* folder structure).
import { chooseChessMove } from '../.verify/chess/ai.js';



let failures = 0;
const check = (label, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

/* 1. Mate in one: white queen to h7 / classic back-rank. */
{
  // White to move, Qh5xh7# is mate (simple smothered pattern set up for the test).
  const fen = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1'; // Re8# back-rank mate
  for (const level of ['hard', 'advanced']) {
    const result = chooseChessMove(fen, level);
    const game = new Chess(fen);
    game.move(result.san);
    check(`mate-in-one found (${level})`, game.isCheckmate(), `played ${result.san}`);
  }
}

/* 2. Free material: an undefended queen must be captured. */
{
  // Black queen on d5 is completely undefended; white knight on c3 can take it.
  const fen = 'rnb1kbnr/pppp1ppp/8/3q4/8/2N5/PPPPPPPP/R1BQKBNR w kq - 0 1';
  for (const level of ['hard', 'advanced']) {
    const result = chooseChessMove(fen, level);
    check(
      `captures free queen (${level})`,
      result.san.includes('xd5'),
      `played ${result.san}`,
    );
  }
}

/* 3. Time budget: advanced is capped at 2000ms; allow generous overhead. */
{
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1';
  const started = Date.now();
  const result = chooseChessMove(fen, 'advanced');
  const elapsed = Date.now() - started;
  check(
    'advanced respects time budget (<4s)',
    elapsed < 4000,
    `${elapsed}ms, depth ${result.depth}, ${result.nodes.toLocaleString()} nodes`,
  );
}

/* 4. Full game terminates legally. */
{
  const game = new Chess();
  let plies = 0;
  while (!game.isGameOver() && plies < 240) {
    const level = game.turn() === 'w' ? 'advanced' : 'normal';
    const result = chooseChessMove(game.fen(), level);
    if (!result) break;
    try {
      game.move(result.san);
    } catch (err) {
      check('full game legality', false, `illegal move ${result.san}: ${err.message}`);
      break;
    }
    plies++;
  }
  const terminal = game.isGameOver() || plies >= 240;
  check(
    'full game runs to completion',
    terminal,
    `${plies} plies, ${
      game.isCheckmate()
        ? 'checkmate'
        : game.isStalemate()
          ? 'stalemate'
          : game.isDraw()
            ? 'draw'
            : 'ply cap'
    }`,
  );
}

/* 5. Difficulty ordering: advanced should dominate normal. */
{
  let advancedScore = 0;
  const GAMES = 4;
  for (let i = 0; i < GAMES; i++) {
    const game = new Chess();
    // Alternate colours so neither side gets a first-move advantage across the set.
    const advancedIsWhite = i % 2 === 0;
    let plies = 0;
    while (!game.isGameOver() && plies < 160) {
      const advancedTurn = (game.turn() === 'w') === advancedIsWhite;
      const result = chooseChessMove(game.fen(), advancedTurn ? 'advanced' : 'normal');
      if (!result) break;
      try {
        game.move(result.san);
      } catch {
        break;
      }
      plies++;
    }
    if (game.isCheckmate()) {
      // The side to move is the one that got mated.
      const loserIsWhite = game.turn() === 'w';
      const advancedLost = loserIsWhite === advancedIsWhite;
      advancedScore += advancedLost ? 0 : 1;
    } else {
      advancedScore += 0.5; // draw / cap
    }
  }
  check(
    'advanced >= normal over 4 games',
    advancedScore >= GAMES / 2,
    `advanced scored ${advancedScore}/${GAMES}`,
  );
}

console.log('');
if (failures > 0) {
  console.error(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('RESULT: all chess AI checks PASSED');
