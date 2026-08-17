/**
 * Turns raw Sphere Connect failures into player-readable messages.
 *
 * Error codes are taken verbatim from `ERROR_CODES` in
 * `@unicitylabs/sphere-sdk@0.14.9` (dist/connect/index.d.ts).
 *
 * IMPORTANT (from the SDK docs): discriminate on the numeric `.code`, NOT on
 * `instanceof ConnectError` — bundlers can duplicate the class and break `instanceof`.
 */
import { ERROR_CODES } from '@unicitylabs/sphere-sdk/connect';

/** Distinguishes an explicit user "no" from a genuine technical fault. */
export type WalletFailureKind = 'rejected' | 'failed';

export interface NormalizedWalletError {
  kind: WalletFailureKind;
  /** Numeric Sphere Connect code when the wallet supplied one. */
  code: number | null;
  /** Short headline for the UI. */
  title: string;
  /** One-sentence explanation with a hint at the fix. */
  message: string;
}

/** Reads a numeric `.code` off an unknown thrown value without using `instanceof`. */
function readCode(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

function readMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export function normalizeWalletError(err: unknown): NormalizedWalletError {
  const code = readCode(err);
  const raw = readMessage(err);

  switch (code) {
    case ERROR_CODES.USER_REJECTED:
      return {
        kind: 'rejected',
        code,
        title: 'Connection declined',
        message: 'You declined the connection request in your Sphere wallet.',
      };

    case ERROR_CODES.INTENT_CANCELLED:
      return {
        kind: 'rejected',
        code,
        title: 'Request cancelled',
        message: 'The request was cancelled before the wallet could approve it.',
      };

    case ERROR_CODES.PERMISSION_DENIED:
      return {
        kind: 'rejected',
        code,
        title: 'Permission denied',
        message:
          'Your wallet did not grant the identity permission the arcade needs to sign you in.',
      };

    case ERROR_CODES.ORIGIN_BLOCKED:
      return {
        kind: 'rejected',
        code,
        title: 'Site blocked',
        message: 'Your wallet has blocked this site. Remove it from the blocked list to continue.',
      };

    case ERROR_CODES.WALLET_LOCKED:
      return {
        kind: 'failed',
        code,
        title: 'Wallet locked',
        message: 'Unlock your Sphere wallet, then connect again.',
      };

    case ERROR_CODES.SESSION_EXPIRED:
      return {
        kind: 'failed',
        code,
        title: 'Session expired',
        message: 'Your previous arcade session expired. Connect again to get a fresh one.',
      };

    case ERROR_CODES.INCOMPATIBLE_NETWORK:
      return {
        kind: 'failed',
        code,
        title: 'Wrong network',
        message:
          'Your wallet is on a different network. Switch it to Testnet2 (network id 4) and retry.',
      };

    case ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION:
      return {
        kind: 'failed',
        code,
        title: 'Wallet out of date',
        message: 'Your Sphere wallet is too old to talk to this arcade. Update it and retry.',
      };

    case ERROR_CODES.RATE_LIMITED:
      return {
        kind: 'failed',
        code,
        title: 'Too many attempts',
        message: 'Your wallet is rate-limiting requests. Wait a moment before retrying.',
      };

    case ERROR_CODES.NOT_CONNECTED:
      return {
        kind: 'failed',
        code,
        title: 'Wallet unavailable',
        message: 'The wallet is not available right now. Reload it and try again.',
      };

    default:
      break;
  }

  // No structured code: fall back to the message text thrown by autoConnect().
  // These strings are the literal ones in dist/impl/browser/connect/index.js.
  if (raw.includes('Failed to open wallet popup')) {
    return {
      kind: 'failed',
      code,
      title: 'Popup blocked',
      message: 'Your browser blocked the wallet popup. Allow popups for this site and retry.',
    };
  }

  if (raw.includes('popup was closed')) {
    return {
      kind: 'rejected',
      code,
      title: 'Wallet closed',
      message: 'The wallet window was closed before the connection completed.',
    };
  }

  if (raw.includes('did not respond in time') || raw.toLowerCase().includes('timeout')) {
    return {
      kind: 'failed',
      code,
      title: 'Wallet timed out',
      message: 'The wallet did not respond in time. Check it is loaded, then retry.',
    };
  }

  if (raw.includes('walletUrl is required')) {
    return {
      kind: 'failed',
      code,
      title: 'Arcade misconfigured',
      message: 'No wallet URL is configured. Set NEXT_PUBLIC_SPHERE_WALLET_URL and restart.',
    };
  }

  return {
    kind: 'failed',
    code,
    title: 'Connection failed',
    message: raw,
  };
}
