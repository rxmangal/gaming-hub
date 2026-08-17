'use client';

/**
 * Sphere Wallet Provider — the arcade's single source of truth for player identity.
 *
 * Verified against @unicitylabs/sphere-sdk@0.14.9:
 *   - `autoConnect({ dapp, walletUrl, permissions, network, silent, resumeSessionId })`
 *      from '@unicitylabs/sphere-sdk/connect/browser'
 *   - Returns `{ client, connection, transport, disconnect }`
 *   - `client.on(WALLET_EVENTS.*, handler)` returns an unsubscribe function
 *   - `WALLET_EVENTS` = wallet:locked | wallet:unlocked | wallet:disconnected | identity:changed
 *   - `PublicIdentity` = { chainPubkey, directAddress?, nametag? }
 *
 * Protocol rules this file deliberately honours (straight from the SDK's own docs):
 *   1. A LOCKED wallet is still CONNECTED. We must NOT disconnect, must NOT clear the
 *      session id, and must NOT re-handshake. We wait for `wallet:unlocked`.
 *   2. `wallet:disconnected` means the session is GONE. Only then do we clear the session.
 *   3. `identity:changed` can hand us a different player — the HUD must follow it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { WALLET_EVENTS, type PublicIdentity } from '@unicitylabs/sphere-sdk/connect';
import type {
  AutoConnectResult,
  DetectedTransport,
} from '@unicitylabs/sphere-sdk/connect/browser';

import {
  ARCADE_NETWORK,
  ARCADE_PERMISSIONS,
  SESSION_STORAGE_KEY,
  WALLET_URL,
  getDappMetadata,
} from '@/lib/sphere-config';
import { normalizeWalletError, type NormalizedWalletError } from '@/lib/wallet-errors';

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

/**
 * The five states required by the brief, plus `restoring`.
 *
 * `restoring` exists because on a page reload we try a SILENT reconnect. Without a
 * distinct state the UI would flash the "Connect Wallet" gate for a moment and then
 * snap to the lobby, which looks broken.
 */
export type WalletStatus =
  | 'disconnected'
  | 'restoring'
  | 'connecting'
  | 'connected'
  | 'rejected'
  | 'failed';

export interface WalletPlayer {
  /** Stable, unique player id. This is the arcade's canonical identity key. */
  chainPubkey: string;
  directAddress?: string;
  /** Human-friendly Unicity ID (e.g. "@ace") when the player has registered one. */
  nametag?: string;
  /** Best display label: nametag if present, else a truncated pubkey. */
  displayName: string;
}

