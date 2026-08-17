/**
 * The arcade's game library.
 *
 * Presentation data only — no game logic lives here.
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
 *
 * LAYOUT NOTE: every game is now shown on the lobby's first screen in one uniform
 * 2x2 grid. There is no longer a `span` field (tiles are deliberately equal-sized)
 * and no `tier` field (nothing is hidden behind a toggle). The grid geometry lives
 * entirely in ArcadeLobby.tsx, so tile sizing is a layout concern in one place
 * rather than data smeared across this file.
 */

export type GameStatus = 'soon' | 'alpha' | 'live';

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
  /** Tailwind `from-*`/`to-*` stops for the tile's accent wash. */
  accent: string;
  /** Hex used for the glow ring so it can be applied inline. */
  glow: string;
}

/**
 * Every cabinet in the arcade, in display order.
 *
 * Order matters: this is the exact order the 2x2 lobby grid paints, so the two
 * head-to-head games lead and the two solo arcade games follow.
 */
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
    accent: 'from-cyan-500/20 to-transparent',
    glow: '#06b6d4',
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
    accent: 'from-fuchsia-500/20 to-transparent',
    glow: '#c026d3',
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
    accent: 'from-amber-500/20 to-transparent',
    glow: '#d97706',
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
    accent: 'from-emerald-500/20 to-transparent',
    glow: '#059669',
  },
];

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
