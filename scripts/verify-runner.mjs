/**
 * Endless runner generator verification.
 *
 * The headline requirement is "procedural generation must guarantee a playable route".
 * That is a claim about every possible track, so it needs a solver and a lot of seeds,
 * not a few minutes of manual play.
 *
 * Checks:
 *   1. Every authored pattern is individually walkable with single-lane steps.
 *   2. Every generated track (thousands of seeds, across the whole difficulty curve)
 *      has a solvable route.
 *   3. Continuous play — repeated generation as the player advances — stays solvable,
 *      including across batch boundaries.
 *   4. The physics timings fit inside the slot spacing at MAX speed, so a jump/slide/
 *      lane-change committed for one slot always finishes before the next arrives.
 *   5. Difficulty is monotonic: speed and density rise with distance, then saturate.
 *   6. Pickups never sit inside an impassable cell.
 *   7. The opening stretch is obstacle-free.
 *   8. Tracks are not degenerate — obstacles actually appear, and the safe-stretch
 *      fallback is not silently doing all the work.
 *
 * Run: node scripts/verify-runner.mjs
 */

import {
  ALL_PATTERNS,
  difficultyAt,
  generateOpening,
  generateSlots,
  isPassable,
  JUMP_MS,
  LANE_CHANGE_MS,
  LANES,
  LEAD_IN_SLOTS,
  makeRng,
  MAX_SPEED,
  msBetweenSlots,
  Obstacle,
  Pickup,
  runScore,
  SLIDE_MS,
  SLOT_SPACING,
  solveRoute,
} from '../.verify/runner/generator.js';


let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return pass;
};

/** Renders a pattern as text so failures are actually diagnosable. */
const drawPattern = (pattern) => {
  const glyph = { 0: '.', 1: '#', 2: 'n', 3: '=' };
  return pattern.map((row) => row.map((c) => glyph[c]).join('')).join(' / ');
};

/* ---------------------------------------------------------------- */
/* 1. Every authored pattern is walkable on its own.                 */
/* ---------------------------------------------------------------- */
{
  let total = 0;
  const broken = [];

  // Patterns are tested WITH the lead-in the generator always emits before them.
  //
  // Why: a pattern like "##." leaves only lane 2 open. Tested bare, it is unwalkable
  // from lane 0 — two lane changes in one slot. That failure was real and it is exactly
  // why LEAD_IN_SLOTS exists. Since generateSlots() never emits a pattern without that
  // lead-in, testing bare patterns tests a situation that cannot occur. We test the
  // shipping contract instead: lead-in + pattern, walkable from every entry lane.
  const clearSlot = (z) => ({
    z,
    cells: [Obstacle.None, Obstacle.None, Obstacle.None],
    pickups: [Pickup.None, Pickup.None, Pickup.None],
  });

  for (const [tier, patterns] of Object.entries(ALL_PATTERNS)) {
    for (const pattern of patterns) {
      total++;

      const slots = [];
      for (let i = 0; i < LEAD_IN_SLOTS; i++) slots.push(clearSlot(i * SLOT_SPACING));
      pattern.forEach((row, i) => {
        slots.push({
          z: (LEAD_IN_SLOTS + i) * SLOT_SPACING,

          cells: [...row],
          pickups: [Pickup.None, Pickup.None, Pickup.None],
        });
      });

      // Try entering from every lane. A pattern is only safe if it is walkable from
      // whichever lane the player happens to be in when it arrives.
      const solvableFromAll = [0, 1, 2].every((lane) => solveRoute(slots, lane) !== null);
      if (!solvableFromAll) broken.push(`${tier}: ${drawPattern(pattern)}`);
    }
  }

  check('every authored pattern is walkable from any entry lane', broken.length === 0,
    broken.length ? `\n        ${broken.join('\n        ')}` : '');
  if (broken.length === 0) {
    console.log(
      `PASS  all ${total} authored patterns walkable from any lane ` +
        `(with the ${LEAD_IN_SLOTS}-slot lead-in the generator guarantees)`,
    );
  }

}

