import type { Metadata } from 'next';

import { ConnectGate } from '@/components/ConnectGate';
import { Match3Game } from '@/games/match3/Match3Game';

export const metadata: Metadata = {
  // Browser tab title. The route stays /play/match-3 — only the label changed.
  title: 'Neon Nexus · Unicity Arcade',
  description: 'Thirty moves, cascading chain reactions and a wallet-bound personal best.',
};

export default function Match3Page() {
  return (
    <ConnectGate>
      <Match3Game />
    </ConnectGate>
  );
}
