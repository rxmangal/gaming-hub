import type { Metadata } from 'next';

import { ConnectGate } from '@/components/ConnectGate';
import { TicTacToeGame } from '@/games/tictactoe/TicTacToeGame';

export const metadata: Metadata = {
  title: 'Tic-Tac-Toe · Unicity Arcade',
  description: 'Local, online and single-player Tic-Tac-Toe in the Unicity Arcade.',
};

/**
 * Wallet-gated, exactly like the lobby: a Sphere identity is required before play,
 * because the identity is what seats you in a multiplayer room.
 */
export default function TicTacToePage() {
  return (
    <ConnectGate>
      <TicTacToeGame />
    </ConnectGate>
  );
}