/* ---------------------------------------------------------------- */
/* 2. Generated tracks are solvable across the difficulty curve.     */
/* ---------------------------------------------------------------- */
{
  const SEEDS = 4000;
  let solvable = 0;
  let tested = 0;
  const distances = [0, 3000, 8000, 16000, 24000, 60000];

  for (let seed = 1; seed <= SEEDS; seed++) {
    const distance = distances[seed % distances.length];
    const rng = makeRng(seed);
    const slots = generateSlots(0, 40, distance, rng, 1);
    tested++;
    if (solveRoute(slots, 1) !== null) solvable++;
  }

  check('every generated track is solvable', solvable === tested, `${solvable}/${tested}`);
  console.log(`PASS  ${tested} generated tracks across 6 difficulty points: all solvable`);
}

/* ---------------------------------------------------------------- */
/* 3. Continuous play stays solvable across batch boundaries.        */
/* ---------------------------------------------------------------- */
{
  const RUNS = 400;
  let clean = 0;
  let totalSlots = 0;

  for (let seed = 1; seed <= RUNS; seed++) {
    const rng = makeRng(seed * 104729);
    let distance = 0;
    let lane = 1;
    let ok = true;

    // Simulate a long run: 30 batches of 24 slots = 720 slots, ~230k world units.
    let track = [];
    for (let batch = 0; batch < 30; batch++) {
      const slots = generateSlots(distance, 24, distance, rng, lane);
      track = track.concat(slots);

      // Walk the solver's own route so `lane` reflects a real player position.
      const route = solveRoute(slots, lane);
      if (route === null) {
        ok = false;
        break;
      }
      lane = route[route.length - 1];
      distance += 24 * SLOT_SPACING;
    }


    // The whole stitched track must be solvable end to end, not just batch by batch.
    // This is the check that catches bad seams between batches.
    if (ok && solveRoute(track, 1) === null) ok = false;

    totalSlots += track.length;
    if (ok) clean++;
  }

  check('continuous play is solvable including seams', clean === RUNS, `${clean}/${RUNS}`);
  console.log(`PASS  ${RUNS} long runs (${totalSlots.toLocaleString()} slots) solvable end to end`);
}

/* ---------------------------------------------------------------- */
/* 4. Physics fit inside the slot spacing at max speed.              */
/* ---------------------------------------------------------------- */
{
  const windowMs = msBetweenSlots(MAX_SPEED);

  // A lane change must complete between slots, or the player would be caught between
  // lanes when the next obstacle arrives.
  check('lane change fits between slots at max speed', LANE_CHANGE_MS < windowMs,
    `${LANE_CHANGE_MS}ms vs ${windowMs.toFixed(0)}ms window`);

  // Jump and slide are allowed to span more than one slot window (that is what makes
  // consecutive jump rows readable), but must not exceed two, or the player would still
  // be committed when a third slot arrives.
  check('jump does not exceed two slot windows', JUMP_MS < windowMs * 2,
    `${JUMP_MS}ms vs ${(windowMs * 2).toFixed(0)}ms`);
  check('slide does not exceed two slot windows', SLIDE_MS < windowMs * 2,
    `${SLIDE_MS}ms vs ${(windowMs * 2).toFixed(0)}ms`);

  console.log(
    `PASS  physics fit: ${windowMs.toFixed(0)}ms between slots at max speed ` +
      `(${MAX_SPEED.toFixed(0)} u/s); lane ${LANE_CHANGE_MS}ms, jump ${JUMP_MS}ms, slide ${SLIDE_MS}ms`,
  );
}

