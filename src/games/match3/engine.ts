/**
 * Match-3 rules engine — pure logic, zero Phaser, zero React.
 *
 * Keeping this headless means the whole ruleset can be brute-force verified in Node
 * (see scripts/verify-match3.mjs) instead of being eyeballed in a browser.
 *
 * ARCHITECTURE NOTES (researched from how the genre actually works):
 *
 *  1. NO MATCHES AT SPAWN. A fresh board must contain zero pre-made matches, otherwise
 *     the player is handed free points. We reject-and-retry per cell while filling.
 *
 *  2. A SWAP IS ONLY LEGAL IF IT MAKES A MATCH. This is the rule that makes the genre a
 *     puzzle rather than a sliding toy. Illegal swaps animate and revert.
 *
 *  3. RESOLUTION IS A LOOP, NOT A STEP. Clear -> gravity -> refill -> look again. Each
 *     iteration is a "cascade" and scores progressively more. This loop is what produces
 *     the chain-reaction feel.
 *
 *  4. DEADLOCK DETECTION IS MANDATORY. A board can reach a state with no legal swap. We
 *     detect it by trying every adjacent swap, and reshuffle when none work.
 *
 * The engine emits a STEP LIST describing what happened. The renderer replays that list
 * as animation. This separation is why the logic is testable: the engine never animates.
 */

/** Gem kinds. Six is the genre standard: enough variety, still solvable. */
export const GEM_KINDS = 6;

/** A cell is a gem kind (0..GEM_KINDS-1) or null when empty mid-resolution. */
export type Cell = number | null;

export interface Position {
  row: number;
  col: number;
}

export interface BoardSize {
  rows: number;
  cols: number;
}

/** Minimum run length that counts as a match. */
const MIN_RUN = 3;

/* ------------------------------------------------------------------------- */
/* Random source                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Injectable RNG so tests can run deterministically with a seed.
 * Returns a float in [0, 1).
 */
export type Rng = () => number;

/** Mulberry32 — small, fast, good enough distribution for a game board. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------- */
/* Board helpers                                                              */
/* ------------------------------------------------------------------------- */

export type Board = Cell[][];

export function inBounds(board: Board, row: number, col: number): boolean {
  return row >= 0 && row < board.length && col >= 0 && col < board[0].length;
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/**
 * Would placing `kind` at (row, col) complete a run of MIN_RUN going left or up?
 *
 * Used during generation. We only need to look backwards (left/up) because we fill
 * top-left to bottom-right, so cells to the right/below are not yet decided.
 */
function createsRunBackwards(board: Board, row: number, col: number, kind: number): boolean {
  // Horizontal: check the two cells to the left.
  if (
    col >= 2 &&
    board[row][col - 1] === kind &&
    board[row][col - 2] === kind
  ) {
    return true;
  }
  // Vertical: check the two cells above.
  if (
    row >= 2 &&
    board[row - 1][col] === kind &&
    board[row - 2][col] === kind
  ) {
    return true;
  }
  return false;
}

/**
 * Creates a board with NO pre-existing matches and at least one legal move.
 *
 * The "no matches" part is handled during the fill by rejecting any kind that would
 * complete a run. The "has a legal move" part is handled by reshuffling afterwards
 * if we happen to generate a dead board.
 */
export function createBoard(size: BoardSize, rng: Rng): Board {
  const board: Board = [];

  for (let row = 0; row < size.rows; row++) {
    board.push([]);
    for (let col = 0; col < size.cols; col++) {
      // Collect kinds that don't immediately form a run.
      const allowed: number[] = [];
      for (let kind = 0; kind < GEM_KINDS; kind++) {
        if (!createsRunBackwards(board, row, col, kind)) allowed.push(kind);
      }
      // `allowed` can never be empty: a run needs 2 identical neighbours, which at most
      // rules out 2 of the 6 kinds (one horizontal, one vertical).
      board[row].push(allowed[Math.floor(rng() * allowed.length)]);
    }
  }

  // Guarantee the player has something to do.
  if (findAnyLegalSwap(board) === null) {
    return reshuffle(board, rng);
  }
  return board;
}

/* ------------------------------------------------------------------------- */
/* Match detection                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Finds every matched cell on the board.
 *
 * Scans rows then columns for runs of >= MIN_RUN identical kinds. Using a Set of
 * "row,col" keys naturally handles intersecting runs (an L or T shape), where a cell
 * belongs to both a horizontal and a vertical match and must only be counted once.
 */
export function findMatches(board: Board): Position[] {
  const rows = board.length;
  const cols = board[0].length;
  const matched = new Set<string>();

  // Horizontal runs.
  for (let row = 0; row < rows; row++) {
    let runStart = 0;
    for (let col = 1; col <= cols; col++) {
      const prev = board[row][col - 1];
      const current = col < cols ? board[row][col] : null;
      // A run ends when the kind changes, we hit the wall, or the kind is null.
      if (current === null || current !== prev || prev === null) {
        const length = col - runStart;
        if (prev !== null && length >= MIN_RUN) {
          for (let k = runStart; k < col; k++) matched.add(`${row},${k}`);
        }
        runStart = col;
      }
    }
  }

  // Vertical runs.
  for (let col = 0; col < cols; col++) {
    let runStart = 0;
    for (let row = 1; row <= rows; row++) {
      const prev = board[row - 1][col];
      const current = row < rows ? board[row][col] : null;
      if (current === null || current !== prev || prev === null) {
        const length = row - runStart;
        if (prev !== null && length >= MIN_RUN) {
          for (let k = runStart; k < row; k++) matched.add(`${k},${col}`);
        }
        runStart = row;
      }
    }
  }

  return [...matched].map((key) => {
    const [row, col] = key.split(',').map(Number);
    return { row, col };
  });
}

/* ------------------------------------------------------------------------- */
/* Swapping                                                                   */
/* ------------------------------------------------------------------------- */

export function areAdjacent(a: Position, b: Position): boolean {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  // Exactly one step, orthogonally. No diagonals.
  return dr + dc === 1;
}

/** Swaps two cells IN PLACE. Callers that need the original must clone first. */
function swapInPlace(board: Board, a: Position, b: Position): void {
  const temp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = temp;
}

/**
 * Is swapping these two cells legal? Legal means adjacent AND it produces a match.
 */
export function isLegalSwap(board: Board, a: Position, b: Position): boolean {
  if (!inBounds(board, a.row, a.col) || !inBounds(board, b.row, b.col)) return false;
  if (!areAdjacent(a, b)) return false;

  // Try it on a scratch copy — never mutate the caller's board while testing.
  const probe = cloneBoard(board);
  swapInPlace(probe, a, b);
  return findMatches(probe).length > 0;
}

/**
 * Finds one legal swap, or null if the board is deadlocked.
 *
 * Only tests right and down neighbours: every adjacent pair is covered exactly once
 * this way, so we do half the work of testing all four directions.
 */
export function findAnyLegalSwap(board: Board): [Position, Position] | null {
  const rows = board.length;
  const cols = board[0].length;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const here = { row, col };
      if (col + 1 < cols) {
        const right = { row, col: col + 1 };
        if (isLegalSwap(board, here, right)) return [here, right];
      }
      if (row + 1 < rows) {
        const down = { row: row + 1, col };
        if (isLegalSwap(board, here, down)) return [here, down];
      }
    }
  }
  return null;
}

