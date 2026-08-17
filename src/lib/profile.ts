/**
 * Player profile statistics.
 *
 * IDENTITY: every stat is keyed by the Sphere `chainPubkey`. The wallet IS the account,
 * so there is nothing to sign up for and nothing to log into. Connect the same wallet on
 * another device and (once the optional leaderboard is configured) the history follows.
 *
 * LOCAL-FIRST, REMOTE-OPTIONAL — the same rule the solo scores follow:
 *   - Every finished match is written to localStorage immediately. This is the copy the
 *     profile page reads, so the page works with no backend, offline, forever.
 *   - If Supabase keys exist, the result is ALSO posted to a shared table so the global
 *     leaderboard can see it. That write is fire-and-forget: a failed network call must
 *     never cost the player their local record or block the UI.
 *
 * WHY ONE BLOB PER WALLET, NOT A ROW PER MATCH
 * A profile only ever needs aggregates plus a short recent list. Storing one small JSON
 * object means reading the profile is a single synchronous localStorage hit with no
 * parsing loop over hundreds of rows, and it cannot grow without bound — `recent` is
 * capped. The full history lives in Supabase for anyone who wants it.
 */

import { getSupabase, isOnlineConfigured } from './supabase';
import { type SoloGameId, readPersonalBest } from './scores';

/** Games that produce a win/loss/draw. */
export type VersusGameId = 'chess' | 'tic-tac-toe';

/** Every game in the arcade, for the `perGame` map. */
export type AnyGameId = VersusGameId | SoloGameId;

export type MatchOutcome = 'win' | 'loss' | 'draw';

/** How the match was played. Solo-vs-AI results are tracked separately from human games. */
export type MatchMode = 'ai' | 'local' | 'online';

export interface MatchRecord {
  gameId: VersusGameId;
  mode: MatchMode;
  outcome: MatchOutcome;
  /** AI difficulty, when mode === 'ai'. */
  difficulty?: string;
  endedAt: number;
}

export interface GameStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface ProfileStats {
  totals: GameStats;
  perGame: Partial<Record<AnyGameId, GameStats>>;
  /** Most recent matches, newest first. Capped — see RECENT_LIMIT. */
  recent: MatchRecord[];
  /** Highest score per solo game, read from the solo-score store. */
  soloBests: Partial<Record<SoloGameId, number>>;
  /** First time we ever recorded anything for this wallet. */
  firstSeen: number | null;
}

/**
 * How many recent matches to keep on-device.
 *
 * 30 is enough to fill a "recent form" strip without letting a heavy player's blob grow
 * large enough to slow down the synchronous localStorage read.
 */
const RECENT_LIMIT = 30;

const KEY_PREFIX = 'unicity-arcade:profile:';

/** Pubkeys are long; 24 chars is collision-safe here and keeps the key readable. */
const profileKey = (chainPubkey: string) => `${KEY_PREFIX}${chainPubkey.slice(0, 24)}`;

const emptyStats = (): GameStats => ({ played: 0, wins: 0, losses: 0, draws: 0 });

/** The shape actually persisted. Kept separate so `soloBests` is never stored twice. */
interface StoredProfile {
  totals: GameStats;
  perGame: Partial<Record<AnyGameId, GameStats>>;
  recent: MatchRecord[];
  firstSeen: number;
}

function isGameStats(value: unknown): value is GameStats {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.played === 'number' &&
    typeof v.wins === 'number' &&
    typeof v.losses === 'number' &&
    typeof v.draws === 'number'
  );
}

/**
 * Reads and validates the stored blob.
 *
 * Everything is defensive: localStorage can hold anything a previous version (or a
 * curious user with devtools) put there. A malformed blob is treated as "no history"
 * rather than being allowed to throw and blank the profile page.
 */
function readStored(chainPubkey: string): StoredProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(profileKey(chainPubkey));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;

    if (!isGameStats(p.totals)) return null;

    const perGame: Partial<Record<AnyGameId, GameStats>> = {};
    if (typeof p.perGame === 'object' && p.perGame !== null) {
      for (const [key, value] of Object.entries(p.perGame as Record<string, unknown>)) {
        if (isGameStats(value)) perGame[key as AnyGameId] = value;
      }
    }

    const recent = Array.isArray(p.recent)
      ? (p.recent as unknown[])
          .filter((r): r is MatchRecord => {
            if (typeof r !== 'object' || r === null) return false;
            const m = r as Record<string, unknown>;
            return (
              typeof m.gameId === 'string' &&
              typeof m.outcome === 'string' &&
              typeof m.endedAt === 'number'
            );
          })
          .slice(0, RECENT_LIMIT)
      : [];

    return {
      totals: p.totals,
      perGame,
      recent,
      firstSeen: typeof p.firstSeen === 'number' ? p.firstSeen : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeStored(chainPubkey: string, profile: StoredProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(profileKey(chainPubkey), JSON.stringify(profile));
  } catch {
    /* Storage full or private mode. The match still showed on screen; only history is lost. */
  }
}

