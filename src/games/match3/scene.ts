/**
 * Match-3 Phaser scene: the renderer and input layer.
 *
 * THE CORE ARCHITECTURAL DECISION: this scene contains no game rules whatsoever. The
 * engine (engine.ts) has already computed the entire outcome of a swap — every cascade,
 * every gem that falls, every point scored — before a single pixel moves. The scene's
 * only job is to play that script back beautifully.
 *
 * Why this separation is worth the discipline:
 *   - The rules are provable. 4,000 boards and 4,000 auto-played moves are verified in
 *     Node with no browser, no canvas, no WebGL. That is impossible if the rules live
 *     inside a Phaser scene.
 *   - Animation bugs can never corrupt the board. A dropped tween is a cosmetic glitch,
 *     not a desynced game state.
 *   - Multiplayer later only needs to ship the swap coordinates + seed; both clients
 *     replay identically because the engine is deterministic.
 *
 * INPUT: the genre standard is drag/swipe a gem toward a neighbour, and that is what
 * mobile players reach for. Desktop players reach for click-then-click, and keyboard
 * users need arrows. All three are wired up; they all funnel into one `attemptSwap`.
 */

import type Phaser from 'phaser';

import type { GameBridge } from '../PhaserCanvas';
import {
  type Board,
  type CascadeStep,
  type Position,
  type ResolveResult,
  areAdjacent,
  cloneBoard,
  countLegalSwaps,
  createBoard,
  findAnyLegalSwap,
  isLegalSwap,
  makeRng,
  trySwap,
} from './engine';
import {
  GEM_COLORS,
  RING_TEXTURE,
  buildMatch3Textures,
  gemTextureKey,
  sparkTextureKey,
} from './art';

/** Final result handed back to React when the move limit is spent. */
export interface Match3Result {
  score: number;
  movesPlayed: number;
  bestCascade: number;
  gemsCleared: number;
}

const ROWS = 8;
const COLS = 8;
/** A fixed move budget turns an endless toy into a scored, comparable run. */
const MOVE_LIMIT = 30;

/* Animation timings, in ms. Tuned so a deep cascade stays readable but never drags. */
const SWAP_MS = 170;
const CLEAR_MS = 210;
const FALL_MS = 260;

export interface Match3SceneConfig {
  width: number;
  height: number;
  bridge: GameBridge<Match3Result>;
  /** Seed for a reproducible board. Multiplayer would share this. */
  seed: number;
}

/**
 * Factory rather than a top-level class.
 *
 * `class extends Phaser.Scene` at module scope would need a runtime `import 'phaser'`,
 * which breaks SSR. Building the class inside a function that receives the Phaser
 * namespace keeps the module server-safe.
 */
