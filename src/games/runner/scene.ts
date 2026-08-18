/**
 * Endless runner Phaser scene: a pseudo-3D renderer over the verified generator.
 *
 * WHY PSEUDO-3D IN A 2D ENGINE
 * Phaser is a 2D engine, but this genre needs depth: obstacles must rush toward the
 * camera. Rather than bolt on a 3D library, the track is stored as a list of slots at
 * world-space depths (`z`) and projected to the screen each frame with a single
 * perspective divide. That is how outrun-era racers worked, it is a handful of lines of
 * maths, and it keeps the entire game inside one small dependency.
 *
 * THE COLLISION MODEL MATCHES THE VERIFIED SOLVER
 * The generator's guarantee — every track is completable — was proved against a specific
 * movement model: the player occupies exactly ONE lane per slot, and a jump or slide
 * committed for a slot resolves before the next arrives. This scene implements exactly
 * that model:
 *   - Lane membership uses the COMMITTED target lane, not the tweening sprite position,
 *     so the collision test is the same discrete "which lane am I in" question the solver
 *     answered.
 *   - Jump and slide are timed windows whose durations come from the generator's own
 *     JUMP_MS / SLIDE_MS constants, which the physics test asserts fit inside the slot
 *     spacing at max speed.
 * If this scene invented its own timings, the proof would no longer apply to the game the
 * player actually plays. Importing the constants is what keeps the guarantee honest.
 *
 * RENDERING: the whole track is drawn into ONE Graphics object that is cleared and
 * redrawn each frame. With ~40 visible slots this is far cheaper than creating, scaling
 * and destroying hundreds of sprites per second, and it makes per-frame perspective
 * scaling trivial.
 */

import type Phaser from 'phaser';

import type { GameBridge } from '../PhaserCanvas';
import {
  JUMP_MS,
  LANE_CHANGE_MS,
  LANES,
  Obstacle,
  Pickup,
  SLIDE_MS,
  SLOT_SPACING,
  type Slot,
  difficultyAt,
  generateOpening,
  generateSlots,
  makeRng,
  runScore,
} from './generator';

/** Final result handed to React when the run ends. */
export interface RunnerResult {
  score: number;
  distance: number;
  shards: number;
  topSpeed: number;
}

export interface RunnerSceneConfig {
  width: number;
  height: number;
  bridge: GameBridge<RunnerResult>;
  seed: number;
}

/* ---- Projection tuning (screen-space, not gameplay) ---------------------- */

/** How far ahead the player can see, in world units. */
const VIEW_DEPTH = SLOT_SPACING * 26;
/** Focal length. Larger = flatter, more telephoto; smaller = wider, more dramatic. */
const FOCAL = 900;
/** Lane separation in world units. */
const LANE_WIDTH = 260;
/** Slots generated per batch. */
const BATCH = 24;

/** Neon colours per obstacle type. Type is signalled by colour AND by silhouette. */
const COLOR_BARRIER = 0xfb7185; // rose — cannot be passed
const COLOR_LOW = 0xfbbf24; // amber — jump it
const COLOR_OVERHEAD = 0xa78bfa; // violet — slide under it
const COLOR_SHARD = 0x22d3ee; // cyan — collect