/** Counts all legal swaps. Used by the HUD hint counter and by tests. */
export function countLegalSwaps(board: Board): number {
  const rows = board.length;
  const cols = board[0].length;
  let count = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (col + 1 < cols && isLegalSwap(board, { row, col }, { row, col: col + 1 })) count++;
      if (row + 1 < rows && isLegalSwap(board, { row, col }, { row: row + 1, col })) count++;
    }
  }
  return count;
}

/* ------------------------------------------------------------------------- */
/* Gravity + refill                                                           */
/* ------------------------------------------------------------------------- */

/** One gem's fall, so the renderer can tween it from its old row to its new one. */
export interface FallMove {
  col: number;
  fromRow: number;
  toRow: number;
  kind: number;
}

/** A gem spawned above the board and dropped in. */
export interface SpawnMove {
  col: number;
  toRow: number;
  kind: number;
  /** How far above the top edge it starts, in cells. Drives stagger in the animation. */
  offset: number;
}

export interface GravityResult {
  falls: FallMove[];
  spawns: SpawnMove[];
}

/**
 * Applies gravity, then refills from the top. MUTATES `board`.
 *
 * Per column, walk bottom-up with a write cursor. Every gem found is compacted down to
 * the cursor; the gap left at the top is filled with new random gems. This is O(cells)
 * and reproduces the "column collapses, new gems rain in" behaviour of the genre.
 */
export function applyGravity(board: Board, rng: Rng): GravityResult {
  const rows = board.length;
  const cols = board[0].length;
  const falls: FallMove[] = [];
  const spawns: SpawnMove[] = [];

  for (let col = 0; col < cols; col++) {
    let writeRow = rows - 1;

    // Compact existing gems downwards.
    for (let readRow = rows - 1; readRow >= 0; readRow--) {
      const kind = board[readRow][col];
      if (kind === null) continue;


      if (readRow !== writeRow) {
        board[writeRow][col] = kind;
        board[readRow][col] = null;
        falls.push({ col, fromRow: readRow, toRow: writeRow, kind });
      }
      writeRow--;
    }

    // Everything at or above writeRow is now empty — refill it.
    // `offset` counts upward from the top edge so the renderer can stagger the drop.
    let offset = 1;
    for (let row = writeRow; row >= 0; row--) {
      const kind = Math.floor(rng() * GEM_KINDS);
      board[row][col] = kind;
      spawns.push({ col, toRow: row, kind, offset });
      offset++;
    }
  }

  return { falls, spawns };
}

