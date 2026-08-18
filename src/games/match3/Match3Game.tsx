'use client';

/**
 * Match-3 screen. Thin by design: the engine owns the rules, the scene owns the pixels,
 * and ArcadeGameFrame owns the chrome. This file only wires the three together.
 */

import { useCallback, useMemo } from 'react';

import PhaserCanvas, { type GameBridge } from '../PhaserCanvas';
import { ArcadeGameFrame, type ResultRow } from '@/components/game/ArcadeGameFrame';
import { GameShell } from '@/components/game/GameShell';
import { gameTitle } from '@/lib/games';
import { type Match3Result, createMatch3Scene } from './scene';


/** Logical canvas size. Portrait-ish so an 8x8 board fills a phone screen properly. */
const WIDTH = 720;
const HEIGHT = 860;

export function Match3Game() {
  const scoreOf = useCallback((r: Match3Result) => r.score, []);

  const rowsOf = useCallback(
    (r: Match3Result): ResultRow[] => [
      { label: 'Moves used', value: String(r.movesPlayed) },
      { label: 'Gems cleared', value: String(r.gemsCleared) },
      {
        label: 'Best chain',
        value: r.bestCascade > 1 ? `x${r.bestCascade}` : 'none',
      },
    ],
    [],
  );

  const detailOf = useCallback(
    (r: Match3Result) => ({
      moves: r.movesPlayed,
      gems: r.gemsCleared,
      bestCascade: r.bestCascade,
    }),
    [],
  );

  /*
   * Title comes from the library via gameTitle('match-3') rather than being typed here.
   * The internal id stays 'match-3' (it is a database and localStorage key), so
   * hardcoding the label is what let the old name leak onto this screen after the lobby
   * was renamed. One source of truth prevents that recurring.
   */
  return (
    <GameShell
      title={gameTitle('match-3')}
      subtitle="30 moves · chain cascades for multipliers"
    >
      <ArcadeGameFrame<Match3Result>
        gameId="match-3"
        scoreOf={scoreOf}
        rowsOf={rowsOf}
        detailOf={detailOf}
        controls="Swipe or drag a gem toward a neighbour · Click to select, then click adjacent · Arrows/WASD to move, Enter to pick · H for a hint"
        renderCanvas={({ runId, onScore, onStatus, onGameOver }) => (
          <Match3Canvas
            // A new key forces a full Phaser teardown and rebuild for each run.
            key={runId}
            runId={runId}
            onScore={onScore}
            onStatus={onStatus}
            onGameOver={onGameOver}
          />
        )}
      />
    </GameShell>
  );
}


/**
 * Separated so `useMemo` on the scene factory is keyed to one run.
 *
 * The factory must be referentially stable: PhaserCanvas lists `createScenes` in its
 * effect dependencies, so a new function identity every render would destroy and rebuild
 * the game on each parent update.
 */
function Match3Canvas({
  runId,
  onScore,
  onStatus,
  onGameOver,
}: {
  runId: number;
  onScore: (n: number) => void;
  onStatus: (s: string) => void;
  onGameOver: (r: Match3Result) => void;
}) {
  const bridge = useMemo<GameBridge<Match3Result>>(
    () => ({ onScore, onGameOver, onStatus }),
    [onScore, onGameOver, onStatus],
  );

  const createScenes = useMemo(
    () =>
      (phaser: typeof import('phaser'), b: GameBridge<Match3Result>) => [
        createMatch3Scene(phaser, {
          width: WIDTH,
          height: HEIGHT,
          bridge: b,
          // Time-based seed: each run is a different board. Swapping this for a shared
          // constant is all that a "daily challenge" or a seeded duel would need.
          seed: (Date.now() ^ (runId * 2654435761)) >>> 0,
        }),
      ],
    [runId],
  );

  return (
    <PhaserCanvas<Match3Result>
      createScenes={createScenes}
      width={WIDTH}
      height={HEIGHT}
      bridge={bridge}
    />
  );
}
