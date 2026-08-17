'use client';

/**
 * useRoom — real-time room management on Supabase Realtime.
 *
 * Design decisions worth knowing:
 *
 * 1. PRESENCE IS THE ROSTER. Supabase Presence already gives us join/leave with
 *    automatic cleanup when a socket dies (closed tab, dead wifi, crash). We do not
 *    maintain our own player table, so there are no ghost players to garbage-collect.
 *
 * 2. SEATS ARE DERIVED, NOT ASSIGNED. Both clients sort the presence roster by
 *    `joinedAt` (tie-broken by id) and take the index. That is deterministic, needs no
 *    host authority, and cannot deadlock if two players join in the same instant.
 *
 * 3. IDENTITY COMES FROM SPHERE. `presenceKey` is the player's `chainPubkey`, so a
 *    player cannot occupy two seats, and a reconnect reclaims the same seat.
 *
 * 4. READY STATE LIVES IN PRESENCE. Tracking `ready` as presence metadata means it is
 *    replicated automatically and reset correctly on disconnect.
 *
 * 5. SEQUENCED MESSAGES. Each sender stamps a monotonic `seq`; receivers drop stale or
 *    duplicate frames, which protects against Realtime's at-least-once delivery.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase, isOnlineConfigured } from '@/lib/supabase';
import { RT, type GameMessage, type RoomPlayer, type RoomStatus, type Seat } from './types';

/** Presence metadata each client publishes about itself. */
interface PresenceMeta {
  id: string;
  name: string;
  ready: boolean;
  joinedAt: number;
}

export interface UseRoomOptions {
  /** Namespaces the channel, e.g. 'ttt' or 'chess'. */
  gameId: string;
  /** Room code the players share. Null keeps the hook idle. */
  roomCode: string | null;
  /** Sphere chainPubkey. */
  playerId: string | null;
  playerName: string;
  /** Invoked for every accepted opponent message. */
  onMessage?: (msg: GameMessage) => void;
}

export interface UseRoomResult {
  status: RoomStatus;
  players: RoomPlayer[];
  /** This client's seat, or null before the roster settles. */
  mySeat: Seat | null;
  me: RoomPlayer | null;
  opponent: RoomPlayer | null;
  isReady: boolean;
  bothReady: boolean;
  error: string | null;
  /** True once two players are present and both ready. */
  setReady: (ready: boolean) => Promise<void>;
  send: <T>(type: string, payload: T) => Promise<void>;
  leave: () => Promise<void>;
}

