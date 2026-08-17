/**
 * Sphere / Unicity connection configuration.
 *
 * Every value here was verified against the installed package
 * `@unicitylabs/sphere-sdk@0.14.9`:
 *   - `SPHERE_NETWORKS.testnet2` -> { id: 4, name: 'testnet2' }  (dist/connect/index.js)
 *   - `autoConnect()` popup transport opens `${walletUrl}/connect?origin=<origin>`
 *   - Permission scope strings come from `PERMISSION_SCOPES`
 *
 * We import the real constants from the SDK instead of hardcoding strings so a future
 * SDK upgrade surfaces as a type error rather than a silent runtime failure.
 */
import {
  PERMISSION_SCOPES,
  SPHERE_NETWORKS,
  type DAppMetadata,
  type NetworkInfo,
  type PermissionScope,
} from '@unicitylabs/sphere-sdk/connect';

/** Hosted Sphere wallet. Overridable per-environment on Vercel. */
export const WALLET_URL: string =
  process.env.NEXT_PUBLIC_SPHERE_WALLET_URL ?? 'https://sphere.unicity.network';

/**
 * Network this dApp targets. The wallet rejects a mismatch with
 * INCOMPATIBLE_NETWORK (4008), so this must match the user's active network.
 * testnet2 = networkId 4 (the live v2 state-transition network).
 */
export const ARCADE_NETWORK: NetworkInfo = SPHERE_NETWORKS.testnet2;

/**
 * Least-privilege permissions.
 *
 * The arcade only needs to know WHO the player is — that is the whole point of
 * Task 2 ("the wallet provides the player's identity"). We deliberately do NOT
 * request balance, token, transfer or DM scopes. Requesting less means the wallet
 * approval screen is smaller and players are far more likely to accept.
 *
 * NOTE: `identity:read` alone is enough for login. `events:subscribe` is what lets
 * the wallet push `identity:changed` so the HUD can follow an address switch.
 */
export const ARCADE_PERMISSIONS: PermissionScope[] = [
  PERMISSION_SCOPES.IDENTITY_READ,
  PERMISSION_SCOPES.EVENTS_SUBSCRIBE,
];

/** Metadata shown on the wallet's approval screen. */
export function getDappMetadata(): DAppMetadata {
  return {
    name: 'Unicity Arcade',
    description: 'Free-to-play browser multiplayer arcade on Unicity.',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000',
  };
}

/** localStorage key used to resume a session without re-prompting the user. */
export const SESSION_STORAGE_KEY = 'unicity-arcade:sphere-session-id';
