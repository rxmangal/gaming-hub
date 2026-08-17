/**
 * Per-game Top 30 leaderboards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SHAPES OF BOARD, ONE API
 *
 * The four cabinets do not measure the same thing, so a single "score" column would
 * be a lie:
 *   - Chess and Tic-Tac-Toe are versus games. What matters is a win/loss/draw record,
 *     aggregated from the `match_results` table.
 *   - Neon Nexus (match-3) and Block Dash (runner) are solo games. What matters is a
 *     single high score, taken from the `solo_scores` table.
 *
 * `fetchGameLeaderboard()` hides that split from the UI, and every entry carries a
 * `modeLabel` so a row can say HOW it was earned (e.g. "AI · hard" vs "Online").
 * Ranking an AI win next to a human win without saying which is which would make the
 * ladder meaningless.
 *
 * ONE ROW PER PLAYER
 * Both boards de-duplicate by wallet. Without that, a solo board is one strong player
 * repeated thirty times, which tells you nothing.
 *
 * LOCAL MULTIPLAYER IS EXCLUDED
 * Two humans sharing one device also share one wallet, so a "win" there is not a win
 * for a specific person. `recordMatch()` already refuses to upload those, and the
 * query below filters `mode = 'local'` again as a defence in depth.
 *
 * REQUIRES A BACKEND
 * These are the only screens in the arcade that genuinely cannot work offline. With no
 * Supabase keys, every fetch returns `{ kind: 'unavailable' }` so the UI can explain
 * itself instead of showing a broken panel.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getSupabase, isOnlineConfigured } from './supabase';

/** Every game that has a board. Mirrors the ids in src/lib/games.ts — never rename. */
export type LeaderboardGameId = 'chess' | 'tic-tac-toe' | 'match-3' | 'runner';

/** Which of the two board shapes a game uses. */
export type BoardKind = 'versus' | 'solo';

export const BOARD_KIND: Record<LeaderboardGameId, BoardKind> = {
  chess: 'versus',
  'tic-tac-toe': 'versus',
  'match-3': 'solo',
  runner: 'solo',
};

/** Top 30, as specified. Exported so the UI can label itself without hardcoding 30. */
export const LEADERBOARD_LIMIT = 30;

export interface VersusRecord {
  wins: number;
  losses: number;
  draws: number;
  played: number;
}

export interface LeaderboardEntry {
  /** 1-based position after sorting. Computed here so the UI never has to guess. */
  rank: number;
  chainPubkey: string;
  /** Wallet nametag when the player has one, else a truncated address. */
  displayName: string;
  /** The ranking number: wins for a versus board, high score for a solo board. */
  value: number;
  /** Versus boards only. */
  record?: VersusRecord;
  /** How it was earned — "AI · hard", "Online", "Solo". */
  modeLabel: string;
}

export type LeaderboardState =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'ready'; entries: LeaderboardEntry[] }
  | { kind: 'error'; message: string };

/**
 * How many raw match rows to pull before aggregating in the browser.
 *
 * Wins are tallied client-side so that backend setup stays a copy-paste CREATE TABLE
 * with no SQL views or functions for a non-programmer to maintain.
 *
 * THE HONEST TRADE-OFF: past this many rows for a single game, the board reflects only
 * the most recent window of matches rather than all history. For an arcade ladder that
 * is acceptable, and it can be swapped for a SQL view later without touching this
 * module's callers.
 */
const MATCH_SCAN_LIMIT = 4000;

/**
 * Over-fetch factor for solo boards.
 *
 * `solo_scores` holds one row per run, so the top N rows can easily all belong to a
 * handful of players. Pulling several times the limit makes it very likely we can still
 * fill 30 distinct wallets after de-duplication.
 */
const SOLO_OVERFETCH = 10;

/** Rows we read from `match_results`. */
interface MatchRow {
  chain_pubkey: string;
  display_name: string | null;
  outcome: string;
  mode: string | null;
  difficulty: string | null;
}

/** Rows we read from `solo_scores`. */
interface SoloRow {
  chain_pubkey: string;
  display_name: string | null;
  score: number;
}

/** A wallet address is long; show enough to be recognisable but keep the row narrow. */
export function shortAddress(chainPubkey: string): string {
  if (chainPubkey.length <= 14) return chainPubkey;
  return `${chainPubkey.slice(0, 8)}…${chainPubkey.slice(-4)}`;
}

/** Human label for one match's mode + difficulty. */
function labelFor(mode: string | null, difficulty: string | null): string {
  if (mode === 'ai') return difficulty ? `AI · ${difficulty}` : 'AI';
  if (mode === 'online') return 'Online';
  if (mode === 'local') return 'Local';
  return 'Unknown';
}

