/**
 * Solo score persistence.
 *
 * DESIGN: RESULTS ONLY, NEVER FRAMES.
 * Match-3 and Runner are single-player, so there is nothing to synchronise while playing.
 * Streaming per-frame state to a server would add latency, cost and failure modes for no
 * gameplay benefit. One write happens, once, when a run ends. The games stay fully
 * playable with the network unplugged.
 *
 * LOCAL-FIRST, REMOTE-OPTIONAL:
 *   - The personal best always lands in localStorage, so it survives a refresh even with
 *     no backend configured at all.
 *   - If Supabase credentials exist, the result is ALSO posted to a shared leaderboard.
 *     A failure there is swallowed deliberately: losing a leaderboard row must never
 *     cost the player their local best or interrupt the end-of-run screen.
 *
 * IDENTITY: rows are keyed by `chainPubkey` — the wallet identity. No separate accounts,
 * no email, no password. The wallet the player connected with IS their arcade profile.
 */

import { getSupabase, isOnlineConfigured } from './supabase';

/** Games that record a solo score. */
export type SoloGameId = 'match-3' | 'runner';

export interface SoloRun {
  gameId: SoloGameId;
  score: number;
  /** Free-form per-game detail (distance, shards, cascades…). Stored as JSON. */
  detail: Record<string, number>;
}

export interface PersonalBest {
  score: number;
  achievedAt: number;
}

const KEY_PREFIX = 'unicity-arcade:best:';

/** localStorage key, scoped per game AND per wallet, so two players can share a browser. */
const bestKey = (gameId: SoloGameId, chainPubkey: string) =>
  `${KEY_PREFIX}${gameId}:${chainPubkey.slice(0, 24)}`;

/**
 * Reads the stored personal best.
 *
 * Every access is wrapped: localStorage throws in private-browsing modes and when a
 * storage quota is exceeded. A crash here would take down the results screen, so a
 * missing best is treated as "no best yet".
 */
export function readPersonalBest(
  gameId: SoloGameId,
  chainPubkey: string,
): PersonalBest | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(bestKey(gameId, chainPubkey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as PersonalBest).score === 'number'
    ) {
      return parsed as PersonalBest;
    }
    return null;
  } catch {
    return null;
  }
}

/** Writes a new best only if it beats the old one. Returns true when it was a record. */
export function writePersonalBest(
  gameId: SoloGameId,
  chainPubkey: string,
  score: number,
): boolean {
  if (typeof window === 'undefined') return false;
  const current = readPersonalBest(gameId, chainPubkey);
  if (current && current.score >= score) return false;
  try {
    window.localStorage.setItem(
      bestKey(gameId, chainPubkey),
      JSON.stringify({ score, achievedAt: Date.now() } satisfies PersonalBest),
    );
    return true;
  } catch {
    // Storage unavailable. The run still counted on screen; only persistence is lost.
    return false;
  }
}

export interface SubmitOutcome {
  /** True when this run beat the player's stored best. */
  isRecord: boolean;
  /** Whether the row reached the shared leaderboard. */
  remote: 'sent' | 'skipped' | 'failed';
}

/**
 * Records a finished run.
 *
 * Never throws and never rejects — it is called from a game-over handler where an
 * exception would blank the results panel the player is trying to read.
 */
export async function submitSoloRun(
  run: SoloRun,
  player: { chainPubkey: string; displayName: string },
): Promise<SubmitOutcome> {
  const isRecord = writePersonalBest(run.gameId, player.chainPubkey, run.score);

  if (!isOnlineConfigured()) return { isRecord, remote: 'skipped' };

  try {
    const supabase = getSupabase();
    if (!supabase) return { isRecord, remote: 'skipped' };

    const { error } = await supabase.from('solo_scores').insert({
      game_id: run.gameId,
      chain_pubkey: player.chainPubkey,
      display_name: player.displayName,
      score: run.score,
      detail: run.detail,
    });

    return { isRecord, remote: error ? 'failed' : 'sent' };
  } catch {
    return { isRecord, remote: 'failed' };
  }
}
