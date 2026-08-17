import type { Metadata } from 'next';

import { ConnectGate } from '@/components/ConnectGate';
import { PlayerProfile } from '@/components/profile/PlayerProfile';

export const metadata: Metadata = {
  title: 'Profile · Unicity Arcade',
  description:
    'Your arcade record — games played, wins, losses, personal bests and the global leaderboard.',
};

export default function ProfilePage() {
  return (
    <ConnectGate>
      <PlayerProfile />
    </ConnectGate>
  );
}
