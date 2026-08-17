'use client';

/**
 * The single bridge between React and Phaser.
 *
 * Every arcade game mounts through this component, so all the awkward integration
 * problems get solved once here instead of being re-bungled per game:
 *
 *  1. PHASER MUST NEVER TOUCH THE SERVER. It reaches for `window`, `document` and
 *     WebGL at import time. In Next.js App Router that means a hard crash during SSR,
 *     so Phaser is loaded with a dynamic `await import()` inside an effect — never at
 *     module scope.
 *
 *  2. REACT 19 STRICT MODE MOUNTS EFFECTS TWICE IN DEV. Naively creating the game in an
 *     effect yields two WebGL contexts, double input handlers, and a doubled game loop.
 *     A `disposed` flag plus a real `destroy(true)` in cleanup makes remounting safe.
 *
 *  3. THE ASYNC IMPORT CAN RESOLVE AFTER UNMOUNT. If the user navigates away mid-load,
 *     the late resolve would attach a canvas to a dead DOM node. The `disposed` flag is
 *     checked again after the await, and the freshly-created game is destroyed if so.
 *
 *  4. GAMES NEED TO TALK TO REACT. The scene factory receives a plain callback bag, so
 *     scenes report score/state upward without React ever reaching into scene internals.
 *     One direction only: React renders HUD, Phaser owns the game loop.
 */

import { useEffect, useRef, useState } from 'react';

/** What a game reports back to React. Kept deliberately small. */
export interface GameBridge<TResult> {
  /** Live score for the HUD. */
  onScore: (score: number) => void;
  /** Terminal: the run/board is over and this is the final result. */
  onGameOver: (result: TResult) => void;
  /** Optional free-form status line ("Cascade x3!", "Reshuffling…"). */
  onStatus?: (text: string) => void;
}

interface PhaserCanvasProps<TResult> {
  /**
   * Builds the scene list. Receives Phaser itself (so the scene can extend
   * `Phaser.Scene` without importing it at module scope) plus the bridge callbacks.
   */
  createScenes: (
    phaser: typeof import('phaser'),
    bridge: GameBridge<TResult>,
  ) => Phaser.Types.Scenes.SceneType[];
  /** Logical canvas size. Phaser's Scale.FIT keeps the aspect ratio on any screen. */
  width: number;
  height: number;
  bridge: GameBridge<TResult>;
  /** Extra classes for the wrapper. */
  className?: string;
}

export default function PhaserCanvas<TResult>({
  createScenes,
  width,
  height,
  bridge,
  className = '',
}: PhaserCanvasProps<TResult>) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The bridge is stashed in a ref so a re-render with new callback identities does not
  // tear down and rebuild the whole game. The scene reads through the ref every time.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        // Dynamic import: keeps Phaser out of the server bundle entirely.
        const phaser = await import('phaser');

        // The user may have navigated away while Phaser was downloading.
        if (disposed || !holderRef.current) return;

        // Stable indirection so scenes always hit the latest callbacks.
        const stableBridge: GameBridge<TResult> = {
          onScore: (score) => bridgeRef.current.onScore(score),
          onGameOver: (result) => bridgeRef.current.onGameOver(result),
          onStatus: (text) => bridgeRef.current.onStatus?.(text),
        };

        const game = new phaser.Game({
          type: phaser.AUTO, // WebGL when available, Canvas fallback.
          parent: holderRef.current,
          width,
          height,
          // Pure black. This is an OLED-dark arcade; the canvas must not glow grey.
          backgroundColor: '#000000',
          scale: {
            mode: phaser.Scale.FIT,
            autoCenter: phaser.Scale.CENTER_BOTH,
          },
          // Arcade physics is enough for the runner and unused by match-3.
          physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 }, debug: false },
          },
          // Crisp shapes; we draw everything procedurally, so no texture smoothing.
          render: { antialias: true, pixelArt: false },
          input: {
            activePointers: 2,
            /**
             * AUDIT FIX — THE BIGGEST MOBILE BUG IN THE ARCADE.
             *
             * Both Phaser games are driven by swipes: up/down to jump and slide in the
             * Runner, and drag-a-gem in Match-3. On a touchscreen the browser claims those
             * same gestures for page scrolling, so every swipe both moved the player AND
             * scrolled the page out from under them. The Runner was close to unplayable on
             * a phone.
             *
             * `touch-action: 'none'` tells the browser to stop interpreting touches inside
             * the canvas as scroll/zoom and hand them to us. It is scoped to the canvas
             * element alone, so the rest of the page still scrolls normally.
             */
            touch: { target: undefined, capture: true },
          },
          audio: { noAudio: true },
          scene: createScenes(phaser, stableBridge),
        });

        /**
         * Belt and braces: set the CSS property directly on the canvas element.
         *
         * Phaser's touch config does not reliably emit `touch-action`, and without the CSS
         * property iOS Safari still steals vertical swipes for scroll and double-tap for
         * zoom. Applied via the `ready` event because Phaser creates the canvas during its
         * async boot — `game.canvas` is still null the instant the constructor returns.
         */
        game.events.once('ready', () => {
          if (disposed || !game.canvas) return;
          game.canvas.style.touchAction = 'none';
          game.canvas.style.userSelect = 'none';
        });

        // A second late-dispose check: `new Game()` is synchronous but the await above

        // yielded, so unmount could have happened in between.
        if (disposed) {
          game.destroy(true);
          return;
        }

        gameRef.current = game;
        setLoading(false);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Failed to start the game engine.');
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      // `true` also removes the canvas from the DOM — without it, Strict Mode's second
      // mount stacks a second canvas on top of the first.
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // Intentionally excludes `bridge`: it is read through a ref. Including it would
    // destroy and recreate the entire game on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createScenes, width, height]);

  return (
    <div className={`relative w-full ${className}`}>
      <div
        ref={holderRef}
        className="w-full overflow-hidden rounded-2xl border border-white/10 bg-black [&>canvas]:block [&>canvas]:h-auto [&>canvas]:w-full"
        style={{ aspectRatio: `${width} / ${height}` }}
      />

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/80 px-4 py-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            <span className="font-mono text-xs tracking-[0.2em] text-white/50">
              BOOTING ENGINE
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-sm rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center">
            <p className="font-mono text-xs tracking-[0.2em] text-red-300">ENGINE FAILED</p>
            <p className="mt-2 text-sm text-white/60">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
