import type { Metadata } from 'next';

import { ConnectGate } from '@/components/ConnectGate';
import { LeaderboardScreen } from '@/components/leaderboard/LeaderboardScreen';

export const metadata: Metadata = {
  title: 'Leaderboards · Unicity Arcade',
  description:
    'Top 30 players for every game in the arcade — Chess, Tic-Tac-Toe, Neon Nexus and Block Dash.',
};

/**
 * Behind ConnectGate like the rest of the arcade.
 *
 * The board itself is public data, but a connected wallet is what lets us highlight
 * "you" in the standings, and the whole app already requires a wallet to enter.
 */
export default function LeaderboardPage() {
  return (
    <ConnectGate>
      <LeaderboardScreen />
    </ConnectGate>
  );
}