/** Picks the label a player used most often, so the row reflects how they mainly play. */
function dominantLabel(counts: Map<string, number>): string {
  let best = 'Unknown';
  let bestCount = -1;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Top 30 by wins for a versus game.
 *
 * Ties break on fewer losses, then on fewer games played — so a tidy 5-1 record
 * outranks a scrappy 5-9 one instead of the order being arbitrary.
 */
async function fetchVersusBoard(
  gameId: LeaderboardGameId,
  limit: number,
): Promise<LeaderboardState> {
  const supabase = getSupabase();
  if (!supabase) return { kind: 'unavailable' };

  const { data, error } = await supabase
    .from('match_results')
    .select('chain_pubkey, display_name, outcome, mode, difficulty')
    .eq('game_id', gameId)
    .neq('mode', 'local') // defence in depth; see the header note
    .order('created_at', { ascending: false })
    .limit(MATCH_SCAN_LIMIT);

  if (error) return { kind: 'error', message: error.message };
  if (!data) return { kind: 'ready', entries: [] };

  interface Bucket {
    chainPubkey: string;
    displayName: string;
    record: VersusRecord;
    modes: Map<string, number>;
  }

  const buckets = new Map<string, Bucket>();

  for (const row of data as MatchRow[]) {
    if (typeof row.chain_pubkey !== 'string' || row.chain_pubkey.length === 0) continue;

    let bucket = buckets.get(row.chain_pubkey);
    if (!bucket) {
      bucket = {
        chainPubkey: row.chain_pubkey,
        // Rows arrive newest-first, so the first name we see is the most recent one
        // this wallet used. Later (older) rows must not overwrite it.
        displayName: row.display_name?.trim() || shortAddress(row.chain_pubkey),
        record: { wins: 0, losses: 0, draws: 0, played: 0 },
        modes: new Map(),
      };
      buckets.set(row.chain_pubkey, bucket);
    }

    bucket.record.played += 1;
    if (row.outcome === 'win') bucket.record.wins += 1;
    else if (row.outcome === 'loss') bucket.record.losses += 1;
    else if (row.outcome === 'draw') bucket.record.draws += 1;

    const label = labelFor(row.mode, row.difficulty);
    bucket.modes.set(label, (bucket.modes.get(label) ?? 0) + 1);
  }

  const entries = [...buckets.values()]
    .sort((a, b) => {
      if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
      if (a.record.losses !== b.record.losses) return a.record.losses - b.record.losses;
      return a.record.played - b.record.played;
    })
    .slice(0, limit)
    .map((bucket, index) => ({
      rank: index + 1,
      chainPubkey: bucket.chainPubkey,
      displayName: bucket.displayName,
      value: bucket.record.wins,
      record: bucket.record,
      modeLabel: dominantLabel(bucket.modes),
    }));

  return { kind: 'ready', entries };
}

/** Top 30 high scores for a solo game, one row per wallet. */
async function fetchSoloBoard(
  gameId: LeaderboardGameId,
  limit: number,
): Promise<LeaderboardState> {
  const supabase = getSupabase();
  if (!supabase) return { kind: 'unavailable' };

  const { data, error } = await supabase
    .from('solo_scores')
    .select('chain_pubkey, display_name, score')
    .eq('game_id', gameId)
    .order('score', { ascending: false })
    .limit(limit * SOLO_OVERFETCH);

  if (error) return { kind: 'error', message: error.message };
  if (!data) return { kind: 'ready', entries: [] };

  const best = new Map<string, { chainPubkey: string; displayName: string; score: number }>();

  for (const row of data as SoloRow[]) {
    if (typeof row.chain_pubkey !== 'string' || row.chain_pubkey.length === 0) continue;
    if (typeof row.score !== 'number' || !Number.isFinite(row.score)) continue;

    const current = best.get(row.chain_pubkey);
    if (!current || row.score > current.score) {
      best.set(row.chain_pubkey, {
        chainPubkey: row.chain_pubkey,
        displayName: row.display_name?.trim() || shortAddress(row.chain_pubkey),
        score: row.score,
      });
    }
  }

  const entries = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      chainPubkey: row.chainPubkey,
      displayName: row.displayName,
      value: row.score,
      // These two games have no difficulty setting, so claiming one would be invented
      // detail. "Solo" is the whole truth about how the score was earned.
      modeLabel: 'Solo',
    }));

  return { kind: 'ready', entries };
}

/**
 * Fetches one game's board.
 *
 * Never throws: the leaderboard is a side panel, and a network hiccup must surface as a
 * retryable message rather than an unhandled rejection.
 */
export async function fetchGameLeaderboard(
  gameId: LeaderboardGameId,
  limit: number = LEADERBOARD_LIMIT,
): Promise<LeaderboardState> {
  if (!isOnlineConfigured()) return { kind: 'unavailable' };

  try {
    return BOARD_KIND[gameId] === 'versus'
      ? await fetchVersusBoard(gameId, limit)
      : await fetchSoloBoard(gameId, limit);
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Request failed.',
    };
  }
}

/** Which table a game's rows land in — used to scope the realtime subscription. */
export function tableFor(gameId: LeaderboardGameId): 'match_results' | 'solo_scores' {
  return BOARD_KIND[gameId] === 'versus' ? 'match_results' : 'solo_scores';
}

/**
 * Live board updates via Postgres change events.
 *
 * WHY THIS IS BEST-EFFORT: `postgres_changes` only fires if the table has been added to
 * the `supabase_realtime` publication (see step 5 of the README). If that step was
 * skipped the callback simply never fires and the board still works — it just needs a
 * manual refresh. Failing loudly here would punish the common case for an optional
 * optimisation.
 *
 * Returns an unsubscribe function; call it on unmount.
 */
export function subscribeToLeaderboard(
  gameId: LeaderboardGameId,
  onChange: () => void,
): () => void {
  if (!isOnlineConfigured()) return () => undefined;

  const supabase = getSupabase();
  if (!supabase) return () => undefined;

  const table = tableFor(gameId);

  const channel = supabase
    .channel(`leaderboard:${gameId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table, filter: `game_id=eq.${gameId}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