/** Room codes: 4 chars, unambiguous alphabet (no O/0/I/1), easy to read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function useRoom({
  gameId,
  roomCode,
  playerId,
  playerName,
  onMessage,
}: UseRoomOptions): UseRoomResult {
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedAtRef = useRef<number>(Date.now());
  const readyRef = useRef(false);
  const seqRef = useRef(0);
  /** Highest seq seen per sender, for de-duplication. */
  const lastSeenSeqRef = useRef<Map<string, number>>(new Map());
  /** Keeps the latest onMessage without forcing a channel rebuild. */
  const onMessageRef = useRef(onMessage);
  const unmountedRef = useRef(false);

  /**
   * AUDIT FIX: `playerName` used to be a dependency of the subscribe effect below.
   *
   * A display name is not stable — the wallet may resolve a nametag a moment after
   * connecting, and `displayName` falls back to a truncated pubkey until it does. When
   * that string changed, the effect re-ran: it untracked presence, removed the channel and
   * rebuilt it from scratch. Mid-game that reads to the opponent as "player left, player
   * joined", can reshuffle seats (because `joinedAt` is reset), and drops any broadcast in
   * flight.
   *
   * The name is now held in a ref and pushed through `track()` as a presence update, so a
   * rename is just new metadata on a channel that never drops.
   */
  const playerNameRef = useRef(playerName);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    playerNameRef.current = playerName;
    // Re-publish presence so the opponent's roster picks up the new name. No-op before
    // the channel is subscribed, and harmless afterwards.
    const channel = channelRef.current;
    if (!channel || !playerId) return;
    void channel
      .track({
        id: playerId,
        name: playerName,
        ready: readyRef.current,
        joinedAt: joinedAtRef.current,
      } satisfies PresenceMeta)
      .catch(() => undefined);
  }, [playerName, playerId]);


  /**
   * Flattens Supabase's presence state into a deterministic, seat-assigned roster.
   * Both clients run identical logic on identical data, so they always agree.
   */
  const rebuildRoster = useCallback((channel: RealtimeChannel) => {
    const state = channel.presenceState<PresenceMeta>();

    const flat: PresenceMeta[] = [];
    for (const key of Object.keys(state)) {
      // A key can hold several metas if one player has multiple tabs open.
      // Take the earliest — the original session wins the seat.
      const metas = state[key];
      if (!metas || metas.length === 0) continue;
      const earliest = metas.reduce((a, b) => (a.joinedAt <= b.joinedAt ? a : b));
      if (typeof earliest.id === 'string' && earliest.id.length > 0) flat.push(earliest);
    }

    flat.sort((a, b) => (a.joinedAt === b.joinedAt ? a.id.localeCompare(b.id) : a.joinedAt - b.joinedAt));

    const roster: RoomPlayer[] = flat.slice(0, 2).map((meta, index) => ({
      id: meta.id,
      name: meta.name,
      seat: index as Seat,
      ready: meta.ready === true,
      joinedAt: meta.joinedAt,
    }));

    if (unmountedRef.current) return;
    setPlayers(roster);

    // Derive room status from the roster.
    if (roster.length < 2) {
      // Once an opponent has been seen and then vanishes, say so explicitly.
      setStatus((prev) => (prev === 'ready' || prev === 'lobby' ? 'opponent_left' : 'waiting'));
      return;
    }
    setStatus(roster.every((p) => p.ready) ? 'ready' : 'lobby');
  }, []);

  /** Subscribe when we have everything we need; tear down on any dependency change. */
  useEffect(() => {
    unmountedRef.current = false;

    if (!roomCode || !playerId) {
      setStatus('idle');
      setPlayers([]);
      return;
    }

    if (!isOnlineConfigured()) {
      setStatus('unavailable');
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setStatus('unavailable');
      return;
    }

    setStatus('connecting');
    setError(null);
    readyRef.current = false;
    seqRef.current = 0;
    lastSeenSeqRef.current.clear();
    joinedAtRef.current = Date.now();

    const channel = supabase.channel(`arcade:${gameId}:${roomCode}`, {
      config: {
        // Keying presence by Sphere id makes reconnects idempotent.
        presence: { key: playerId },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => rebuildRoster(channel))
      .on('presence', { event: 'join' }, () => rebuildRoster(channel))
      .on('presence', { event: 'leave' }, () => rebuildRoster(channel))
      .on('broadcast', { event: RT.GAME_ACTION }, ({ payload }) => {
        const msg = payload as GameMessage;
        if (!msg || typeof msg.from !== 'string') return;
        // Ignore our own echo and anything malformed.
        if (msg.from === playerId) return;

        const last = lastSeenSeqRef.current.get(msg.from) ?? -1;
        if (typeof msg.seq === 'number' && msg.seq <= last) return; // stale/duplicate
        if (typeof msg.seq === 'number') lastSeenSeqRef.current.set(msg.from, msg.seq);

        onMessageRef.current?.(msg);
      })
      .subscribe((subStatus) => {
        if (unmountedRef.current) return;

        if (subStatus === 'SUBSCRIBED') {
          const meta: PresenceMeta = {
            id: playerId,
            // Read through the ref: see the note on playerNameRef above.
            name: playerNameRef.current,
            ready: false,
            joinedAt: joinedAtRef.current,
          };
          void channel.track(meta);
          return;
        }


        if (subStatus === 'CHANNEL_ERROR') {
          setError('Realtime channel error. Check your Supabase URL and anon key.');
          setStatus('error');
          return;
        }

        if (subStatus === 'TIMED_OUT') {
          setError('Connection to the game server timed out.');
          setStatus('error');
        }
      });

    return () => {
      unmountedRef.current = true;
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) {
        // untrack() fires an immediate presence-leave so the opponent sees the drop
        // straight away rather than waiting for a heartbeat timeout.
        void ch.untrack().catch(() => undefined);
        void supabase.removeChannel(ch);
      }
    };
    // `playerName` is deliberately absent: it is read through playerNameRef so a rename
    // never rebuilds a live channel. Only identity and room location belong here.
  }, [gameId, roomCode, playerId, rebuildRoster]);

  const setReady = useCallback(
    async (ready: boolean) => {
      const channel = channelRef.current;
      if (!channel || !playerId) return;
      readyRef.current = ready;
      const meta: PresenceMeta = {
        id: playerId,
        name: playerNameRef.current,
        ready,
        joinedAt: joinedAtRef.current,
      };
      await channel.track(meta);
    },
    [playerId],
  );


  const send = useCallback(
    async <T,>(type: string, payload: T) => {
      const channel = channelRef.current;
      if (!channel || !playerId) return;
      const msg: GameMessage<T> = { from: playerId, seq: seqRef.current++, type, payload };
      await channel.send({ type: 'broadcast', event: RT.GAME_ACTION, payload: msg });
    },
    [playerId],
  );

  const leave = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    channelRef.current = null;
    const supabase = getSupabase();
    await channel.untrack().catch(() => undefined);
    if (supabase) await supabase.removeChannel(channel);
    setPlayers([]);
    setStatus('idle');
  }, []);

  const me = useMemo(() => players.find((p) => p.id === playerId) ?? null, [players, playerId]);
  const opponent = useMemo(
    () => players.find((p) => p.id !== playerId) ?? null,
    [players, playerId],
  );

  return {
    status,
    players,
    mySeat: me?.seat ?? null,
    me,
    opponent,
    isReady: me?.ready === true,
    bothReady: players.length === 2 && players.every((p) => p.ready),
    error,
    setReady,
    send,
    leave,
  };
}