/**
 * Builds the view model the profile page renders.
 *
 * Solo bests are pulled live from the solo-score store rather than duplicated here, so
 * there is exactly one source of truth for a high score.
 */
export function readProfileStats(chainPubkey: string): ProfileStats {
  const stored = readStored(chainPubkey);

  const soloBests: Partial<Record<SoloGameId, number>> = {};
  for (const id of ['match-3', 'runner'] as SoloGameId[]) {
    const best = readPersonalBest(id, chainPubkey);
    if (best) soloBests[id] = best.score;
  }

  if (!stored) {
    return {
      totals: emptyStats(),
      perGame: {},
      recent: [],
      soloBests,
      firstSeen: null,
    };
  }

  return {
    totals: stored.totals,
    perGame: stored.perGame,
    recent: stored.recent,
    soloBests,
    firstSeen: stored.firstSeen,
  };
}

/** Applies one result to a stats bucket. */
function applyOutcome(stats: GameStats, outcome: MatchOutcome): GameStats {
  return {
    played: stats.played + 1,
    wins: stats.wins + (outcome === 'win' ? 1 : 0),
    losses: stats.losses + (outcome === 'loss' ? 1 : 0),
    draws: stats.draws + (outcome === 'draw' ? 1 : 0),
  };
}

/**
 * Records a finished versus match.
 *
 * Never throws — it is called from a render-time effect in the game screens, where an
 * exception would unmount the board the player is looking at.
 *
 * NOTE ON LOCAL MULTIPLAYER: two humans on one device share one wallet, so a "win" there
 * is not a win for a specific person. Those matches are counted as `played` but their
 * outcome is stored as a draw for the win/loss columns, and they are excluded from the
 * global leaderboard entirely. Inflating a win count from pass-and-play would make the
 * leaderboard meaningless.
 */
export function recordMatch(
  chainPubkey: string,
  displayName: string,
  record: MatchRecord,
): void {
  const countable: MatchOutcome = record.mode === 'local' ? 'draw' : record.outcome;

  const existing = readStored(chainPubkey);
  const base: StoredProfile = existing ?? {
    totals: emptyStats(),
    perGame: {},
    recent: [],
    firstSeen: Date.now(),
  };

  const perGameCurrent = base.perGame[record.gameId] ?? emptyStats();

  const next: StoredProfile = {
    totals: applyOutcome(base.totals, countable),
    perGame: {
      ...base.perGame,
      [record.gameId]: applyOutcome(perGameCurrent, countable),
    },
    // Newest first, hard-capped so the blob can never grow without bound.
    recent: [record, ...base.recent].slice(0, RECENT_LIMIT),
    firstSeen: base.firstSeen,
  };

  writeStored(chainPubkey, next);

  // Only real opponents reach the shared table — see the note above.
  if (record.mode !== 'local') {
    void pushMatchRemote(chainPubkey, displayName, record);
  }
}

/** Counts a solo run as a game played. The score itself lives in the solo-score store. */
export function recordSoloPlay(chainPubkey: string, gameId: SoloGameId): void {
  const existing = readStored(chainPubkey);
  const base: StoredProfile = existing ?? {
    totals: emptyStats(),
    perGame: {},
    recent: [],
    firstSeen: Date.now(),
  };

  const current = base.perGame[gameId] ?? emptyStats();

  writeStored(chainPubkey, {
    ...base,
    // Solo runs add to "games played" but never to wins or losses — there is no opponent.
    totals: { ...base.totals, played: base.totals.played + 1 },
    perGame: { ...base.perGame, [gameId]: { ...current, played: current.played + 1 } },
  });
}

/** Fire-and-forget remote write. Silence on failure is deliberate. */
async function pushMatchRemote(
  chainPubkey: string,
  displayName: string,
  record: MatchRecord,
): Promise<void> {
  if (!isOnlineConfigured()) return;
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('match_results').insert({
      game_id: record.gameId,
      mode: record.mode,
      outcome: record.outcome,
      difficulty: record.difficulty ?? null,
      chain_pubkey: chainPubkey,
      display_name: displayName,
    });
  } catch {
    /* Leaderboard is a bonus, never a requirement. */
  }
}