export function createMatch3Scene(
  phaser: typeof import('phaser'),
  config: Match3SceneConfig,
) {
  const { width, height, bridge, seed } = config;

  return class Match3Scene extends phaser.Scene {
    private board: Board = [];
    private sprites: (Phaser.GameObjects.Image | null)[][] = [];
    private rng = makeRng(seed);

    private cellSize = 0;
    private originX = 0;
    private originY = 0;

    private score = 0;
    private movesPlayed = 0;
    private bestCascade = 0;
    private gemsCleared = 0;

    /** Locks input while a cascade animates, so the board can't be edited mid-flight. */
    private busy = false;
    private finished = false;

    private selected: Position | null = null;
    private ring: Phaser.GameObjects.Image | null = null;
    /** Keyboard cursor, so the board is playable without a pointer. */
    private cursor: Position = { row: 0, col: 0 };
    private cursorBox: Phaser.GameObjects.Rectangle | null = null;

    private hudText: Phaser.GameObjects.Text | null = null;

    constructor() {
      super({ key: 'Match3' });
    }

    create(): void {
      // Layout: square board, centred, with room for the HUD strip at the top.
      const hudSpace = 54;
      const usable = Math.min(width, height - hudSpace);
      this.cellSize = Math.floor(usable / COLS);
      const boardPx = this.cellSize * COLS;
      this.originX = Math.floor((width - boardPx) / 2);
      this.originY = hudSpace + Math.floor((height - hudSpace - boardPx) / 2);

      buildMatch3Textures(this, this.cellSize);

      this.drawBackdrop();

      // createBoard guarantees: no pre-made matches, at least one legal move. Both are
      // asserted over 3,000 seeds in scripts/verify-match3.mjs.
      this.board = createBoard({ rows: ROWS, cols: COLS }, this.rng);
      this.buildSprites();

      this.ring = this.add
        .image(0, 0, RING_TEXTURE)
        .setVisible(false)
        .setDepth(20);
      // Slow spin makes the selection feel alive without pulling focus.
      this.tweens.add({
        targets: this.ring,
        angle: 360,
        duration: 6000,
        repeat: -1,
      });

      this.cursorBox = this.add
        .rectangle(0, 0, this.cellSize, this.cellSize)
        .setStrokeStyle(1.5, 0xffffff, 0.35)
        .setFillStyle(0xffffff, 0.04)
        .setDepth(15)
        .setVisible(false);

      this.buildHud();
      this.wireInput();
      this.refreshHud();
    }

    /* ----------------------------------------------------------------- */
    /* Presentation                                                       */
    /* ----------------------------------------------------------------- */

    /** Grid, frame and corner brackets. Sci-fi HUD framing, drawn once. */
    private drawBackdrop(): void {
      const g = this.add.graphics().setDepth(0);
      const boardPx = this.cellSize * COLS;

      // Faint interior grid.
      g.lineStyle(1, 0xffffff, 0.05);
      for (let i = 0; i <= COLS; i++) {
        const x = this.originX + i * this.cellSize;
        g.lineBetween(x, this.originY, x, this.originY + boardPx);
      }
      for (let i = 0; i <= ROWS; i++) {
        const y = this.originY + i * this.cellSize;
        g.lineBetween(this.originX, y, this.originX + boardPx, y);
      }

      // Outer frame.
      g.lineStyle(1.5, 0x22d3ee, 0.28);
      g.strokeRect(this.originX - 6, this.originY - 6, boardPx + 12, boardPx + 12);

      // Corner brackets — the cheapest, most legible "this is a HUD" signal there is.
      const arm = 22;
      g.lineStyle(2.5, 0x22d3ee, 0.85);
      const corners: Array<[number, number, number, number]> = [
        [this.originX - 6, this.originY - 6, 1, 1],
        [this.originX + boardPx + 6, this.originY - 6, -1, 1],
        [this.originX - 6, this.originY + boardPx + 6, 1, -1],
        [this.originX + boardPx + 6, this.originY + boardPx + 6, -1, -1],
      ];
      for (const [x, y, dx, dy] of corners) {
        g.lineBetween(x, y, x + arm * dx, y);
        g.lineBetween(x, y, x, y + arm * dy);
      }
    }

    private buildHud(): void {
      this.hudText = this.add
        .text(this.originX - 6, 18, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '15px',
          color: '#e2e8f0',
        })
        .setDepth(30);
    }

    private refreshHud(): void {
      const movesLeft = MOVE_LIMIT - this.movesPlayed;
      const hints = countLegalSwaps(this.board);
      this.hudText?.setText(
        `SCORE ${this.score.toLocaleString()}    MOVES ${movesLeft}    MATCHES ${hints}`,
      );
      bridge.onScore(this.score);
    }

    private cellCenter(row: number, col: number): { x: number; y: number } {
      return {
        x: this.originX + col * this.cellSize + this.cellSize / 2,
        y: this.originY + row * this.cellSize + this.cellSize / 2,
      };
    }

    /** Creates one sprite per cell from the current board. */
    private buildSprites(): void {
      this.sprites = [];
      for (let row = 0; row < ROWS; row++) {
        const line: (Phaser.GameObjects.Image | null)[] = [];
        for (let col = 0; col < COLS; col++) {
          line.push(this.makeGem(row, col, this.board[row][col] as number));
        }
        this.sprites.push(line);
      }
    }

    private makeGem(row: number, col: number, kind: number): Phaser.GameObjects.Image {
      const { x, y } = this.cellCenter(row, col);
      return this.add
        .image(x, y, gemTextureKey(kind))
        .setDisplaySize(this.cellSize, this.cellSize)
        .setDepth(10);
    }

    /* ----------------------------------------------------------------- */
    /* Input                                                              */
    /* ----------------------------------------------------------------- */

    private wireInput(): void {
      let dragFrom: Position | null = null;
      let downX = 0;
      let downY = 0;

      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.busy || this.finished) return;
        const cell = this.cellAt(pointer.x, pointer.y);
        if (!cell) return;
        dragFrom = cell;
        downX = pointer.x;
        downY = pointer.y;
      });

      this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (this.busy || this.finished || !dragFrom) return;

        const dx = pointer.x - downX;
        const dy = pointer.y - downY;
        const dist = Math.hypot(dx, dy);
        const from = dragFrom;
        dragFrom = null;

        // A real drag (a swipe) — the dominant axis decides the direction. This is the
        // mobile-native gesture for this genre.
        if (dist > this.cellSize * 0.35) {
          const target =
            Math.abs(dx) > Math.abs(dy)
              ? { row: from.row, col: from.col + (dx > 0 ? 1 : -1) }
              : { row: from.row + (dy > 0 ? 1 : -1), col: from.col };
          this.clearSelection();
          void this.attemptSwap(from, target);
          return;
        }

        // A tap — classic select-then-select, which is what desktop players expect.
        if (this.selected && areAdjacent(this.selected, from)) {
          const a = this.selected;
          this.clearSelection();
          void this.attemptSwap(a, from);
        } else if (this.selected && this.selected.row === from.row && this.selected.col === from.col) {
          this.clearSelection();
        } else {
          this.select(from);
        }
      });

      // Keyboard: arrows/WASD move a cursor, Enter/Space picks and swaps. Without this
      // the board is unplayable for anyone not using a pointer.
      const kb = this.input.keyboard;
      if (!kb) return;

      const step = (dRow: number, dCol: number) => {
        if (this.busy || this.finished) return;

        // If a gem is already picked, a direction key IS the swap — fewer keystrokes
        // than moving a cursor and confirming.
        if (this.selected) {
          const from = this.selected;
          this.clearSelection();
          void this.attemptSwap(from, { row: from.row + dRow, col: from.col + dCol });
          return;
        }
        this.cursor = {
          row: phaser.Math.Clamp(this.cursor.row + dRow, 0, ROWS - 1),
          col: phaser.Math.Clamp(this.cursor.col + dCol, 0, COLS - 1),
        };
        this.showCursor();
      };

      kb.on('keydown-LEFT', () => step(0, -1));
      kb.on('keydown-RIGHT', () => step(0, 1));
      kb.on('keydown-UP', () => step(-1, 0));
      kb.on('keydown-DOWN', () => step(1, 0));
      kb.on('keydown-A', () => step(0, -1));
      kb.on('keydown-D', () => step(0, 1));
      kb.on('keydown-W', () => step(-1, 0));
      kb.on('keydown-S', () => step(1, 0));

      const confirm = () => {
        if (this.busy || this.finished) return;
        if (this.selected) this.clearSelection();
        else {
          this.select({ ...this.cursor });
          this.showCursor();
        }
      };
      kb.on('keydown-ENTER', confirm);
      kb.on('keydown-SPACE', confirm);

      // A hint, for when the player genuinely cannot spot a move. The engine guarantees
      // one always exists, so this can never mislead.
      kb.on('keydown-H', () => {
        if (this.busy || this.finished) return;
        const move = findAnyLegalSwap(this.board);
        if (move) this.flashHint(move[0], move[1]);
      });
    }

    private cellAt(x: number, y: number): Position | null {
      const col = Math.floor((x - this.originX) / this.cellSize);
      const row = Math.floor((y - this.originY) / this.cellSize);
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
      return { row, col };
    }

    private select(cell: Position): void {
      this.selected = cell;
      const { x, y } = this.cellCenter(cell.row, cell.col);
      this.ring?.setPosition(x, y).setDisplaySize(this.cellSize, this.cellSize).setVisible(true);
    }

    private clearSelection(): void {
      this.selected = null;
      this.ring?.setVisible(false);
    }

    private showCursor(): void {
      const { x, y } = this.cellCenter(this.cursor.row, this.cursor.col);
      this.cursorBox?.setPosition(x, y).setVisible(true);
    }

    /** Pulses two gems so the player can see the suggested move. */
    private flashHint(a: Position, b: Position): void {
      for (const cell of [a, b]) {
        const sprite = this.sprites[cell.row][cell.col];
        if (!sprite) continue;
        this.tweens.add({
          targets: sprite,
          scale: sprite.scale * 1.22,
          duration: 220,
          yoyo: true,
          repeat: 1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    /* ----------------------------------------------------------------- */
    /* The move                                                           */
    /* ----------------------------------------------------------------- */

    /**
     * Validates, applies and animates a swap.
     *
     * Order matters: the engine resolves the move to completion FIRST, then we animate
     * the script it produced. The board is already in its final state while the tweens
     * are still running, which is exactly why animation can never desync the rules.
     */
    private async attemptSwap(a: Position, b: Position): Promise<void> {
      if (this.busy || this.finished) return;

      // Out of bounds (a swipe off the edge) — ignore silently rather than punish.
      if (
        b.row < 0 || b.row >= ROWS || b.col < 0 || b.col >= COLS ||
        a.row < 0 || a.row >= ROWS || a.col < 0 || a.col >= COLS
      ) {
        return;
      }

      this.busy = true;
      this.cursorBox?.setVisible(false);

      // Illegal: bounce the two gems apart and back. Crucially this does NOT consume a
      // move — punishing exploration would be hostile in a puzzle game.
      if (!isLegalSwap(this.board, a, b)) {
        await this.animateRejected(a, b);
        this.busy = false;
        return;
      }

      // Snapshot for the visual swap; the engine is about to mutate `this.board`.
      const before = cloneBoard(this.board);
      const result = trySwap(this.board, a, b, this.rng);
      if (!result) {
        this.busy = false;
        return;
      }

      await this.animateSwap(a, b);
      // Keep the sprite grid consistent with the pre-cascade arrangement.
      this.swapSprites(a, b);
      void before;

      await this.playCascades(result);

      this.movesPlayed++;
      this.score += result.totalGained;
      this.bestCascade = Math.max(this.bestCascade, result.maxCascade);

      if (result.didReshuffle) {
        bridge.onStatus?.('No moves left — board reshuffled');
        await this.rebuildFromBoard();
      }

      this.refreshHud();
      this.busy = false;

      if (this.movesPlayed >= MOVE_LIMIT) this.finish();
    }

    /** Slides two gems into each other's cells. */
    private animateSwap(a: Position, b: Position): Promise<void> {
      const spriteA = this.sprites[a.row][a.col];
      const spriteB = this.sprites[b.row][b.col];
      if (!spriteA || !spriteB) return Promise.resolve();

      const posA = this.cellCenter(a.row, a.col);
      const posB = this.cellCenter(b.row, b.col);

      return new Promise((resolve) => {
        let done = 0;
        const finish = () => {
          done++;
          if (done === 2) resolve();
        };
        this.tweens.add({
          targets: spriteA, x: posB.x, y: posB.y,
          duration: SWAP_MS, ease: 'Quad.easeInOut', onComplete: finish,
        });
        this.tweens.add({
          targets: spriteB, x: posA.x, y: posA.y,
          duration: SWAP_MS, ease: 'Quad.easeInOut', onComplete: finish,
        });
      });
    }

    /** The rejection animation: nudge toward the target, snap back. */
    private animateRejected(a: Position, b: Position): Promise<void> {
      const spriteA = this.sprites[a.row][a.col];
      if (!spriteA) return Promise.resolve();

      const posA = this.cellCenter(a.row, a.col);
      const posB = this.cellCenter(b.row, b.col);
      // Travel only a third of the way — reads as "blocked", not as a completed move.
      const nudgeX = posA.x + (posB.x - posA.x) * 0.32;
      const nudgeY = posA.y + (posB.y - posA.y) * 0.32;

      return new Promise((resolve) => {
        this.tweens.add({
          targets: spriteA,
          x: nudgeX,
          y: nudgeY,
          duration: 110,
          yoyo: true,
          ease: 'Quad.easeOut',
          onComplete: () => resolve(),
        });
      });
    }

    private swapSprites(a: Position, b: Position): void {
      const temp = this.sprites[a.row][a.col];
      this.sprites[a.row][a.col] = this.sprites[b.row][b.col];
      this.sprites[b.row][b.col] = temp;
    }

    /** Walks the engine's cascade script, animating each step in order. */
    private async playCascades(result: ResolveResult): Promise<void> {
      for (const step of result.steps) {
        if (step.cascade > 1) {
          bridge.onStatus?.(`Chain reaction x${step.cascade}!`);
        }
        await this.animateStep(step);
        this.gemsCleared += step.cleared.length;
      }
      if (result.steps.length > 0) this.refreshHud();
    }

    /**
     * One cascade step: destroy, then drop.
     *
     * The destruction is the moment the genre lives on, so it gets real attention:
     * a white flash, a scale-up-and-fade, a particle burst in the gem's own colour, and
     * a floating score number.
     */
    private async animateStep(step: CascadeStep): Promise<void> {
      // --- Destruction ---
      await new Promise<void>((resolve) => {
        let pending = step.cleared.length;
        if (pending === 0) {
          resolve();
          return;
        }

        for (const { row, col } of step.cleared) {
          const sprite = this.sprites[row][col];
          this.sprites[row][col] = null;
          if (!sprite) {
            if (--pending === 0) resolve();
            continue;
          }

          const kind = this.kindFromTexture(sprite);
          const { x, y } = this.cellCenter(row, col);
          this.burst(x, y, kind);

          // Flash white first: a hard, satisfying "hit" before the gem leaves.
          //
          // PHASER 4 API NOTE: `setTintFill(0xffffff)` is the Phaser 3 idiom and is now
          // a deprecated no-op — tint colour and tint MODE are separate settings in v4.
          // Using the old call compiles under a loose config and silently renders no
          // flash at all. The correct v4 form is setTint + setTintMode(FILL).
          sprite.setTint(0xffffff).setTintMode(phaser.TintModes.FILL);

          this.tweens.add({
            targets: sprite,
            scale: sprite.scale * 1.45,
            alpha: 0,
            angle: phaser.Math.Between(-70, 70),
            duration: CLEAR_MS,
            ease: 'Quad.easeOut',
            onComplete: () => {
              sprite.destroy();
              if (--pending === 0) resolve();
            },
          });
        }

        this.floatScore(step);
      });

      // --- Falls + spawns ---
      await this.animateGravity(step);
    }

    /** Particle burst in the destroyed gem's colour. */
    private burst(x: number, y: number, kind: number): void {
      const emitter = this.add.particles(x, y, sparkTextureKey(kind), {
        lifespan: 480,
        speed: { min: 60, max: 210 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: 1, end: 0 },
        // Slight downward pull so debris arcs instead of floating — reads as physical.
        gravityY: 260,
        blendMode: 'ADD',
        emitting: false,
      });
      emitter.setDepth(25);
      emitter.explode(12);
      // Self-cleanup: without this, every clear leaks an emitter for the whole session.
      this.time.delayedCall(700, () => emitter.destroy());
    }

    /** Rising, fading score number at the centre of the cleared run. */
    private floatScore(step: CascadeStep): void {
      const avgRow = step.cleared.reduce((sum, p) => sum + p.row, 0) / step.cleared.length;
      const avgCol = step.cleared.reduce((sum, p) => sum + p.col, 0) / step.cleared.length;
      const { x, y } = this.cellCenter(avgRow, avgCol);

      const label = step.cascade > 1 ? `+${step.gained}  x${step.cascade}` : `+${step.gained}`;
      const text = this.add
        .text(x, y, label, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: `${Math.round(this.cellSize * 0.34)}px`,
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(40);

      this.tweens.add({
        targets: text,
        y: y - this.cellSize * 0.9,
        alpha: 0,
        duration: 620,
        ease: 'Quad.easeOut',
        onComplete: () => text.destroy(),
      });
    }

    /**
     * Animates falls and spawns for one step.
     *
     * Falling gems use a Bounce ease and spawns are staggered by their `offset`, which is
     * what makes a refill look like gems raining into a column rather than teleporting.
     */
    private animateGravity(step: CascadeStep): Promise<void> {
      return new Promise((resolve) => {
        let pending = 0;
        const done = () => {
          if (--pending <= 0) resolve();
        };

        // Existing gems sliding down into the gaps.
        for (const fall of step.falls) {
          const sprite = this.sprites[fall.fromRow][fall.col];
          this.sprites[fall.fromRow][fall.col] = null;
          this.sprites[fall.toRow][fall.col] = sprite;
          if (!sprite) continue;

          const target = this.cellCenter(fall.toRow, fall.col);
          const distance = Math.abs(fall.toRow - fall.fromRow);
          pending++;
          this.tweens.add({
            targets: sprite,
            y: target.y,
            // Longer drops take proportionally longer — constant duration looks wrong.
            duration: FALL_MS + distance * 26,
            ease: 'Bounce.easeOut',
            onComplete: done,
          });
        }

        // New gems dropping in from above the top edge.
        for (const spawn of step.spawns) {
          const target = this.cellCenter(spawn.toRow, spawn.col);
          const sprite = this.add
            .image(target.x, this.originY - spawn.offset * this.cellSize, gemTextureKey(spawn.kind))
            .setDisplaySize(this.cellSize, this.cellSize)
            .setDepth(10);
          this.sprites[spawn.toRow][spawn.col] = sprite;

          pending++;
          this.tweens.add({
            targets: sprite,
            y: target.y,
            duration: FALL_MS + spawn.offset * 30,
            ease: 'Bounce.easeOut',
            onComplete: done,
          });
        }

        if (pending === 0) resolve();
      });
    }

    /** Full sprite rebuild. Used after a reshuffle, where every cell may have moved. */
    private rebuildFromBoard(): Promise<void> {
      for (const line of this.sprites) {
        for (const sprite of line) sprite?.destroy();
      }
      this.buildSprites();

      // Brief fade-in so the reshuffle reads as an event rather than a glitch.
      const all = this.sprites.flat().filter(Boolean) as Phaser.GameObjects.Image[];
      for (const sprite of all) sprite.setAlpha(0);

      return new Promise((resolve) => {
        this.tweens.add({
          targets: all,
          alpha: 1,
          duration: 300,
          onComplete: () => resolve(),
        });
      });
    }

    /** Recovers a gem's kind from its texture key, for colour-matched particles. */
    private kindFromTexture(sprite: Phaser.GameObjects.Image): number {
      const key = sprite.texture.key;
      const parsed = Number.parseInt(key.replace('gem-', ''), 10);
      return Number.isNaN(parsed) ? 0 : parsed % GEM_COLORS.length;
    }

    private finish(): void {
      this.finished = true;
      this.clearSelection();
      this.cursorBox?.setVisible(false);
      bridge.onGameOver({
        score: this.score,
        movesPlayed: this.movesPlayed,
        bestCascade: this.bestCascade,
        gemsCleared: this.gemsCleared,
      });
    }
  };
}
