'use client';

/**
 * Endless runner screen. Mirrors Match3Game: generator owns the rules, scene owns the
 * pixels, ArcadeGameFrame owns the chrome.
 */

import { useCallback, useMemo } from 'react';

import PhaserCanvas, { type GameBridge } from '../PhaserCanvas';
import { ArcadeGameFrame, type ResultRow } from '@/components/game/ArcadeGameFrame';
import { GameShell } from '@/components/game/GameShell';
import { type RunnerResult, createRunnerScene } from './scene';


/** Landscape: a runner needs to show the track ahead, not the sky above. */
const WIDTH = 900;
const HEIGHT = 620;

export function RunnerGame() {
  const scoreOf = useCallback((r: RunnerResult) => r.score, []);

  const rowsOf = useCallback(
    (r: RunnerResult): ResultRow[] => [
      // Distance is stored in world units; /10 gives a human "metres" figure.
      { label: 'Distance', value: `${Math.floor(r.distance / 10).toLocaleString()} m` },
      { label: 'Shards', value: String(r.shards) },
      { label: 'Top speed', value: `${Math.round(r.topSpeed / 10)} kph` },
    ],
    [],
  );

  const detailOf = useCallback(
    (r: RunnerResult) => ({
      distance: r.distance,
      shards: r.shards,
      topSpeed: r.topSpeed,
    }),
    [],
  );

  return (
    <GameShell title="Runner" subtitle="Endless sprint · every track is provably clearable">
      <ArcadeGameFrame<RunnerResult>
        gameId="runner"
        scoreOf={scoreOf}
        rowsOf={rowsOf}
        detailOf={detailOf}
        controls="Swipe up to jump, down to slide, left/right to switch lane · Arrows or WASD on desktop · Amber = jump, violet = slide, rose = dodge"
        renderCanvas={({ runId, onScore, onStatus, onGameOver }) => (
          <RunnerCanvas
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


function RunnerCanvas({
  runId,
  onScore,
  onStatus,
  onGameOver,
}: {
  runId: number;
  onScore: (n: number) => void;
  onStatus: (s: string) => void;
  onGameOver: (r: RunnerResult) => void;
}) {
  const bridge = useMemo<GameBridge<RunnerResult>>(
    () => ({ onScore, onGameOver, onStatus }),
    [onScore, onGameOver, onStatus],
  );

  const createScenes = useMemo(
    () =>
      (phaser: typeof import('phaser'), b: GameBridge<RunnerResult>) => [
        createRunnerScene(phaser, {
          width: WIDTH,
          height: HEIGHT,
          bridge: b,
          // Fresh seed per run: a new track every time. Because the generator is
          // deterministic, sharing a seed would reproduce an identical track — which is
          // exactly what a "ghost race" against another player's run would need.
          seed: (Date.now() ^ (runId * 40503)) >>> 0,
        }),
      ],
    [runId],
  );

  return (
    <PhaserCanvas<RunnerResult>
      createScenes={createScenes}
      width={WIDTH}
      height={HEIGHT}
      bridge={bridge}
    />
  );
}
