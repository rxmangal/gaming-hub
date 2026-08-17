'use client';

/**
 * Supabase Realtime client (browser only).
 *
 * We use ONLY the Realtime service — Presence for the player roster and Broadcast for
 * moves. There are no database tables and no SQL migrations to run, which keeps setup
 * to a two-line .env.local.
 *
 * The anon key is a public, browser-safe key by design.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True when online play is configured. Local + AI modes work without this. */
export const isOnlineConfigured = (): boolean => URL.length > 0 && ANON_KEY.length > 0;

let client: SupabaseClient | null = null;

/**
 * Lazy singleton. Returns null when env vars are absent so the UI can degrade
 * gracefully to "online unavailable" instead of crashing.
 */
export function getSupabase(): SupabaseClient | null {
  if (!isOnlineConfigured()) return null;
  if (client) return client;

  client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false },
    // Light throttle: plenty for turn-based games, avoids flooding the socket.
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}