/* ------------------------------------------------------------------------- */
/* Reshuffle                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Rebuilds the board from its existing gems when no legal move remains.
 *
 * Preserving the multiset of gems (rather than generating fresh ones) is the fair
 * approach — the player keeps the same material, just rearranged.
 *
 * We retry a bounded number of times, then fall back to generating a guaranteed-good
 * board so this can never loop forever.
 */
export function reshuffle(board: Board, rng: Rng): Board {
  const rows = board.length;
  const cols = board[0].length;

  const gems: number[] = [];
  for (const row of board) {
    for (const cell of row) {
      if (cell !== null) gems.push(cell);
    }
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    // Fisher-Yates.
    for (let i = gems.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [gems[i], gems[j]] = [gems[j], gems[i]];
    }

    const candidate: Board = [];
    let index = 0;
    for (let row = 0; row < rows; row++) {
      candidate.push([]);
      for (let col = 0; col < cols; col++) {
        candidate[row].push(gems[index++]);
      }
    }

    // A good shuffle has no free matches but does have a move available.
    if (findMatches(candidate).length === 0 && findAnyLegalSwap(candidate) !== null) {
      return candidate;
    }
  }

  // Extremely unlikely fallback: build a fresh valid board of the same size.
  return createBoard({ rows, cols }, rng);
}

/* ------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Score for clearing `count` gems on cascade level `cascade` (1 = the player's own swap).
 *
 * Design intent:
 *   - Base 60 per gem, so a plain 3-match is a readable 180.
 *   - Longer runs pay a bonus per extra gem, rewarding 4s and 5s.
 *   - Cascades multiply by 1.6^(cascade-1), so chain reactions are where big scores live.
 */
export function scoreFor(count: number, cascade: number): number {
  const base = count * 60;
  const lengthBonus = Math.max(0, count - MIN_RUN) * 45;
  const multiplier = Math.pow(1.6, cascade - 1);
  return Math.round((base + lengthBonus) * multiplier);
}

/* ------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* ------------------------------------------------------------------------- */

/** One cascade iteration, in the order the renderer should animate it. */
export interface CascadeStep {
  /** 1 for the player's swap, 2+ for chain reactions. */
  cascade: number;
  cleared: Position[];
  gained: number;
  falls: FallMove[];
  spawns: SpawnMove[];
}

export interface ResolveResult {
  steps: CascadeStep[];
  totalGained: number;
  /** Highest cascade reached. 1 = no chain, 3 = two chain reactions, etc. */
  maxCascade: number;
  /** True if the board deadlocked afterwards and had to be reshuffled. */
  didReshuffle: boolean;
}

/**
 * Runs the full clear -> gravity -> refill loop until the board is stable.
 * MUTATES `board` into its final settled state.
 *
 * The returned step list is the animation script. The renderer walks it in order;
 * the engine itself has already finished all the work.
 */
export function resolveBoard(board: Board, rng: Rng): ResolveResult {
  const steps: CascadeStep[] = [];
  let cascade = 1;
  let totalGained = 0;

  for (;;) {
    const cleared = findMatches(board);
    if (cleared.length === 0) break;

    const gained = scoreFor(cleared.length, cascade);
    totalGained += gained;

    for (const { row, col } of cleared) board[row][col] = null;

    const { falls, spawns } = applyGravity(board, rng);

    steps.push({ cascade, cleared, gained, falls, spawns });
    cascade++;

    // Safety valve. A correct engine settles in a handful of cascades; this stops a
    // pathological RNG streak from hanging the tab.
    if (cascade > 100) break;
  }

  // The refill can leave the board with no legal move — fix that before handing back.
  let didReshuffle = false;
  if (findAnyLegalSwap(board) === null) {
    const shuffled = reshuffle(board, rng);
    for (let row = 0; row < board.length; row++) {
      for (let col = 0; col < board[0].length; col++) {
        board[row][col] = shuffled[row][col];
      }
    }
    didReshuffle = true;
  }

  return {
    steps,
    totalGained,
    maxCascade: steps.length === 0 ? 0 : steps[steps.length - 1].cascade,
    didReshuffle,
  };
}

/**
 * Performs a player swap. Returns null if the swap is illegal (caller should animate
 * a bounce-back). On success `board` is mutated to its settled state.
 */
export function trySwap(
  board: Board,
  a: Position,
  b: Position,
  rng: Rng,
): ResolveResult | null {
  if (!isLegalSwap(board, a, b)) return null;
  swapInPlace(board, a, b);
  return resolveBoard(board, rng);
}
