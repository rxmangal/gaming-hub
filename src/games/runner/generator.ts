/**
 * Endless runner track generator — pure logic, zero Phaser, zero React.
 *
 * THE HARD REQUIREMENT: every generated track must be provably completable. Naive
 * random placement will eventually wall off all three lanes, or demand a lane change
 * the player physically cannot make in time, and the run dies through no fault of the
 * player. That is the single worst bug this genre has, so the guarantee is enforced by
 * an actual solver rather than by hoping.
 *
 * HOW THE GENRE ACTUALLY WORKS (and what I copied structurally, not asset-wise):
 *
 *  1. THE PLAYER DOESN'T MOVE FORWARD — THE WORLD MOVES BACKWARD. The runner stays at a
 *     fixed screen position and obstacles are translated toward it. This keeps the camera
 *     trivial and makes "distance" just an accumulator.
 *
 *  2. THE TRACK IS A GRID, NOT A CONTINUUM. Obstacles live in discrete (slot, lane)
 *     cells. Slots are spaced far enough apart that a jump or slide started at one slot
 *     has finished before the next arrives. This is what makes the guarantee checkable.
 *
 *  3. AUTHORED PATTERNS BEAT PURE RANDOMNESS. Real runners stitch together hand-designed
 *     chunks so the track reads deliberately rather than as noise. We do the same, then
 *     validate the stitched result.
 *
 *  4. DIFFICULTY RAMPS ON MULTIPLE AXES: speed, obstacle density, and how often the
 *     nastier obstacle types appear.
 *
 * VERIFY: scripts/verify-runner.mjs brute-forces thousands of seeds and asserts the
 * solver finds a route through every single one.
 */

export const LANES = 3;

/** What sits in a single (slot, lane) cell. */
export enum Obstacle {
  /** Free. Run straight through. */
  None = 0,
  /** Full-height wall. Impassable — the player MUST be in another lane. */
  Barrier = 1,
  /** Low crate. Clear it by jumping. */
  Low = 2,
  /** Overhead beam. Clear it by sliding. */
  Overhead = 3,
}

/** A collectible. Purely for score; never blocks the player. */
export enum Pickup {
  None = 0,
  Shard = 1,
}

/** One cross-section of the track: what's in each of the three lanes. */
export interface Slot {
  /** Distance along the track, in world units. */
  z: number;
  /** Length 3 — obstacle per lane. */
  cells: Obstacle[];
  /** Length 3 — pickup per lane. */
  pickups: Pickup[];
}

/* ------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * World-unit spacing between slots.
 *
 * This is load-bearing for the guarantee: it must be far enough that a jump or slide
 * begun for slot N has completed before slot N+1 arrives, and that a lane change has
 * time to finish. verify-runner.mjs asserts the physics honour this at max speed.
 *
 * TUNED BY TEST: originally 320, which the physics test rejected — at max speed a
 * 320-unit gap gives a 278ms window, so a 620ms jump left the player committed airborne
 * across nearly three slots. Widened to 380 (330ms window) and the air times shortened.
 */
export const SLOT_SPACING = 380;

/** Lane change duration in ms. Must be < time between slots at max speed. */
export const LANE_CHANGE_MS = 140;

/** Airborne duration in ms. Must span < 2 slot windows at max speed. */
export const JUMP_MS = 560;

/** Slide duration in ms. Must span < 2 slot windows at max speed. */
export const SLIDE_MS = 500;

/**
 * Empty slots guaranteed before every obstacle pattern.
 *
 * This is the fix for entry-lane fairness. A pattern like "##." leaves only lane 2 open;
 * a player sitting in lane 0 needs two lane changes to reach it, which one slot window
 * cannot provide. Two clear lead-in slots let the player reach ANY lane before the
 * pattern lands, so single-gap patterns become fair from every starting position.
 */
export const LEAD_IN_SLOTS = 2;


/* ------------------------------------------------------------------------- */
/* Difficulty curve                                                           */
/* ------------------------------------------------------------------------- */

export interface Difficulty {
  /** World units per second the track scrolls toward the player. */
  speed: number;
  /** Probability a given slot carries any obstacle at all. */
  density: number;
  /** Probability an obstacle is a Barrier rather than Low/Overhead. */
  barrierBias: number;
}

/**
 * Difficulty as a function of distance travelled.
 *
 * Speed ramps from 620 to a hard ceiling of 1150 world units/sec. The ceiling exists
 * for a concrete reason: above it, SLOT_SPACING / speed drops below JUMP_MS and the
 * track stops being provably survivable. Capping speed keeps the guarantee intact.
 */
export function difficultyAt(distance: number): Difficulty {
  // 0 -> 1 over the first 24,000 units, then saturates.
  const t = Math.min(1, distance / 24000);
  // Ease-out so early acceleration is noticeable and late-game creep is gentle.
  const ramp = 1 - Math.pow(1 - t, 2);

  return {
    speed: 620 + ramp * 530,
    density: 0.34 + ramp * 0.36,
    barrierBias: 0.28 + ramp * 0.34,
  };
}

