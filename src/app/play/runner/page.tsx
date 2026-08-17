import type { Metadata } from 'next';

import { ConnectGate } from '@/components/ConnectGate';
import { RunnerGame } from '@/games/runner/RunnerGame';

export const metadata: Metadata = {
  title: 'Runner · Unicity Arcade',
  description: 'Endless three-lane sprint with procedurally generated, always-clearable tracks.',
};

export default function RunnerPage() {
  return (
    <ConnectGate>
      <RunnerGame />
    </ConnectGate>
  );
}