export function createRunnerScene(
  phaser: typeof import('phaser'),
  config: RunnerSceneConfig,
) {
  const { width, height, bridge, seed } = config;

  return class RunnerScene extends phaser.Scene {
    private rng = makeRng(seed);

    /** Visible track, ordered by z. Slots behind the player are pruned. */
    private slots: Slot[] = [];
    /** z of the furthest generated slot, so batches stitch seamlessly. */
    private generatedTo = 0;

    /** Distance travelled. This is the camera's z. */
    private distance = 0;
    private speed = 0;
    private topSpeed = 0;
    private shards = 0;
    private score = 0;

    /** The lane the player is COMMITTED to — what collision uses. */
    private lane = 1;
    /** Smoothed x for rendering only, so lane changes look like motion. */
    private visualLane = 1;

    /** Timestamps (scene time, ms) until which the player is airborne / sliding. */
    private jumpUntil = 0;
    private slideUntil = 0;

    private dead = false;
    private startedAt = 0;

    /** Index of the next slot that has not yet crossed the player plane. */
    private nextSlot = 0;

    private track!: Phaser.GameObjects.Graphics;
    private player!: Phaser.GameObjects.Graphics;
    private hud!: Phaser.GameObjects.Text;

    /** Ground line at the player's plane, and the vanishing point. */
    private horizonY = 0;
    private groundY = 0;
    private centerX = 0;

    constructor() {
      super({ key: 'Runner' });
    }

    create(): void {
      this.centerX = width / 2;
      this.horizonY = height * 0.36;
      this.groundY = height * 0.86;

      this.drawSky();

      this.track = this.add.graphics().setDepth(5);
      this.player = this.add.graphics().setDepth(10);

      this.hud = this.add
        .text(18, 16, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '15px',
          color: '#e2e8f0',
        })
        .setDepth(30);

      // The opening stretch is obstacle-free by construction (asserted in the test
      // suite), giving the player a moment to read the controls before anything lethal.
      this.slots = generateOpening(6);
      this.generatedTo = this.slots.length * SLOT_SPACING;
      this.extendTrack();

      this.speed = difficultyAt(0).speed;
      this.startedAt = this.time.now;

      this.wireInput();
      this.showHint();
    }

    /* ----------------------------------------------------------------- */
    /* Static backdrop                                                    */
    /* ----------------------------------------------------------------- */

    /** Horizon glow and a starfield. Drawn once; never changes. */
    private drawSky(): void {
      const g = this.add.graphics().setDepth(0);

      // Bands of increasing darkness above the horizon — a cheap gradient that stays
      // near-black at the top for OLED.
      const bands = 14;
      for (let i = 0; i < bands; i++) {
        const t = i / bands;
        g.fillStyle(0x22d3ee, 0.035 * (1 - t) * (1 - t));
        g.fillRect(0, this.horizonY - (i + 1) * (this.horizonY / bands), width, this.horizonY / bands + 1);
      }

      // Horizon line.
      g.lineStyle(1.5, 0x22d3ee, 0.4);
      g.lineBetween(0, this.horizonY, width, this.horizonY);

      // Stars, seeded from the run's RNG so a given seed always looks the same.
      for (let i = 0; i < 70; i++) {
        const x = this.rng() * width;
        const y = this.rng() * this.horizonY * 0.92;
        const r = 0.6 + this.rng() * 1.1;
        g.fillStyle(0xffffff, 0.18 + this.rng() * 0.4);
        g.fillCircle(x, y, r);
      }
    }

    private showHint(): void {
      const text = this.add
        .text(
          this.centerX,
          this.horizonY + 40,
          'SWIPE or ARROWS / WASD\nUP jump    DOWN slide    LEFT/RIGHT switch lane',
          {
            fontFamily: 'ui-monospace, monospace',
            fontSize: '13px',
            color: '#94a3b8',
            align: 'center',
            lineSpacing: 6,
          },
        )
        .setOrigin(0.5)
        .setDepth(28);

      // Fades out on its own — instructions should not become permanent clutter.
      this.tweens.add({
        targets: text,
        alpha: 0,
        delay: 2600,
        duration: 900,
        onComplete: () => text.destroy(),
      });
    }

    /* ----------------------------------------------------------------- */
    /* Input                                                              */
    /* ----------------------------------------------------------------- */

    private wireInput(): void {
      const kb = this.input.keyboard;
      if (kb) {
        kb.on('keydown-LEFT', () => this.moveLane(-1));
        kb.on('keydown-RIGHT', () => this.moveLane(1));
        kb.on('keydown-UP', () => this.jump());
        kb.on('keydown-DOWN', () => this.slide());
        kb.on('keydown-A', () => this.moveLane(-1));
        kb.on('keydown-D', () => this.moveLane(1));
        kb.on('keydown-W', () => this.jump());
        kb.on('keydown-S', () => this.slide());
        kb.on('keydown-SPACE', () => this.jump());
      }

      // Swipe. This is the primary control on mobile, so the threshold is deliberately
      // low (28px) — a runner demands reaction speed, and a long swipe costs time the
      // player does not have.
      let downX = 0;
      let downY = 0;
      let swiped = false;

      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
        downX = p.x;
        downY = p.y;
        swiped = false;
      });

      // Acting on pointermove rather than waiting for release: the gesture fires the
      // instant it is recognised, which is what makes swipe controls feel immediate.
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown || swiped) return;
        const dx = p.x - downX;
        const dy = p.y - downY;
        if (Math.hypot(dx, dy) < 28) return;

        swiped = true;
        if (Math.abs(dx) > Math.abs(dy)) this.moveLane(dx > 0 ? 1 : -1);
        else if (dy < 0) this.jump();
        else this.slide();
      });

      // A tap with no swipe is the most common accidental input; treat it as a jump,
      // which is the least punishing interpretation.
      this.input.on('pointerup', () => {
        if (!swiped) this.jump();
      });
    }

    private moveLane(dir: number): void {
      if (this.dead) return;
      const target = phaser.Math.Clamp(this.lane + dir, 0, LANES - 1);
      if (target === this.lane) return;
      this.lane = target;
    }

    private jump(): void {
      if (this.dead) return;
      // No double-jump: the solver's model assumes one commitment per slot, and letting
      // the player re-jump mid-air would let them clear patterns the proof never allowed.
      if (this.time.now < this.jumpUntil) return;
      this.slideUntil = 0;
      this.jumpUntil = this.time.now + JUMP_MS;
    }

    private slide(): void {
      if (this.dead) return;
      if (this.time.now < this.slideUntil) return;
      // Sliding cancels a jump, which is the standard "fast fall" affordance.
      this.jumpUntil = 0;
      this.slideUntil = this.time.now + SLIDE_MS;
    }

    private get airborne(): boolean {
      return this.time.now < this.jumpUntil;
    }

    private get sliding(): boolean {
      return this.time.now < this.slideUntil;
    }

    /* ----------------------------------------------------------------- */
    /* Track streaming                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Appends batches until the track covers the view.
     *
     * `this.lane` is passed as the entry lane so the generator can verify solvability
     * from where the player actually is — not from an assumed centre lane. Without this
     * a batch could begin with a pattern that is unreachable from the player's current
     * position, which is precisely the unfairness the lead-in slots exist to prevent.
     */
    private extendTrack(): void {
      while (this.generatedTo < this.distance + VIEW_DEPTH + SLOT_SPACING * BATCH) {
        const batch = generateSlots(
          this.generatedTo,
          BATCH,
          this.distance,
          this.rng,
          this.lane,
        );
        this.slots.push(...batch);
        this.generatedTo += BATCH * SLOT_SPACING;
      }
    }

    /** Drops slots the player has passed, so the array cannot grow without bound. */
    private pruneTrack(): void {
      let drop = 0;
      while (drop < this.slots.length && this.slots[drop].z < this.distance - SLOT_SPACING * 2) {
        drop++;
      }
      if (drop > 0) {
        this.slots.splice(0, drop);
        this.nextSlot = Math.max(0, this.nextSlot - drop);
      }
    }

    /* ----------------------------------------------------------------- */
    /* Frame                                                              */
    /* ----------------------------------------------------------------- */

    update(_time: number, delta: number): void {
      if (this.dead) return;

      const dt = delta / 1000;

      // Difficulty is a pure function of distance, so speed and density are consistent
      // across runs and testable in isolation.
      const diff = difficultyAt(this.distance);
      this.speed = diff.speed;
      this.topSpeed = Math.max(this.topSpeed, this.speed);

      this.distance += this.speed * dt;

      this.extendTrack();
      this.checkCrossings();
      this.pruneTrack();

      // Ease the rendered lane toward the committed one. Collision already used the
      // committed lane, so this is purely how the movement reads on screen.
      const laneLerp = Math.min(1, delta / LANE_CHANGE_MS);
      this.visualLane += (this.lane - this.visualLane) * laneLerp;

      this.renderTrack();
      this.renderPlayer();
      this.updateHud();
    }

    /**
     * Resolves every slot that crossed the player's plane this frame.
     *
     * A loop, not a single check: at max speed with a long frame (a background tab
     * regaining focus, say) more than one slot can pass in a single update. Checking only
     * the nearest would let obstacles pass straight through the player.
     */
    private checkCrossings(): void {
      while (this.nextSlot < this.slots.length && this.slots[this.nextSlot].z <= this.distance) {
        const slot = this.slots[this.nextSlot];
        this.nextSlot++;

        if (slot.pickups[this.lane] === Pickup.Shard) {
          this.shards++;
          this.collectFx();
        }

        const cell = slot.cells[this.lane];
        if (cell === Obstacle.None) continue;

        // Barrier is fatal regardless of state. Low needs air, Overhead needs a slide.
        // These are exactly the rules solveRoute() used to prove the track completable.
        const survived =
          (cell === Obstacle.Low && this.airborne) ||
          (cell === Obstacle.Overhead && this.sliding);

        if (!survived) {
          this.crash();
          return;
        }
      }
    }

    /** Projects a world-space depth to a 0..1 perspective factor. */
    private project(relZ: number): number {
      return FOCAL / (FOCAL + relZ);
    }

    private screenFor(relZ: number, lane: number): { x: number; y: number; p: number } {
      const p = this.project(relZ);
      const laneOffset = (lane - (LANES - 1) / 2) * LANE_WIDTH;
      return {
        x: this.centerX + laneOffset * p,
        y: this.horizonY + (this.groundY - this.horizonY) * p,
        p,
      };
    }

    /** Redraws lanes and every visible obstacle, far to near. */
    private renderTrack(): void {
      const g = this.track;
      g.clear();

      // --- Lane boundaries, receding to the vanishing point ---
      for (let edge = 0; edge <= LANES; edge++) {
        const lane = edge - 0.5;
        const near = this.screenFor(0, lane);
        const far = this.screenFor(VIEW_DEPTH, lane);
        g.lineStyle(1.5, 0x22d3ee, 0.22);
        g.lineBetween(near.x, near.y, far.x, far.y);
      }

      // --- Ground rungs: the main sense of speed ---
      // Spaced by SLOT_SPACING and offset by distance modulo that spacing, so they slide
      // toward the camera continuously instead of popping.
      const firstRung = Math.floor(this.distance / SLOT_SPACING) * SLOT_SPACING;
      for (let i = 0; i < 26; i++) {
        const relZ = firstRung + i * SLOT_SPACING - this.distance;
        if (relZ < 0) continue;
        const left = this.screenFor(relZ, -0.5);
        const right = this.screenFor(relZ, LANES - 0.5);
        g.lineStyle(1, 0xffffff, 0.05 + 0.1 * left.p);
        g.lineBetween(left.x, left.y, right.x, right.y);
      }

      // --- Obstacles and pickups, drawn far-to-near so nearer ones overlap correctly ---
      const visible = this.slots
        .filter((s) => s.z - this.distance > -SLOT_SPACING && s.z - this.distance < VIEW_DEPTH)
        .sort((a, b) => b.z - a.z);

      for (const slot of visible) {
        const relZ = slot.z - this.distance;
        for (let lane = 0; lane < LANES; lane++) {
          if (slot.cells[lane] !== Obstacle.None) {
            this.drawObstacle(g, relZ, lane, slot.cells[lane]);
          }
          if (slot.pickups[lane] === Pickup.Shard) {
            this.drawShard(g, relZ, lane);
          }
        }
      }
    }

    /**
     * Draws one obstacle with a silhouette that telegraphs its response.
     *
     * Shape carries the meaning, not just colour: a barrier fills the lane, a low crate
     * hugs the floor (so "jump" is obvious), and an overhead beam hangs from above (so
     * "slide" is obvious). A player must be able to read the correct action at speed,
     * from a distance, without having memorised a colour key.
     */
    private drawObstacle(
      g: Phaser.GameObjects.Graphics,
      relZ: number,
      lane: number,
      kind: Obstacle,
    ): void {
      const { x, y, p } = this.screenFor(relZ, lane);
      const w = LANE_WIDTH * p * 0.78;
      // Fade in from the horizon so obstacles do not pop into existence.
      const alpha = Math.min(1, p * 3.2);

      if (kind === Obstacle.Barrier) {
        const h = 190 * p;
        g.fillStyle(COLOR_BARRIER, 0.2 * alpha);
        g.fillRect(x - w / 2, y - h, w, h);
        g.lineStyle(Math.max(1, 2.5 * p), COLOR_BARRIER, alpha);
        g.strokeRect(x - w / 2, y - h, w, h);
        // Hazard cross — reads as "no" even at tiny scale.
        g.lineStyle(Math.max(1, 1.6 * p), COLOR_BARRIER, 0.75 * alpha);
        g.lineBetween(x - w / 2, y - h, x + w / 2, y);
        g.lineBetween(x + w / 2, y - h, x - w / 2, y);
        return;
      }

      if (kind === Obstacle.Low) {
        const h = 62 * p;
        g.fillStyle(COLOR_LOW, 0.22 * alpha);
        g.fillRect(x - w / 2, y - h, w, h);
        g.lineStyle(Math.max(1, 2.5 * p), COLOR_LOW, alpha);
        g.strokeRect(x - w / 2, y - h, w, h);
        // Up-chevron: jump.
        g.lineStyle(Math.max(1, 2 * p), COLOR_LOW, 0.9 * alpha);
        g.lineBetween(x - w * 0.16, y - h * 0.35, x, y - h * 0.85);
        g.lineBetween(x, y - h * 0.85, x + w * 0.16, y - h * 0.35);
        return;
      }

      // Overhead beam: hangs down from above, leaving a gap at floor level.
      const top = y - 200 * p;
      const beamH = 78 * p;
      g.fillStyle(COLOR_OVERHEAD, 0.22 * alpha);
      g.fillRect(x - w / 2, top, w, beamH);
      g.lineStyle(Math.max(1, 2.5 * p), COLOR_OVERHEAD, alpha);
      g.strokeRect(x - w / 2, top, w, beamH);
      // Down-chevron: slide.
      g.lineStyle(Math.max(1, 2 * p), COLOR_OVERHEAD, 0.9 * alpha);
      g.lineBetween(x - w * 0.16, top + beamH * 0.35, x, top + beamH * 0.85);
      g.lineBetween(x, top + beamH * 0.85, x + w * 0.16, top + beamH * 0.35);
    }

    /** A spinning diamond shard, floating at chest height. */
    private drawShard(g: Phaser.GameObjects.Graphics, relZ: number, lane: number): void {
      const { x, y, p } = this.screenFor(relZ, lane);
      const size = 26 * p;
      const cy = y - 74 * p;
      const alpha = Math.min(1, p * 3.2);
      // Width oscillates over time: a rotating diamond without any 3D maths.
      const spin = 0.35 + 0.65 * Math.abs(Math.sin(this.time.now / 320));

      g.fillStyle(COLOR_SHARD, 0.9 * alpha);
      g.beginPath();
      g.moveTo(x, cy - size);
      g.lineTo(x + size * spin, cy);
      g.lineTo(x, cy + size);
      g.lineTo(x - size * spin, cy);
      g.closePath();
      g.fillPath();

      g.fillStyle(0xffffff, 0.5 * alpha);
      g.fillCircle(x, cy, size * 0.2);
    }

    /**
     * Draws the player: a block-built robot, assembled from separate plates.
     *
     * WHY THIS IS NOT A RECTANGLE ANY MORE
     * The player used to be one rounded rect with a visor stripe. It read as a glowing
     * bar rather than a character — the game is called Block Dash and the thing you
     * control looked like a HUD element.
     *
     * It is still drawn procedurally (no sprite sheet, no image files, nothing to load)
     * but now as a stack of parts: head with a visor and two eyes, an antenna, a torso
     * with a power core, two arms and two legs. Because the parts are separate they can
     * be posed, which is what makes it read as a character: the legs alternate in a run
     * cycle, the arms counter-swing, it tucks in mid-air and stretches out flat in a
     * slide.
     *
     * READABILITY STILL WINS. A runner is read at speed, from a distance, so the
     * silhouette carries the state before any detail does — upright and lifted when
     * airborne, long and low when sliding. The detail is what makes it a character; the
     * silhouette is what makes it playable, and the silhouette footprint (`w`/`h`) is
     * unchanged from the old capsule so the game reads exactly as before.
     *
     * PURELY COSMETIC. Collision uses the lane index and the airborne/sliding flags, not
     * these pixels, so the solver's fairness proof is untouched by this method.
     */
    private renderPlayer(): void {
      const g = this.player;
      g.clear();

      const laneOffset = (this.visualLane - (LANES - 1) / 2) * LANE_WIDTH;
      const x = this.centerX + laneOffset;

      let h = 108;
      let w = 54;
      let lift = 0;

      if (this.airborne) {
        // Parabolic arc across the jump window — peaks in the middle, lands smoothly.
        const t = 1 - (this.jumpUntil - this.time.now) / JUMP_MS;
        lift = Math.sin(t * Math.PI) * 150;
        h = 96;
      } else if (this.sliding) {
        h = 44;
        w = 72;
      }

      const bottom = this.groundY - lift;

      /** Chassis palette: dark plate, cyan rim, white-hot visor. */
      const RIM = 0x22d3ee;
      const PLATE = 0x0a1a22;
      const CORE = 0xa5f3fc;

      // Ground shadow, tightening as the player nears the floor. This is the cue that
      // makes the height of a jump legible.
      const shadow = 1 - lift / 170;
      g.fillStyle(0x000000, 0.5 * shadow);
      g.fillEllipse(x, this.groundY + 6, w * (0.7 + 0.4 * shadow), 16 * shadow + 4);

      // Ambient glow around the whole silhouette, so the robot never sinks into the track.
      for (let i = 3; i >= 1; i--) {
        g.fillStyle(RIM, 0.05 * i);
        g.fillRoundedRect(x - w / 2 - i * 4, bottom - h - i * 4, w + i * 8, h + i * 8, 14);
      }

      /**
       * One armour plate, positioned from its CENTRE.
       *
       * Centre-based coordinates are deliberate: every part is placed relative to a joint
       * (hip, shoulder, neck), and animating a joint means nudging one number instead of
       * recomputing a corner offset.
       */
      const plate = (cx: number, cy: number, pw: number, ph: number, radius = 3) => {
        g.fillStyle(PLATE, 0.98);
        g.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, radius);
        g.lineStyle(2, RIM, 0.95);
        g.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, radius);
      };

      if (this.sliding) {
        /* ---------------------- SLIDE: long, low, head-first ---------------------- */
        // Legs trail behind, so the mass sits forward and the pose cannot be mistaken
        // for a short stand.
        plate(x - 20, bottom - 11, 30, 11);
        plate(x - 16, bottom - 24, 26, 10);

        // Torso, pitched flat.
        plate(x + 2, bottom - 18, 40, 22, 5);

        // Power core.
        g.fillStyle(CORE, 0.9);
        g.fillRoundedRect(x - 4, bottom - 22, 10, 8, 2);

        // Trailing arm, thrown back for balance.
        plate(x - 12, bottom - 32, 24, 8);

        // Head, thrust forward, visor leading.
        plate(x + 25, bottom - 27, 24, 20, 4);
        g.fillStyle(CORE, 0.95);
        g.fillRoundedRect(x + 17, bottom - 31, 16, 6, 2);
        return;
      }

      /* ------------------------- STAND / RUN / JUMP pose ------------------------- */

      /**
       * Run cycle. One sine drives the whole body so the parts stay in phase — legs,
       * arms and the vertical bob all read as a single motion. Frozen mid-air, because
       * a running animation while airborne looks like a bug.
       */
      const stride = this.airborne ? 0 : Math.sin(this.time.now / 62);
      const bob = this.airborne ? 0 : Math.abs(stride) * 2;

      // Legs tuck up in a jump — the classic "knees to chest" read.
      const legH = this.airborne ? 20 : 32;
      const legW = 14;
      const hipY = bottom - legH / 2;

      // Alternating lift: whichever leg is forward rises, the other stays planted.
      const leftLift = Math.max(0, stride) * 9;
      const rightLift = Math.max(0, -stride) * 9;

      plate(x - 11, hipY - leftLift, legW, legH);
      plate(x + 11, hipY - rightLift, legW, legH);

      // Feet, so the legs end in something rather than stopping dead.
      plate(x - 11, bottom - 3 - leftLift, legW + 4, 7, 2);
      plate(x + 11, bottom - 3 - rightLift, legW + 4, 7, 2);

      const torsoH = 36;
      const torsoW = 40;
      const torsoCY = bottom - legH - torsoH / 2 - bob;

      plate(x, torsoCY, torsoW, torsoH, 6);

      // Power core: the focal point, and a pulse that shows the game is still running.
      const pulse = 0.65 + 0.35 * Math.sin(this.time.now / 180);
      g.fillStyle(CORE, pulse);
      g.fillRoundedRect(x - 7, torsoCY - 6, 14, 12, 3);
      g.fillStyle(0xffffff, 0.6 * pulse);
      g.fillRoundedRect(x - 3, torsoCY - 3, 6, 6, 2);

      // Arms counter-swing against the legs; both come up when airborne.
      const armSwing = this.airborne ? -9 : stride * 6;
      plate(x - 25, torsoCY - armSwing, 10, 26, 3);
      plate(x + 25, torsoCY + armSwing, 10, 26, 3);

      // Head, with a lit visor and two eyes inside it.
      const headH = 26;
      const headCY = torsoCY - torsoH / 2 - headH / 2 - 2;
      plate(x, headCY, 34, headH, 5);

      g.fillStyle(0x000000, 0.85);
      g.fillRoundedRect(x - 13, headCY - 5, 26, 11, 3);
      g.fillStyle(CORE, 0.95);
      g.fillRoundedRect(x - 9, headCY - 2, 6, 5, 1);
      g.fillRoundedRect(x + 3, headCY - 2, 6, 5, 1);

      // Antenna: breaks the straight top edge, which is most of what stops a stack of
      // plates still reading as a box.
      g.lineStyle(2, RIM, 0.9);
      g.beginPath();
      g.moveTo(x + 8, headCY - headH / 2);
      g.lineTo(x + 13, headCY - headH / 2 - 10);
      g.strokePath();
      g.fillStyle(CORE, pulse);
      g.fillCircle(x + 13, headCY - headH / 2 - 12, 3);
    }

    private updateHud(): void {
      this.score = runScore(Math.floor(this.distance), this.shards);
      this.hud.setText(
        `${Math.floor(this.distance / 10).toLocaleString()} M    ` +
          `SHARDS ${this.shards}    ${Math.round(this.speed / 10)} KPH`,
      );
      bridge.onScore(this.score);
    }

    /* ----------------------------------------------------------------- */
    /* Events                                                            */
    /* ----------------------------------------------------------------- */

    private collectFx(): void {
      const laneOffset = (this.visualLane - (LANES - 1) / 2) * LANE_WIDTH;
      const x = this.centerX + laneOffset;
      const y = this.groundY - 74;

      const ring = this.add.graphics().setDepth(20);
      ring.lineStyle(2.5, COLOR_SHARD, 1);
      ring.strokeCircle(x, y, 14);

      // Expanding, fading ring — instant, unmissable feedback that does not obscure the
      // track ahead.
      this.tweens.add({
        targets: ring,
        alpha: 0,
        scale: 2.6,
        duration: 380,
        ease: 'Quad.easeOut',
        onComplete: () => ring.destroy(),
      });
    }

    private crash(): void {
      this.dead = true;

      // Camera shake plus a red flash: the two clearest "you failed" signals available
      // without audio.
      this.cameras.main.shake(240, 0.014);
      this.cameras.main.flash(180, 255, 60, 90);

      const flash = this.add
        .rectangle(width / 2, height / 2, width, height, 0xfb7185, 0.18)
        .setDepth(26);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 520,
        onComplete: () => flash.destroy(),
      });

      const elapsed = this.time.now - this.startedAt;
      const finalScore = runScore(Math.floor(this.distance), this.shards);

      // Brief pause so the crash registers before React swaps in the results panel.
      this.time.delayedCall(620, () => {
        bridge.onStatus?.(`Run ended after ${(elapsed / 1000).toFixed(1)}s`);
        bridge.onGameOver({
          score: finalScore,
          distance: Math.floor(this.distance),
          shards: this.shards,
          topSpeed: Math.round(this.topSpeed),
        });
      });
    }
  };
}