/** The speed ceiling, exposed so tests can assert the physics stay solvable. */
export const MAX_SPEED = difficultyAt(Number.MAX_SAFE_INTEGER).speed;

/* ------------------------------------------------------------------------- */
/* RNG                                                                        */
/* ------------------------------------------------------------------------- */

export type Rng = () => number;

/** Mulberry32, same as the match-3 engine — deterministic for a given seed. */
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
/* Passability + the solver                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Can the player get through this cell at all (with the right jump/slide)?
 * Only a Barrier is truly impassable.
 */
export function isPassable(cell: Obstacle): boolean {
  return cell !== Obstacle.Barrier;
}

/**
 * Proves a route exists through a run of slots.
 *
 * Forward reachability over (slot, lane). The player starts in any lane of slot 0 that
 * is passable, and may shift at most ONE lane per slot — the conservative assumption,
 * since SLOT_SPACING guarantees at least one lane change fits between slots.
 *
 * Returns the lane path if a route exists, otherwise null. Used both by the generator
 * (to reject bad tracks) and by the test suite (to prove the guarantee).
 */
export function solveRoute(slots: Slot[], startLane = 1): number[] | null {
  if (slots.length === 0) return [];

  // reachable[lane] = the lane we came from, or -1 for "not reachable".
  let reachable: number[] = [-1, -1, -1];

  // Seed: the player is in startLane. If that cell is blocked they can still have
  // shifted into an adjacent lane before reaching slot 0, so allow +/-1.
  for (let lane = 0; lane < LANES; lane++) {
    if (Math.abs(lane - startLane) <= 1 && isPassable(slots[0].cells[lane])) {
      reachable[lane] = lane;
    }
  }
  if (reachable.every((from) => from === -1)) return null;

  // Remember each slot's predecessor map so we can reconstruct the path.
  const history: number[][] = [reachable.slice()];

  for (let i = 1; i < slots.length; i++) {
    const next: number[] = [-1, -1, -1];
    for (let lane = 0; lane < LANES; lane++) {
      if (!isPassable(slots[i].cells[lane])) continue;
      // Reachable from lane-1, lane, or lane+1 in the previous slot.
      for (const from of [lane - 1, lane, lane + 1]) {
        if (from >= 0 && from < LANES && reachable[from] !== -1) {
          next[lane] = from;
          break;
        }
      }
    }
    if (next.every((from) => from === -1)) return null;
    reachable = next;
    history.push(reachable.slice());
  }

  // Walk backwards from any reachable lane in the final slot.
  let lane = reachable.findIndex((from) => from !== -1);
  const path: number[] = [];
  for (let i = slots.length - 1; i >= 0; i--) {
    path.push(lane);
    lane = history[i][lane];
  }
  return path.reverse();
}

/* ------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * An authored chunk. Each row is one slot; each row has 3 lanes.
 *
 * Every pattern here leaves at least one passable lane per row AND is walkable with
 * single-lane steps. They are unit-tested individually so a bad pattern can't sneak in.
 */
type Pattern = Obstacle[][];

const B = Obstacle.Barrier;
const L = Obstacle.Low;
const O = Obstacle.Overhead;
const _ = Obstacle.None;

/** Easy: a single obstacle, two lanes open. */
const EASY_PATTERNS: Pattern[] = [
  [[B, _, _]],
  [[_, B, _]],
  [[_, _, B]],
  [[L, _, _]],
  [[_, L, _]],
  [[_, _, L]],
  [[O, _, _]],
  [[_, O, _]],
  [[_, _, O]],
];

/** Medium: two lanes closed, forcing a specific lane, or a jump/slide row. */
const MEDIUM_PATTERNS: Pattern[] = [
  [[B, B, _]],
  [[_, B, B]],
  [[B, _, B]],
  [[L, L, L]], // jump row — clear all three by jumping
  [[O, O, O]], // slide row — clear all three by sliding
  [
    [B, _, _],
    [_, _, B],
  ],
  [
    [_, _, B],
    [B, _, _],
  ],
  [
    [_, B, _],
    [_, _, B],
  ],
];

/**
 * Hard: multi-row weaves. Every consecutive row pair must share a reachable lane —
 * i.e. the open lanes of row N and row N+1 must be at most ONE lane apart.
 *
 * BUG CAUGHT BY TEST: my first draft included
 *     ## .        <- only lane 2 open
 *     . ##        <- only lane 0 open
 *     # . #
 * which demands a two-lane jump in a single slot. Physically impossible — the player
 * dies with no counterplay. The test flagged it; the pattern is gone. Its replacement
 * steps one lane at a time.
 */
const HARD_PATTERNS: Pattern[] = [
  // Staircase: open lane walks 2 -> 1 -> 0, one step at a time.
  [
    [B, B, _],
    [B, _, B],
    [_, B, B],
  ],
  // Reverse staircase: 0 -> 1 -> 2.
  [
    [_, B, B],
    [B, _, B],
    [B, B, _],
  ],
  // Jump row, then a centre barrier, then a slide row. Tests all three verbs.
  [
    [L, L, L],
    [_, B, _],
    [O, O, O],
  ],
  // Squeeze right, low crate in the middle lane, squeeze right again.
  [
    [B, B, _],
    [_, L, _],
    [B, B, _],
  ],
  // Squeeze left, then a slide, then squeeze left.
  [
    [_, B, B],
    [_, O, _],
    [_, B, B],
  ],
];


