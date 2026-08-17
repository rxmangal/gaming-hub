/**
 * Match-3 engine verification.
 *
 * The genre has hard invariants that are easy to get subtly wrong and hard to spot by
 * eye in a browser. This script hammers the engine across thousands of random seeds and
 * asserts each invariant explicitly.
 *
 * Invariants checked:
 *   1. A fresh board NEVER contains a pre-made match (no free points at spawn).
 *   2. A fresh board ALWAYS has at least one legal move (never dead on arrival).
 *   3. An illegal swap is rejected (trySwap returns null) and leaves the board untouched.
 *   4. A legal swap always clears >= 3 gems and always scores > 0.
 *   5. After ANY resolution the board is full (no null holes left behind).
 *   6. After ANY resolution the board is stable (no unclaimed matches sitting there).
 *   7. After ANY resolution a legal move exists (reshuffling when it doesn't).
 *   8. Gravity conserves gems: nothing is duplicated or lost.
 *   9. Cascade scoring is strictly progressive (deeper chains pay more).
 *  10. A long random play session never throws and never stalls.
 *
 * Run: node scripts/verify-match3.mjs
 */

// Compiled by `npm run verify:ai` (tsc mirrors the src/games/* folder structure).
import {
  applyGravity,
  cloneBoard,
  countLegalSwaps,
  createBoard,
  findAnyLegalSwap,
  findMatches,
  isLegalSwap,
  makeRng,
  scoreFor,
  trySwap,
} from '../.verify/match3/engine.js';

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return pass;
};

const SIZE = { rows: 8, cols: 8 };

/** True if no cell is null. */
const isFull = (board) => board.every((row) => row.every((cell) => cell !== null));

/** Sorted census of gem kinds, for conservation checks. */
const census = (board) => {
  const counts = {};
  for (const row of board) {
    for (const cell of row) {
      if (cell !== null) counts[cell] = (counts[cell] ?? 0) + 1;
    }
  }
  return counts;
};

/* ---------------------------------------------------------------- */
/* 1 + 2. Fresh board invariants, over many seeds.                   */
/* ---------------------------------------------------------------- */
{
  const BOARDS = 3000;
  let cleanSpawn = 0;
  let hasMove = 0;

  for (let seed = 1; seed <= BOARDS; seed++) {
    const board = createBoard(SIZE, makeRng(seed));
    if (findMatches(board).length === 0) cleanSpawn++;
    if (findAnyLegalSwap(board) !== null) hasMove++;
  }

  check('fresh board has no pre-made match', cleanSpawn === BOARDS, `${cleanSpawn}/${BOARDS}`);
  check('fresh board has a legal move', hasMove === BOARDS, `${hasMove}/${BOARDS}`);
  console.log(`PASS  ${BOARDS} fresh boards: all clean, all playable`);
}

/* ---------------------------------------------------------------- */
/* 3. Illegal swaps are rejected and are side-effect free.           */
/* ---------------------------------------------------------------- */
{
  let tested = 0;
  let rejected = 0;
  let unchanged = 0;

  for (let seed = 1; seed <= 400; seed++) {
    const rng = makeRng(seed);
    const board = createBoard(SIZE, rng);

    // Find an adjacent pair that is NOT a legal swap.
    outer: for (let row = 0; row < SIZE.rows; row++) {
      for (let col = 0; col < SIZE.cols - 1; col++) {
        const a = { row, col };
        const b = { row, col: col + 1 };
        if (!isLegalSwap(board, a, b)) {
          const before = JSON.stringify(board);
          const result = trySwap(board, a, b, rng);
          tested++;
          if (result === null) rejected++;
          if (JSON.stringify(board) === before) unchanged++;
          break outer;
        }
      }
    }
  }

  check('illegal swap returns null', tested > 0 && rejected === tested, `${rejected}/${tested}`);
  check('illegal swap does not mutate board', unchanged === tested, `${unchanged}/${tested}`);
  console.log(`PASS  ${tested} illegal swaps rejected without side effects`);
}

/* ---------------------------------------------------------------- */
/* 4-8. Legal swaps: scoring, fullness, stability, conservation.     */
/* ---------------------------------------------------------------- */
{
  let swaps = 0;
  let scoredPositive = 0;
  let clearedEnough = 0;
  let endedFull = 0;
  let endedStable = 0;
  let endedPlayable = 0;

  for (let seed = 1; seed <= 600; seed++) {
    const rng = makeRng(seed * 7919);
    const board = createBoard(SIZE, rng);

    const move = findAnyLegalSwap(board);
    if (!move) continue;

    const result = trySwap(board, move[0], move[1], rng);
    if (!result) continue;

    swaps++;
    if (result.totalGained > 0) scoredPositive++;
    // The first cascade is the player's own swap; it must clear at least 3.
    if (result.steps[0] && result.steps[0].cleared.length >= 3) clearedEnough++;
    if (isFull(board)) endedFull++;
    if (findMatches(board).length === 0) endedStable++;
    if (findAnyLegalSwap(board) !== null) endedPlayable++;
  }

  check('legal swap always scores', scoredPositive === swaps, `${scoredPositive}/${swaps}`);
  check('legal swap clears >= 3 gems', clearedEnough === swaps, `${clearedEnough}/${swaps}`);
  check('board is full after resolution', endedFull === swaps, `${endedFull}/${swaps}`);
  check('board is stable after resolution', endedStable === swaps, `${endedStable}/${swaps}`);
  check('board is playable after resolution', endedPlayable === swaps, `${endedPlayable}/${swaps}`);
  console.log(`PASS  ${swaps} legal swaps: scored, full, stable, playable`);
}

