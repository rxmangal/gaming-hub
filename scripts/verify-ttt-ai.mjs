/**
 * Exhaustive verification that the `advanced` Tic-Tac-Toe AI is unbeatable.
 *
 * Strategy: play the AI against a PERFECT opponent that explores every possible
 * human move (full game-tree search). If any leaf exists where the human wins,
 * the AI is not unbeatable and this script fails.
 *
 * Run:  node scripts/verify-ttt-ai.mjs
 */
// Compiled by `npm run verify:ai` (tsc mirrors the src/games/* folder structure).
import { chooseAiMove, evaluate, legalMoves, other } from '../.verify/tictactoe/engine.js';


let humanWins = 0;
let aiWins = 0;
let draws = 0;
let positions = 0;

/**
 * Recursively explores EVERY human move. The AI replies with its own logic.
 * `advanced` is deterministic apart from random tie-breaking between equally
 * optimal moves, so we explore all of its top-scoring replies too.
 */
function explore(board, humanMark, aiMark, turn) {
  positions++;
  const { winner, isDraw } = evaluate(board);
  if (winner === humanMark) {
    humanWins++;
    console.error('FAILURE — human won with board:', board.join('|'));
    return;
  }
  if (winner === aiMark) {
    aiWins++;
    return;
  }
  if (isDraw) {
    draws++;
    return;
  }

  if (turn === humanMark) {
    // Try every human option.
    for (const move of legalMoves(board)) {
      board[move] = humanMark;
      explore(board, humanMark, aiMark, aiMark);
      board[move] = null;
    }
    return;
  }

  // AI's turn. Sample its choice many times so random tie-breaks are all covered.
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const move = chooseAiMove([...board], aiMark, 'advanced');
    if (move === null) break;
    seen.add(move);
  }
  for (const move of seen) {
    board[move] = aiMark;
    explore(board, humanMark, aiMark, humanMark);
    board[move] = null;
  }
}

const empty = () => Array(9).fill(null);

console.log('Case 1: AI plays second (human is X, moves first) ...');
explore(empty(), 'X', 'O', 'X');

console.log('Case 2: AI plays first (AI is X) ...');
explore(empty(), 'O', 'X', 'X');

console.log('');
console.log('positions explored :', positions.toLocaleString());
console.log('AI wins            :', aiWins.toLocaleString());
console.log('draws              :', draws.toLocaleString());
console.log('HUMAN WINS         :', humanWins);
console.log('');

if (humanWins > 0) {
  console.error('RESULT: FAIL — advanced AI is beatable.');
  process.exit(1);
}
console.log('RESULT: PASS — advanced AI is unbeatable (human can never win).');
