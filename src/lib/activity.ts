/**
 * Recent arcade activity — the last N wallets that connected.
 *
 * LOCAL-FIRST, REMOTE-OPTIONAL (same contract as scores.ts):
 *   - Every connect is appended to localStorage, so the list works with no backend.
 *   - If Supabase credentials exist, the connect is ALSO announced to a shared table,
 *     which is what makes the list show *other* players rather than just this browser.
 *
 * HONEST SCOPE — READ THIS BEFORE TRUSTING THE LIST:
 * With no Supabase keys configured, "recent activity" can only mean "wallets that
 * connected in THIS browser". It is not a global online-players feed in that mode. The
 * UI states which of the two it is showing rather than implying a busy arcade that
 * isn't there.
 *
 * PRIVACY: a wallet's public key is already public by nature, but it is still an
 * identifier. Only the truncated form is rendered; the full key is stored locally so
 * the same player can be de-duplicated across reconnects.
 */

import { getSupabase, isOnlineConfigured } from './supabase';

export interface ActivityEntry {
  chainPubkey: string;
  displayName: string;
  /** Epoch ms of the most recent connect for this wallet. */
  connectedAt: number;
}

/** How many entries the UI shows, and the hard cap on the stored blob. */
export const ACTIVITY_LIMIT = 10;

const STORAGE_KEY = 'unicity-arcade:recent-connects';

function readLocal(): ActivityEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ActivityEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as ActivityEntry).chainPubkey === 'string' &&
          typeof (e as ActivityEntry).connectedAt === 'number',
      )
      .slice(0, ACTIVITY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Records a connect locally and returns the updated list.
 *
 * De-duplicates by wallet: a player who reconnects five times moves to the top rather
 * than filling all ten rows. Never throws — localStorage is unavailable in some
 * private-browsing modes, and a missing activity list must not break the lobby.
 */
export function recordLocalConnect(player: {
  chainPubkey: string;
  displayName: string;
}): ActivityEntry[] {
  const entry: ActivityEntry = {
    chainPubkey: player.chainPubkey,
    displayName: player.displayName,
    connectedAt: Date.now(),
  };

  const next = [entry, ...readLocal().filter((e) => e.chainPubkey !== entry.chainPubkey)].slice(
    0,
    ACTIVITY_LIMIT,
  );

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the in-memory list returned below still renders.
    }
  }

  return next;
}

/** Announces this connect to the shared table. Silent no-op when offline/unconfigured. */
export async function announceConnect(player: {
  chainPubkey: string;
  displayName: string;
}): Promise<void> {
  if (!isOnlineConfigured()) return;
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('arcade_presence').upsert(
      {
        chain_pubkey: player.chainPubkey,
        display_name: player.displayName,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'chain_pubkey' },
    );
  } catch {
    // Presence is cosmetic. Failing to announce must never surface as an error.
  }
}

export type ActivityFeed =
  | { kind: 'local'; entries: ActivityEntry[] }
  | { kind: 'global'; entries: ActivityEntry[] };

/**
 * Loads the recent-connect feed.
 *
 * Returns `kind: 'global'` only when the shared table actually answered, so the UI can
 * label the list truthfully instead of guessing from the presence of env vars.
 */
export async function fetchRecentActivity(): Promise<ActivityFeed> {
  const local = readLocal();

  if (!isOnlineConfigured()) return { kind: 'local', entries: local };

  try {
    const supabase = getSupabase();
    if (!supabase) return { kind: 'local', entries: local };

    const { data, error } = await supabase
      .from('arcade_presence')
      .select('chain_pubkey, display_name, connected_at')
      .order('connected_at', { ascending: false })
      .limit(ACTIVITY_LIMIT);

    if (error || !data) return { kind: 'local', entries: local };

    return {
      kind: 'global',
      entries: data.map((row) => ({
        chainPubkey: String(row.chain_pubkey),
        displayName: String(row.display_name ?? 'player'),
        connectedAt: new Date(String(row.connected_at)).getTime(),
      })),
    };
  } catch {
    return { kind: 'local', entries: local };
  }
}

/** `unicity1abc…wxyz` — enough to identify a wallet without dumping 64 chars. */
export function truncateKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}…${key.slice(-6)}`;
}

/** Coarse relative time. Deliberately vague — exact timestamps add nothing here. */
export function relativeTime(epochMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