/* ---------------------------------------------------------------- */
/* 8. Gravity conserves surviving gems.                              */
/* ---------------------------------------------------------------- */
{
  let tested = 0;
  let conserved = 0;

  for (let seed = 1; seed <= 300; seed++) {
    const rng = makeRng(seed * 31);
    const board = createBoard(SIZE, rng);

    // Punch a hole: clear a random column segment.
    const col = Math.floor(rng() * SIZE.cols);
    const survivors = [];
    for (let row = 0; row < SIZE.rows; row++) {
      if (row >= 3 && row <= 5) {
        board[row][col] = null;
      } else {
        survivors.push(board[row][col]);
      }
    }

    applyGravity(board, rng);
    tested++;

    // Every survivor must still be present in that column, in the same relative order.
    const after = [];
    for (let row = 0; row < SIZE.rows; row++) after.push(board[row][col]);
    const tail = after.slice(SIZE.rows - survivors.length);
    if (JSON.stringify(tail) === JSON.stringify(survivors)) conserved++;
  }

  check('gravity preserves surviving gems and their order', conserved === tested, `${conserved}/${tested}`);
  console.log(`PASS  gravity conserved gems across ${tested} punched columns`);
}

/* ---------------------------------------------------------------- */
/* 9. Cascade scoring is progressive.                                */
/* ---------------------------------------------------------------- */
{
  const three1 = scoreFor(3, 1);
  const three2 = scoreFor(3, 2);
  const three3 = scoreFor(3, 3);
  const four1 = scoreFor(4, 1);
  const five1 = scoreFor(5, 1);

  check('deeper cascades score more', three1 < three2 && three2 < three3, `${three1} < ${three2} < ${three3}`);
  check('longer runs score more', three1 < four1 && four1 < five1, `${three1} < ${four1} < ${five1}`);
  console.log(
    `PASS  scoring: 3-match=${three1}, 4-match=${four1}, 5-match=${five1}, ` +
      `cascade x2=${three2}, x3=${three3}`,
  );
}

/* ---------------------------------------------------------------- */
/* 10. Long random session: no throws, no stalls.                    */
/* ---------------------------------------------------------------- */
{
  const MOVES = 4000;
  let played = 0;
  let totalScore = 0;
  let reshuffles = 0;
  let bestCascade = 0;
  let cascadesSeen = 0;
  let error = null;

  const rng = makeRng(20260817);
  let board = createBoard(SIZE, rng);

  try {
    for (let i = 0; i < MOVES; i++) {
      const move = findAnyLegalSwap(board);
      // Invariant 7 guarantees this is never null.
      if (!move) {
        error = `board deadlocked at move ${i}`;
        break;
      }
      const result = trySwap(board, move[0], move[1], rng);
      if (!result) {
        error = `findAnyLegalSwap returned an illegal swap at move ${i}`;
        break;
      }
      played++;
      totalScore += result.totalGained;
      if (result.didReshuffle) reshuffles++;
      if (result.maxCascade > bestCascade) bestCascade = result.maxCascade;
      if (result.maxCascade > 1) cascadesSeen++;

      if (!isFull(board)) {
        error = `board had holes after move ${i}`;
        break;
      }
      if (findMatches(board).length > 0) {
        error = `board left unclaimed matches after move ${i}`;
        break;
      }
    }
  } catch (err) {
    error = err.message;
  }

  check('long session runs clean', error === null && played === MOVES, error ?? `${played}/${MOVES}`);
  // Chain reactions are the heart of the genre — if none ever happen, something is wrong.
  check('chain reactions occur', cascadesSeen > 0, `${cascadesSeen} moves cascaded`);
  console.log(
    `PASS  ${played} auto-played moves: score ${totalScore.toLocaleString()}, ` +
      `${cascadesSeen} cascading moves, deepest chain ${bestCascade}, ${reshuffles} reshuffles`,
  );
}

/* ---------------------------------------------------------------- */
/* Reshuffle recovery: force a dead board and confirm recovery.       */
/* ---------------------------------------------------------------- */
{
  // A genuinely deadlocked board: diagonal stripes of three kinds.
  //
  // NOTE: my first attempt here used a 2-colour checkerboard, assuming it was dead.
  // The test failed and the engine was right — swapping two cells vertically in a
  // checkerboard yields TWO rows of three at once. Diagonal stripes are the real
  // deadlock: every swap only ever produces an unmatched pair.
  const dead = [
    [0, 1, 2, 0, 1, 2],
    [1, 2, 0, 1, 2, 0],
    [2, 0, 1, 2, 0, 1],
    [0, 1, 2, 0, 1, 2],
    [1, 2, 0, 1, 2, 0],
    [2, 0, 1, 2, 0, 1],
  ];
  check('stripe board is genuinely deadlocked', findAnyLegalSwap(dead) === null);
  check('stripe board has no matches', findMatches(dead).length === 0);


  // resolveBoard must notice the deadlock and reshuffle it into a playable state.
  const rng = makeRng(99);
  const board = cloneBoard(dead);
  const before = census(board);
  // trySwap can't be used (no legal swap), so drive resolution directly.
  const { resolveBoard } = await import('../.verify/match3/engine.js');
  const result = resolveBoard(board, rng);

  check('deadlock triggers reshuffle', result.didReshuffle === true);
  check('reshuffled board is playable', findAnyLegalSwap(board) !== null);
  check('reshuffle preserves gem census', JSON.stringify(census(board)) === JSON.stringify(before));
  console.log(
    `PASS  deadlock recovered: reshuffled to ${countLegalSwaps(board)} legal moves, gems preserved`,
  );
}

console.log('');
if (failures > 0) {
  console.error(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('RESULT: all Match-3 engine checks PASSED');
