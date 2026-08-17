import { ConnectGate } from '@/components/ConnectGate';
import { ArcadeLobby } from '@/components/ArcadeLobby';

/**
 * Arcade entry point.
 *
 * The wallet is a HARD gate: <ConnectGate> renders the lobby only once the
 * Sphere wallet reports a connected session with an identity.
 */
export default function Home() {
  return (
    <ConnectGate>
      <ArcadeLobby />
    </ConnectGate>
  );
}