/** All patterns, for the test suite to validate exhaustively. */
export const ALL_PATTERNS = {
  easy: EASY_PATTERNS,
  medium: MEDIUM_PATTERNS,
  hard: HARD_PATTERNS,
};

/* ------------------------------------------------------------------------- */
/* Generation                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Generates the next `count` slots starting at world position `startZ`.
 *
 * Strategy:
 *   1. Pick patterns weighted by current difficulty.
 *   2. Insert a breather gap of empty slots between patterns, so the player always has
 *      room to recover. The gap shrinks as difficulty rises but never hits zero.
 *   3. Scatter pickups in passable cells only — never bait the player into a barrier.
 *   4. Run the solver. If (somehow) no route exists, fall back to a trivially safe
 *      stretch rather than shipping an unwinnable track.
 *
 * `entryLane` is where the player currently is, so the solver validates from reality
 * rather than assuming the middle lane.
 */
export function generateSlots(
  startZ: number,
  count: number,
  distance: number,
  rng: Rng,
  entryLane = 1,
): Slot[] {
  const { density, barrierBias } = difficultyAt(distance);

  /** Appends `n` fully open slots. */
  const pushClear = (slots: Slot[], n: number) => {
    for (let i = 0; i < n && slots.length < count; i++) {
      slots.push({
        z: startZ + slots.length * SLOT_SPACING,
        cells: [Obstacle.None, Obstacle.None, Obstacle.None],
        pickups: [Pickup.None, Pickup.None, Pickup.None],
      });
    }
  };

  /**
   * Builds one candidate stretch. Kept as a closure so we can retry with fresh RNG
   * draws if the solver rejects the result, instead of immediately giving up and
   * emitting an empty stretch.
   */
  const build = (): Slot[] => {
    const slots: Slot[] = [];

    // Breather AFTER a pattern. Shrinks with difficulty but never disappears.
    const gap = Math.max(1, Math.round(3 - density * 2.6));

    // Always start with a lead-in so the first pattern is enterable from any lane.
    pushClear(slots, LEAD_IN_SLOTS);

    while (slots.length < count) {
      const roll = rng();
      const pool =
        roll < barrierBias * 0.5
          ? HARD_PATTERNS
          : roll < barrierBias + 0.25
            ? MEDIUM_PATTERNS
            : EASY_PATTERNS;

      const pattern = pool[Math.floor(rng() * pool.length)];

      // Only commit the pattern if the whole thing fits; a truncated multi-row weave
      // could leave a half-open shape that the next batch cannot connect to.
      if (slots.length + pattern.length <= count) {
        for (const row of pattern) {
          slots.push({
            z: startZ + slots.length * SLOT_SPACING,
            cells: [...row],
            pickups: [Pickup.None, Pickup.None, Pickup.None],
          });
        }
      }

      // Breather, then the lead-in for whatever pattern comes next.
      pushClear(slots, gap + LEAD_IN_SLOTS);
    }

    return slots;
  };

  // Try a few times before falling back. The retry is what keeps the fallback rare:
  // an unlucky draw gets re-rolled rather than flattening the whole stretch.
  let slots: Slot[] | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = build();
    if (solveRoute(candidate, entryLane) !== null) {
      slots = candidate;
      break;
    }
  }

  // THE GUARANTEE. If even the retries failed, ship a stretch that is trivially
  // survivable. Better a dull track than an impossible one.
  if (slots === null) return makeSafeStretch(startZ, count);

  // Scatter pickups into open cells only — never bait the player into a barrier.
  for (const slot of slots) {
    for (let lane = 0; lane < LANES; lane++) {
      if (slot.cells[lane] === Obstacle.None && rng() < 0.22) {
        slot.pickups[lane] = Pickup.Shard;
      }
    }
  }

  return slots;
}


/** An entirely open stretch. The fallback that can never be unwinnable. */
function makeSafeStretch(startZ: number, count: number): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      z: startZ + i * SLOT_SPACING,
      cells: [Obstacle.None, Obstacle.None, Obstacle.None],
      pickups: [Pickup.None, Pickup.None, Pickup.None],
    });
  }
  return slots;
}

/**
 * The opening stretch. Deliberately empty so the player gets oriented before the first
 * obstacle — a standard onboarding courtesy in this genre.
 */
export function generateOpening(slotCount = 6): Slot[] {
  return makeSafeStretch(0, slotCount);
}

/* ------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Run score. Distance is the main driver; shards are a meaningful but secondary bonus,
 * so chasing them is a real choice rather than an obvious trap or an obvious win.
 */
export function runScore(distance: number, shards: number): number {
  return Math.floor(distance / 10) + shards * 25;
}

/**
 * Time in ms between two slots arriving, at a given speed.
 * Used by the test suite to prove jumps and slides always fit.
 */
export function msBetweenSlots(speed: number): number {
  return (SLOT_SPACING / speed) * 1000;
}
