import type { Metadata } from 'next';

import { ConnectGate } from '@/components/ConnectGate';
import { ChessGame } from '@/games/chess/ChessGame';

export const metadata: Metadata = {
  title: 'Chess · Unicity Arcade',
  description: 'Full-rules chess with local, online and single-player AI modes.',
};

export default function ChessPage() {
  return (
    <ConnectGate>
      <ChessGame />
    </ConnectGate>
  );
}
