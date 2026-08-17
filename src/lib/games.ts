/**
 * The arcade's game library.
 *
 * Presentation data only — no game logic lives here.
 * `span` drives the bento-box grid so tiles are deliberately unequal in size.
 */

export type GameStatus = 'soon' | 'alpha' | 'live';

export interface ArcadeGame {
  id: string;
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
    glow: '#22d3ee',
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
    span: 'md:col-span-2 md:row-span-1',
    accent: 'from-fuchsia-500/20 to-transparent',
    glow: '#e879f9',
  },
  {
    id: 'match-3',
    title: 'Match-3',
    tagline: 'Thirty moves. Chain cascades for escalating multipliers.',
    glyph: '◈',
    players: 'Solo',
    mode: 'Real-time',
    status: 'live',
    href: '/play/match-3',
    span: 'md:col-span-1 md:row-span-1',
    accent: 'from-amber-500/20 to-transparent',
    glow: '#fbbf24',
  },
  {
    id: 'runner',
    title: 'Runner',
    tagline: 'Endless three-lane sprint. Jump, slide, survive.',
    glyph: '⏵',
    players: 'Solo',
    mode: 'Real-time',
    status: 'live',
    href: '/play/runner',
    span: 'md:col-span-1 md:row-span-1',
    accent: 'from-emerald-500/20 to-transparent',
    glow: '#34d399',
  },

];
