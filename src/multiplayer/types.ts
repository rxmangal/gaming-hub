/**
 * Shared multiplayer types.
 *
 * Deliberately game-agnostic: the room layer moves opaque `payload` objects, so
 * Tic-Tac-Toe, Chess and future games all reuse the same transport.
 */

/** Room lifecycle as seen by the UI. */
export type RoomStatus =
  | 'idle' // nothing joined yet
  | 'unavailable' // Supabase env vars missing
  | 'connecting' // socket + channel subscribing
  | 'waiting' // in room, waiting for an opponent
  | 'ready' // both present, both marked ready -> game runs
  | 'lobby' // both present, at least one not ready
  | 'opponent_left' // opponent dropped
  | 'error';

/** Which side of the board a player owns. Seat 0 is the room's creator/host. */
export type Seat = 0 | 1;

export interface RoomPlayer {
  /** Sphere `chainPubkey` — the canonical player id across the whole arcade. */
  id: string;
  name: string;
  seat: Seat;
  ready: boolean;
  /** Wall-clock ms when this player joined; used to break seat ties. */
  joinedAt: number;
}

/** Broadcast envelope for a game action (a move, a rematch offer, a resignation). */
export interface GameMessage<T = unknown> {
  /** Sender's Sphere id — the receiver verifies this is the opponent. */
  from: string;
  /** Monotonic per-sender counter so out-of-order/duplicate frames are droppable. */
  seq: number;
  type: string;
  payload: T;
}

/** Realtime event names. Kept in one place so sender/receiver cannot drift. */
export const RT = {
  GAME_ACTION: 'game_action',
} as const;