/* ------------------------------------------------------------------ *
 * Global leaderboard
 * ------------------------------------------------------------------ */

export interface LeaderboardRow {
  chainPubkey: string;
  displayName: string;
  /** Wins for the versus board; high score for a solo board. */
  value: number;
  /** Only populated on the versus board. */
  played?: number;
}

export type LeaderboardState =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'ready'; rows: LeaderboardRow[] }
  | { kind: 'error'; message: string };

/**
 * How many raw match rows to pull before aggregating.
 *
 * We aggregate wins in the browser rather than in SQL so that setup stays a single
 * CREATE TABLE with no views, functions or migrations for a non-programmer to run. The
 * honest trade-off: past this many total matches the board reflects only the most recent
 * window. That is a fine property for an arcade ladder and can be swapped for a SQL view
 * later without touching the UI.
 */
const MATCH_SCAN_LIMIT = 2000;

/** Top players by wins, aggregated from the shared match table. */
export async function fetchWinLeaderboard(limit = 10): Promise<LeaderboardState> {
  if (!isOnlineConfigured()) return { kind: 'unavailable' };

  try {
    const supabase = getSupabase();
    if (!supabase) return { kind: 'unavailable' };

    const { data, error } = await supabase
      .from('match_results')
      .select('chain_pubkey, display_name, outcome')
      .order('created_at', { ascending: false })
      .limit(MATCH_SCAN_LIMIT);

    if (error) return { kind: 'error', message: error.message };
    if (!data) return { kind: 'ready', rows: [] };

    const tally = new Map<string, LeaderboardRow>();
    for (const row of data as Array<{
      chain_pubkey: string;
      display_name: string;
      outcome: string;
    }>) {
      if (typeof row.chain_pubkey !== 'string') continue;
      const entry =
        tally.get(row.chain_pubkey) ??
        {
          chainPubkey: row.chain_pubkey,
          displayName: row.display_name || 'Unnamed player',
          value: 0,
          played: 0,
        };
      entry.played = (entry.played ?? 0) + 1;
      if (row.outcome === 'win') entry.value += 1;
      // Keep the most recent name a player used.
      tally.set(row.chain_pubkey, entry);
    }

    const rows = [...tally.values()]
      .sort((a, b) => (b.value === a.value ? (b.played ?? 0) - (a.played ?? 0) : b.value - a.value))
      .slice(0, limit);

    return { kind: 'ready', rows };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Request failed.' };
  }
}

/** Top scores for one solo game. */
export async function fetchSoloLeaderboard(
  gameId: SoloGameId,
  limit = 10,
): Promise<LeaderboardState> {
  if (!isOnlineConfigured()) return { kind: 'unavailable' };

  try {
    const supabase = getSupabase();
    if (!supabase) return { kind: 'unavailable' };

    const { data, error } = await supabase
      .from('solo_scores')
      .select('chain_pubkey, display_name, score')
      .eq('game_id', gameId)
      .order('score', { ascending: false })
      .limit(limit * 4); // over-fetch: one player may hold several top rows

    if (error) return { kind: 'error', message: error.message };
    if (!data) return { kind: 'ready', rows: [] };

    // One row per player — their best. Without this the board is one strong player
    // repeated ten times, which tells you nothing.
    const best = new Map<string, LeaderboardRow>();
    for (const row of data as Array<{
      chain_pubkey: string;
      display_name: string;
      score: number;
    }>) {
      if (typeof row.chain_pubkey !== 'string' || typeof row.score !== 'number') continue;
      const current = best.get(row.chain_pubkey);
      if (!current || row.score > current.value) {
        best.set(row.chain_pubkey, {
          chainPubkey: row.chain_pubkey,
          displayName: row.display_name || 'Unnamed player',
          value: row.score,
        });
      }
    }

    const rows = [...best.values()].sort((a, b) => b.value - a.value).slice(0, limit);
    return { kind: 'ready', rows };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Request failed.' };
  }
}

/** Win rate as a whole percentage, ignoring draws. Returns null when there is no data. */
export function winRate(stats: GameStats): number | null {
  const decided = stats.wins + stats.losses;
  if (decided === 0) return null;
  return Math.round((stats.wins / decided) * 100);
}
