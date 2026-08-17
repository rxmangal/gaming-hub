/**
 * The arcade's game library.
 *
 * Presentation data only — no game logic lives here.
 * `span` drives the bento-box grid so tiles are deliberately unequal in size.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDs ARE DATA CONTRACTS — DO NOT RENAME THEM.
 *
 * `id` is not a label. It is used as:
 *   - the `game_id` column in the Supabase `solo_scores` and `match_results` tables,
 *   - part of the localStorage key for personal bests and profile stats.
 *
 * Renaming `runner` to `block-dash` would orphan every score row and every stored
 * best already on disk — the boards would silently read empty. So the internal ids
 * stay `runner` and `match-3` forever, and only `title` (what the player reads)
 * changes. Routes are likewise frozen at /play/runner and /play/match-3.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type GameStatus = 'soon' | 'alpha' | 'live';

/**
 * Which shelf a game sits on in the lobby.
 *
 * `featured` tiles render immediately; `extra` tiles stay hidden behind the
 * "Play More Games" toggle. This keeps the first screen focused on the two
 * head-to-head games without burying the arcade titles.
 */
export type GameTier = 'featured' | 'extra';

export interface ArcadeGame {
  /** Stable internal key. Also the DB/localStorage key — never change it. */
  id: string;
  /** User-facing name. Safe to change; nothing keys off this. */
  title: string;
  tagline: string;
  /** Emoji glyph used as the tile's art placeholder. */
  glyph: string;
  players: string;
  mode: string;
  status: GameStatus;
  /** Route to play. Null means the tile is not playable yet. */
  href: string | null;
  /** Tailwind classes controlling the tile's footprint in the bento grid. */
  span: string;
  /** Tailwind `from-*`/`to-*` stops for the tile's accent wash. */
  accent: string;
  /** Hex used for the glow ring so it can be applied inline. */
  glow: string;
  /** Shelf placement — see GameTier. */
  tier: GameTier;
}

export const ARCADE_GAMES: ArcadeGame[] = [
  {
    id: 'chess',
    title: 'Chess',
    tagline: 'Full rules. Single player, local or online — three AI difficulties.',
    glyph: '♞',
    players: '1v1 / Solo',
    mode: 'Turn-based',
    status: 'live',
    href: '/play/chess',
    span: 'md:col-span-2 md:row-span-2',
    accent: 'from-cyan-500/20 to-transparent',
    glow: '#06b6d4',
    tier: 'featured',
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic-Tac-Toe',
    tagline: 'Ten-second duels. Beat a friend, or try to beat the perfect AI.',
    glyph: '⛌',
    players: '1v1 / Solo',
    mode: 'Turn-based',
    status: 'live',
    href: '/play/tic-tac-toe',
    span: 'md:col-span-2 md:row-span-2',
    accent: 'from-fuchsia-500/20 to-transparent',
    glow: '#c026d3',
    tier: 'featured',
  },
  {
    // id stays 'match-3' — see the contract note at the top of this file.
    id: 'match-3',
    title: 'Neon Nexus',
    tagline: 'Thirty moves. Chain cascades for escalating multipliers.',
    glyph: '◈',
    players: 'Solo',
    mode: 'Real-time',
    status: 'live',
    href: '/play/match-3',
    span: 'md:col-span-2 md:row-span-1',
    accent: 'from-amber-500/20 to-transparent',
    glow: '#d97706',
    tier: 'extra',
  },
  {
    // id stays 'runner' — see the contract note at the top of this file.
    id: 'runner',
    title: 'Block Dash',
    tagline: 'Endless three-lane sprint. Jump, slide, survive.',
    glyph: '⏵',
    players: 'Solo',
    mode: 'Real-time',
    status: 'live',
    href: '/play/runner',
    span: 'md:col-span-2 md:row-span-1',
    accent: 'from-emerald-500/20 to-transparent',
    glow: '#059669',
    tier: 'extra',
  },
];

/** Tiles shown on first paint. */
export const FEATURED_GAMES = ARCADE_GAMES.filter((g) => g.tier === 'featured');

/** Tiles revealed by the "Play More Games" toggle. */
export const EXTRA_GAMES = ARCADE_GAMES.filter((g) => g.tier === 'extra');

/**
 * Display title for an internal id.
 *
 * Leaderboards, results screens and profile rows all store the internal id, so they
 * need this to render the current player-facing name. Falls back to the id itself so
 * an unknown/legacy key degrades to something visible rather than blank.
 */
export function gameTitle(id: string): string {
  return ARCADE_GAMES.find((g) => g.id === id)?.title ?? id;
}