export interface WalletContextValue {
  status: WalletStatus;
  /** Non-null only while status === 'connected'. */
  player: WalletPlayer | null;
  /** True when the wallet is locked but the session is still alive. */
  isLocked: boolean;
  /** Populated when status is 'rejected' or 'failed'. */
  error: NormalizedWalletError | null;
  /** Which transport the SDK selected: iframe | extension | popup. */
  transport: DetectedTransport | null;
  sessionId: string | null;
  /** Convenience flag for gating the arcade. */
  isConnected: boolean;
  /** Opens the wallet approval flow. Safe to call repeatedly. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Clears an error and returns to the gate without opening the wallet. */
  reset: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function truncatePubkey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function toPlayer(identity: PublicIdentity): WalletPlayer {
  return {
    chainPubkey: identity.chainPubkey,
    directAddress: identity.directAddress,
    nametag: identity.nametag,
    displayName: identity.nametag ?? truncatePubkey(identity.chainPubkey),
  };
}

/** Narrowing guard for the `identity:changed` / `wallet:unlocked` event payloads. */
function asPublicIdentity(data: unknown): PublicIdentity | null {
  if (typeof data === 'object' && data !== null && 'chainPubkey' in data) {
    const key = (data as { chainPubkey: unknown }).chainPubkey;
    if (typeof key === 'string' && key.length > 0) return data as PublicIdentity;
  }
  return null;
}

function readStoredSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSession(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(SESSION_STORAGE_KEY, id);
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* Private browsing / storage disabled — session resume is a nicety, not a requirement. */
  }
}

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('disconnected');
  const [player, setPlayer] = useState<WalletPlayer | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState<NormalizedWalletError | null>(null);
  const [transport, setTransport] = useState<DetectedTransport | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /** Live SDK handle. Held in a ref because it is not render state. */
  const sessionRef = useRef<AutoConnectResult | null>(null);
  /** Unsubscribe callbacks for wallet events. */
  const listenersRef = useRef<Array<() => void>>([]);
  /** Guards against overlapping connect() calls (double-clicked button). */
  const inFlightRef = useRef(false);
  /** Set on unmount so late async callbacks cannot touch dead state. */
  const unmountedRef = useRef(false);

  const detachListeners = useCallback(() => {
    for (const off of listenersRef.current) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    listenersRef.current = [];
  }, []);

  /** Local teardown. Does NOT talk to the wallet — used when the wallet hung up on us. */
  const teardown = useCallback(
    (nextStatus: WalletStatus) => {
      detachListeners();
      sessionRef.current = null;
      writeStoredSession(null);
      if (unmountedRef.current) return;
      setSessionId(null);
      setPlayer(null);
      setIsLocked(false);
      setTransport(null);
      setStatus(nextStatus);
    },
    [detachListeners],
  );

  /**
   * Wires the four wallet lifecycle events.
   *
   * The lock/unlock pair is the subtle one: a locked wallet keeps its session, so we
   * only flip a flag. Tearing down here would strand the player.
   */
  const attachListeners = useCallback(
    (active: AutoConnectResult) => {
      const { client } = active;

      listenersRef.current.push(
        client.on(WALLET_EVENTS.LOCKED, () => {
          if (unmountedRef.current) return;
          // Still connected — session is alive. Just reflect it in the HUD.
          setIsLocked(true);
        }),
      );

      listenersRef.current.push(
        client.on(WALLET_EVENTS.UNLOCKED, (data) => {
          if (unmountedRef.current) return;
          setIsLocked(false);
          // Unlock is NOT guaranteed to be the same wallet — the payload carries the
          // CURRENT identity. Adopt it so we never render a stale player.
          const payload =
            typeof data === 'object' && data !== null && 'identity' in data
              ? asPublicIdentity((data as { identity: unknown }).identity)
              : null;
          if (payload) setPlayer(toPlayer(payload));
        }),
      );

      listenersRef.current.push(
        client.on(WALLET_EVENTS.IDENTITY_CHANGED, (data) => {
          if (unmountedRef.current) return;
          const identity = asPublicIdentity(data);
          if (identity) setPlayer(toPlayer(identity));
        }),
      );

      listenersRef.current.push(
        client.on(WALLET_EVENTS.DISCONNECTED, () => {
          // The session is GONE. This is the only event that clears it.
          teardown('disconnected');
        }),
      );
    },
    [teardown],
  );

  /** Shared connect path for both the silent restore and the explicit button press. */
  const runConnect = useCallback(
    async (silent: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const resumeSessionId = readStoredSession() ?? undefined;

      if (!unmountedRef.current) {
        setError(null);
        setStatus(silent ? 'restoring' : 'connecting');
      }

      try {
        // Loaded lazily: this subpath touches `window` at module scope, so it must never
        // be pulled into the server bundle during SSR/prerender.
        const { autoConnect } = await import('@unicitylabs/sphere-sdk/connect/browser');

        const active = await autoConnect({
          dapp: getDappMetadata(),
          walletUrl: WALLET_URL,
          permissions: ARCADE_PERMISSIONS,
          network: ARCADE_NETWORK,
          silent,
          resumeSessionId,
        });

        // Unmounted (or disconnected) while the wallet was open — clean up, don't leak.
        if (unmountedRef.current) {
          void active.disconnect().catch(() => undefined);
          return;
        }

        sessionRef.current = active;
        attachListeners(active);

        setPlayer(toPlayer(active.connection.identity));
        setSessionId(active.connection.sessionId);
        setTransport(active.transport);
        // A resume during a lock succeeds and reports `locked: true`.
        setIsLocked(active.connection.locked === true);
        setStatus('connected');
        writeStoredSession(active.connection.sessionId);
      } catch (err) {
        // A silent attempt failing is the normal case for a first-time visitor.
        // It must never surface as an error — just show the gate.
        if (silent) {
          writeStoredSession(null);
          if (!unmountedRef.current) setStatus('disconnected');
          return;
        }

        const normalized = normalizeWalletError(err);
        writeStoredSession(null);
        if (unmountedRef.current) return;
        setError(normalized);
        setStatus(normalized.kind === 'rejected' ? 'rejected' : 'failed');
      } finally {
        inFlightRef.current = false;
      }
    },
    [attachListeners],
  );

  const connect = useCallback(() => runConnect(false), [runConnect]);

  const disconnect = useCallback(async () => {
    const active = sessionRef.current;
    // Tear down local state first so the UI responds instantly.
    teardown('disconnected');
    setError(null);
    if (active) {
      try {
        await active.disconnect();
      } catch {
        /* The wallet may already be gone; local state is authoritative for the UI. */
      }
    }
  }, [teardown]);

  const reset = useCallback(() => {
    setError(null);
    setStatus('disconnected');
  }, []);

  /**
   * On mount: try a SILENT reconnect, but only if the wallet already approved this
   * origin (i.e. we hold a session id). `silent: true` guarantees no popup, so this
   * can never hijack the page on first visit.
   */
  useEffect(() => {
    unmountedRef.current = false;

    if (readStoredSession()) {
      void runConnect(true);
    }

    return () => {
      unmountedRef.current = true;
      detachListeners();
      sessionRef.current = null;
    };
    // Intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      player,
      isLocked,
      error,
      transport,
      sessionId,
      isConnected: status === 'connected' && player !== null,
      connect,
      disconnect,
      reset,
    }),
    [status, player, isLocked, error, transport, sessionId, connect, disconnect, reset],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Access the wallet. Throws if used outside the provider so mistakes fail loudly. */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet() must be called inside <WalletProvider>.');
  }
  return ctx;
}