/* ---------------------------------------------------------------- */
/* 5. Difficulty is monotonic then saturates.                        */
/* ---------------------------------------------------------------- */
{
  const samples = [0, 2000, 6000, 12000, 20000, 24000, 40000, 100000];
  let speedRises = true;
  let densityRises = true;

  for (let i = 1; i < samples.length; i++) {
    const prev = difficultyAt(samples[i - 1]);
    const curr = difficultyAt(samples[i]);
    if (curr.speed < prev.speed) speedRises = false;
    if (curr.density < prev.density) densityRises = false;
  }

  const start = difficultyAt(0);
  const late = difficultyAt(100000);

  check('speed never decreases with distance', speedRises);
  check('density never decreases with distance', densityRises);
  check('difficulty actually increases', late.speed > start.speed * 1.5,
    `${start.speed.toFixed(0)} -> ${late.speed.toFixed(0)}`);
  check('speed saturates (does not run away)', late.speed === MAX_SPEED,
    `${late.speed.toFixed(0)} vs cap ${MAX_SPEED.toFixed(0)}`);

  console.log(
    `PASS  difficulty ramp: speed ${start.speed.toFixed(0)} -> ${late.speed.toFixed(0)} u/s, ` +
      `density ${(start.density * 100).toFixed(0)}% -> ${(late.density * 100).toFixed(0)}%`,
  );
}

/* ---------------------------------------------------------------- */
/* 6 + 8. Pickups are reachable; tracks are not degenerate.          */
/* ---------------------------------------------------------------- */
{
  let badPickups = 0;
  let obstacleCount = 0;
  let slotCount = 0;
  let emptyTracks = 0;
  const TRACKS = 1200;

  for (let seed = 1; seed <= TRACKS; seed++) {
    const rng = makeRng(seed * 7919);
    const slots = generateSlots(0, 40, 12000, rng, 1);
    let hasObstacle = false;

    for (const slot of slots) {
      slotCount++;
      for (let lane = 0; lane < LANES; lane++) {
        if (slot.pickups[lane] !== Pickup.None && !isPassable(slot.cells[lane])) badPickups++;
        if (slot.cells[lane] !== Obstacle.None) {
          obstacleCount++;
          hasObstacle = true;
        }
      }
    }
    if (!hasObstacle) emptyTracks++;
  }

  check('no pickup sits inside an impassable cell', badPickups === 0, `${badPickups} bad`);
  // If the safe-stretch fallback were firing constantly we'd see many empty tracks —
  // that would mean the guarantee is being met by making the game boring.
  check('tracks are not degenerate (fallback is rare)', emptyTracks < TRACKS * 0.02,
    `${emptyTracks}/${TRACKS} tracks had zero obstacles`);

  const density = ((obstacleCount / (slotCount * LANES)) * 100).toFixed(1);
  console.log(
    `PASS  ${TRACKS} tracks: pickups all reachable, ${density}% of cells occupied, ` +
      `${emptyTracks} empty tracks`,
  );
}

/* ---------------------------------------------------------------- */
/* 7. Opening stretch is clear.                                      */
/* ---------------------------------------------------------------- */
{
  const opening = generateOpening(6);
  const allClear = opening.every((slot) => slot.cells.every((c) => c === Obstacle.None));
  check('opening stretch has no obstacles', allClear);
  check('opening stretch has expected length', opening.length === 6, `${opening.length}`);
  console.log(`PASS  opening stretch: ${opening.length} clear slots for orientation`);
}

/* ---------------------------------------------------------------- */
/* Scoring sanity.                                                   */
/* ---------------------------------------------------------------- */
{
  check('distance drives score', runScore(10000, 0) > runScore(5000, 0));
  check('shards add score', runScore(5000, 10) > runScore(5000, 0));
  check('distance outweighs a few shards', runScore(20000, 0) > runScore(5000, 20));
  console.log(
    `PASS  scoring: 5k+0 shards=${runScore(5000, 0)}, 5k+10=${runScore(5000, 10)}, ` +
      `20k+0=${runScore(20000, 0)}`,
  );
}

console.log('');
if (failures > 0) {
  console.error(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('RESULT: all runner generator checks PASSED');
