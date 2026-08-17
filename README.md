# Unicity Arcade

A free-to-play, browser-based multiplayer arcade. Your **Sphere wallet is your identity** —
connect once and you're in. No sign-up, no email, no password.

**Live cabinets:** Chess ♞ · Tic-Tac-Toe ⛌ · Match-3 ◈ · Runner ⏵

---

## What you can do right now

**Chess** and **Tic-Tac-Toe** are turn-based board games with three ways to play:

| Mode | What it means | Needs internet server? |
| --- | --- | --- |
| **Single player** | You vs the computer. Three difficulties: Normal, Hard, Advanced. | No |
| **Local** | Two people, one screen, taking turns. | No |
| **Online** | Two people, two different devices, anywhere. | Yes — Supabase (free) |

**Match-3** and **Runner** are solo arcade games built on Phaser. They are score attacks —
you play alone and chase a personal best:

| Game | Goal | Controls |
| --- | --- | --- |
| **Match-3** | 30 moves to the highest score. Cascades multiply. | Swipe/drag a gem, or arrows + Enter. `H` for a hint. |
| **Runner** | Survive as long as possible. Speed ramps up forever. | Swipe up/down/left/right, or arrows / WASD. |

Everything except Online works the moment you run the app. **Online** needs one free
account setup, described in step 4 below.

### About the Runner's tracks

The runner's track is generated as you play, which raises an obvious risk: a random
generator can easily produce a wall with no gap — an unwinnable situation that is not the
player's fault. To rule that out, every stretch of track is run through a route solver
before it is handed to the game, and any stretch the solver cannot walk is discarded and
regenerated. The test suite confirms this over 288,000 generated slots. **You cannot be
given an impossible track.**

Match-3 gets the same treatment: every board is checked to contain at least one legal move
before you see it, and if the board ever deadlocks it reshuffles instead of stranding you.

### Your player profile

Click your wallet chip in the top-right and choose **View profile & stats**, or go straight
to `/profile`. It shows:

- **Games played, win rate, and your current/best win streak** across Chess and
  Tic-Tac-Toe.
- **A per-game breakdown** — how you do at Chess versus Tic-Tac-Toe, and your Match-3 and
  Runner personal bests side by side.
- **Your last 10 results**, most recent first, as a row of win/loss/draw markers.
- **The global top ten** for Match-3 and Runner, if you set up the optional leaderboard.

Everything is tied to your wallet's public key, so your record follows your identity rather
than the browser tab. Stats live in your browser's own storage: they survive refreshes and
restarts, but clearing site data or switching browsers starts a fresh record.

> Games played against **another person on the same screen** (Local mode) are recorded as
> draws on purpose. Both players share one wallet in that mode, so there is no honest way
> to say which of the two humans earned the win.

### Leaderboards

The **🏆 Leaderboards** button in the lobby (or `/leaderboard`) opens a **Top 30 board for
every game**, with a tab per cabinet. Your own row is highlighted wherever you place.

Each board ranks by what that game actually measures — Chess and Tic-Tac-Toe by wins (with
the full W-L-D record shown next to it), Match-3 and Runner by high score. Every row also
says *how* the result was earned, so an `AI · normal` win is never silently passed off as a
win against a real opponent. Boards refresh live as scores come in.

This is the one feature that needs the optional backend from step 5 — without it the page
explains itself instead of breaking, and your personal bests still work on-device.

---


## Setup — do this once

### 1. Install the dependencies

Open a terminal in the project folder and run:

```
npm install
```

### 2. Create your local settings file

```
copy .env.example .env.local
```

### 3. Start the app

```
npm run dev
```

Open **http://localhost:3000** in your browser. Click **Connect Sphere Wallet**, approve
in the popup, and the arcade lobby appears. Click any of the four tiles to play. You can
stop here — everything except Online mode already works.


### 4. (Optional) Turn on Online multiplayer

Online mode needs a message relay so two browsers can talk to each other. We use
Supabase Realtime, which is free and takes about three minutes to set up.

1. Go to **https://supabase.com** and sign up (free, no card required).
2. Click **New project**. Give it any name, pick any region close to you, and set a
   database password (you will not need it again — but save it anyway).
3. Wait ~2 minutes for the project to finish provisioning.
4. In the left sidebar click the **gear icon (Project Settings)** → **API**.
5. You will see two values. Copy them:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long string starting with `eyJ...`
6. Open `.env.local` in this project and paste them in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...your-long-key...
   ```

7. Stop the dev server (press `Ctrl+C` in the terminal) and start it again:

   ```
   npm run dev
   ```

That's it. **No database tables to create** — online Chess and Tic-Tac-Toe use Supabase's
Realtime broadcast channels only, which need no schema, no SQL, and no migrations.

> **Is the anon key a secret?** No. It is designed to be public and is safe in the
> browser. Never paste your `service_role` key anywhere in this project.

### 5. (Optional) Global Top 30 leaderboards

Your scores and match history **always** save to your own browser, with no setup. If you
also want the shared **Top 30 leaderboards** at `/leaderboard`, create two tables.

Two are needed because the games measure different things: Neon Nexus and Block Dash rank
by high score, while Chess and Tic-Tac-Toe rank by win/loss record.

In Supabase, open **SQL Editor** → **New query**, paste **all** of this, and click **Run**:

```sql
-- ── Table 1 of 2: high scores for the solo games (Neon Nexus, Block Dash) ──
create table if not exists solo_scores (
  id            bigint generated always as identity primary key,
  game_id       text        not null,
  chain_pubkey  text        not null,
  display_name  text        not null,
  score         integer     not null,
  detail        jsonb       not null default '{}',
  created_at    timestamptz not null default now()
);

-- Fastest possible "top scores for this game" query.
create index if not exists solo_scores_leaderboard
  on solo_scores (game_id, score desc);

-- Row Level Security is on by default and blocks everything until we say otherwise.
alter table solo_scores enable row level security;

-- Anyone may read the leaderboard...
create policy "leaderboard is public"
  on solo_scores for select using (true);

-- ...and anyone may add their own run, but nobody can edit or delete existing rows.
create policy "anyone can post a score"
  on solo_scores for insert with check (true);


-- ── Table 2 of 2: win/loss records for the versus games (Chess, Tic-Tac-Toe) ──
create table if not exists match_results (
  id            bigint generated always as identity primary key,
  game_id       text        not null,
  mode          text        not null,          -- 'ai' | 'online' | 'local'
  outcome       text        not null,          -- 'win' | 'loss' | 'draw'
  difficulty    text,                          -- set when mode = 'ai'
  chain_pubkey  text        not null,
  display_name  text        not null,
  created_at    timestamptz not null default now()
);

-- Supports the "recent matches for this game" scan the wins board runs.
create index if not exists match_results_leaderboard
  on match_results (game_id, created_at desc);

alter table match_results enable row level security;

create policy "match history is public"
  on match_results for select using (true);

create policy "anyone can post a result"
  on match_results for insert with check (true);
```

No extra environment variables are needed — it reuses the same two Supabase keys.

**Then switch on live updates.** Go to **Database → Publications → `supabase_realtime`**
and tick both `solo_scores` and `match_results`. This is what makes a rival's new score
appear on the board without a refresh. Skipping it is harmless — the boards still work,
they just need a manual reload.

> **Why can anyone insert a score?** Because the games run entirely in the browser, a
> determined person could always post a fake number. Stopping that requires the server to
> replay and validate the run, which is a separate piece of work. The important part is
> that `select` and `insert` are the *only* permissions granted: **no one can alter or
> delete anyone else's score.** Treat this leaderboard as friendly, not competitive.


---

## How to test Online multiplayer

You need two browser windows that don't share a wallet session.

1. Run `npm run dev`.
2. **Window A** — normal window. Go to http://localhost:3000, connect your wallet,
   open **Chess**, choose **Online**, then click **Create room**. You'll see a 5-character
   code like `K7QM2`.
3. **Window B** — open an **incognito/private window** (so it gets its own wallet
   session). Go to http://localhost:3000, connect a wallet, open **Chess**, choose
   **Online**, type the code from Window A, and click **Join**.
4. Both windows now show "Opponent connected". White moves first. Make a move in one
   window and watch it appear instantly in the other.

To test on your **phone and computer together**, start the server so it accepts
connections from your network:

```
npm run dev -- --hostname 0.0.0.0
```

Then find your computer's local IP (run `ipconfig` and look for `IPv4 Address`, e.g.
`192.168.1.42`) and open `http://192.168.1.42:3000` on your phone.

---

## Testing the AI opponents

Two verification scripts prove the AIs actually work. Run both with:

```
npm run verify:ai
```

**Tic-Tac-Toe** is verified by brute force: the script plays the `advanced` AI against
*every possible sequence of human moves* — roughly 44,000 positions — and confirms the
human never wins even once. Expected output:

```
positions explored : 44,295
AI wins            : 9,576
draws              : 7,166
HUMAN WINS         : 0

RESULT: PASS — advanced AI is unbeatable (human can never win).
```

The only line that must never change is **`HUMAN WINS : 0`**. That is the actual claim
being proven; the other counts shift if the AI's tie-breaking changes.

**Chess** is verified by tactical puzzles: it must find mate-in-one, must capture a free
queen, must stay inside its thinking-time budget, and must beat the Normal AI. Expected
output:

```
PASS  mate-in-one found (hard) — played Re8#
PASS  mate-in-one found (advanced) — played Re8#
PASS  captures free queen (hard) — played Nxd5
PASS  captures free queen (advanced) — played Nxd5
PASS  advanced respects time budget (<4s) — 2508ms, depth 2, 4,160 nodes
PASS  full game runs to completion — 57 plies, checkmate
PASS  advanced >= normal over 4 games — advanced scored 3.5/4

RESULT: all chess AI checks PASSED
```

The move counts, timings and match score vary between runs — chess search depth depends on
how fast your machine is. What matters is that every line starts with `PASS`.

**Match-3** and **Runner** have their own suites, run by the same command. Match-3 proves
3,000 fresh boards are always playable, that gravity never loses or duplicates a gem, and
that a deadlocked board reshuffles instead of stranding you. Runner proves 4,000 generated
tracks are solvable, including 400 long runs totalling 288,000 slots.


### How hard are the difficulties?

| Difficulty | Tic-Tac-Toe | Chess |
| --- | --- | --- |
| **Normal** | Makes deliberate mistakes ~35% of the time. Beatable. | Shallow search, blunders ~30% of moves. Beatable by a beginner. |
| **Hard** | Near-perfect; occasional slip. | Sees tactics 3 plies deep, never blunders on purpose. Punishes free material. |
| **Advanced** | **Mathematically unbeatable.** Best case is a draw. | Deepest search allowed in a browser tab. Strong club-level tactics. |

---

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for local development on port 3000. |
| `npm run build` | Make the optimised production build (what Vercel runs). |
| `npm start` | Serve the production build locally after `npm run build`. |
| `npm run typecheck` | Check for type errors without building. |
| `npm run verify:ai` | Run every game-logic proof script (AI + Match-3 + Runner). |
| `npm run verify:match3` | Prove the Match-3 board is always solvable and scores correctly. |
| `npm run verify:runner` | Prove every generated Runner track can actually be completed. |


---

## Deploying to Vercel

1. Push this folder to GitHub.
2. Go to **https://vercel.com/new** and import the repository.
3. Vercel auto-detects Next.js — leave all build settings alone.
4. Under **Environment Variables**, add the same three keys from your `.env.local`:
   - `NEXT_PUBLIC_SPHERE_WALLET_URL`
   - `NEXT_PUBLIC_SUPABASE_URL` (only if you want Online mode)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (only if you want Online mode)
5. Click **Deploy**.

> **Important:** the Sphere wallet popup checks which website is asking to connect. Your
> deployed URL (e.g. `https://your-arcade.vercel.app`) must be allow-listed with Sphere,
> otherwise the popup will reject the connection. `localhost` works out of the box.

### After the first deploy

**Set the environment variables for all three environments.** When you add a variable,
Vercel shows tick-boxes for *Production*, *Preview*, and *Development*. Tick all three, or
your preview deployments will silently lose Online mode. If you add or change a variable
later you must **redeploy** — values are baked in at build time, so an existing deployment
will not pick them up.

**Wallet connections require HTTPS.** Vercel gives every deployment a real certificate
automatically, so this is already handled. It only matters if you later put the site behind
a custom domain: finish the domain verification before testing the wallet, because the
popup will refuse a plain `http://` origin.

**Preview URLs change on every push.** Vercel generates a new hostname per commit
(`your-arcade-abc123.vercel.app`). Since Sphere validates the requesting origin, wallet
connect may fail on those one-off preview URLs unless you allow-list a wildcard. Test the
wallet on your stable production domain.

`vercel.json` in this project already sets sensible security headers (HSTS, no MIME
sniffing, a strict referrer policy, and a permissions policy that denies camera,
microphone, geolocation and payment access) plus long-lived caching for static assets. You
do not need to touch it.


---

## Project layout

```
src/
  app/
    layout.tsx                 Root layout, fonts, metadata
    page.tsx                   Home — wallet gate + lobby
    globals.css                Design tokens: OLED palette, HUD accents
    profile/page.tsx           /profile route — your stats and the leaderboards
    leaderboard/page.tsx       /leaderboard route — Top 30 per game
    play/
      chess/page.tsx           /play/chess route
      tic-tac-toe/page.tsx     /play/tic-tac-toe route
      match-3/page.tsx         /play/match-3 route
      runner/page.tsx          /play/runner route



  wallet/
    WalletProvider.tsx         Wallet state machine + React context

  lib/
    sphere-config.ts           Sphere SDK setup, network config
    wallet-errors.ts           Turns SDK errors into plain-English messages
    supabase.ts                Supabase client (returns null if keys absent)
    games.ts                   The game library (titles, routes, tile art)
    scores.ts                  Saves solo runs: local best + optional leaderboard
    profile.ts                 Win/loss/streak records, keyed to your wallet
    leaderboard.ts             Per-game Top 30 queries + live board subscription



  multiplayer/
    types.ts                   Shared room/message types
    useRoom.ts                 Room lifecycle: create, join, sync, disconnect

  games/
    tictactoe/
      engine.ts                Rules + minimax AI (pure logic, no UI)
      TicTacToeGame.tsx        The playable board
    chess/
      ai.ts                    Negamax + alpha-beta search (pure logic)
      ChessGame.tsx            The playable board
    match3/
      engine.ts                Board rules: matches, cascades, gravity, scoring
      art.ts                   Gem artwork, drawn in code (no image files)
      scene.ts                 The Phaser scene — animation, input, effects
      Match3Game.tsx           React wrapper
    runner/
      generator.ts             Track generator + the solver that proves it clearable
      scene.ts                 Pseudo-3D Phaser scene — lanes, jump, slide
      RunnerGame.tsx           React wrapper
    PhaserCanvas.tsx           The React↔Phaser bridge used by both arcade games

  components/

    ConnectGate.tsx            Blocks the arcade until a wallet connects
    ArcadeLobby.tsx            The bento-grid lobby
    GameCard.tsx               One tile in the lobby grid
    WalletIndicator.tsx        Connected-wallet chip in the header
    game/
      GameShell.tsx            Shared frame around every game
      ModeSelect.tsx           Single player / Local / Online picker
      RoomPanel.tsx            Room code, join box, opponent status
      ArcadeGameFrame.tsx      Shared score HUD, results panel and replay button
    profile/
      PlayerProfile.tsx        The profile screen: identity, stats, history
      StatCard.tsx             One headline stat tile
      Leaderboard.tsx          Global top-ten table (needs Supabase)
    leaderboard/
      LeaderboardScreen.tsx    /leaderboard shell with one tab per game
      GameLeaderboard.tsx      One game's Top 30 table, live-updating


scripts/

  verify-ttt-ai.mjs            Brute-force proof the TTT AI is unbeatable
  verify-chess-ai.mjs          Tactical puzzle checks for the chess AI
  verify-match3.mjs            Board-integrity and scoring proofs for Match-3
  verify-runner.mjs            Solvability proofs for every generated track
```


---

## Troubleshooting

**"Online" is greyed out or says multiplayer is unavailable.**
Your Supabase keys are missing or empty in `.env.local`. Follow step 4 above, then
restart the dev server — Next.js only reads env files at startup.

**The wallet popup opens then immediately closes.**
Your browser blocked it, or the popup was closed manually. Allow popups for
`localhost:3000` and click Connect again.

**The wallet popup says the site isn't allowed.**
The origin isn't allow-listed with Sphere. `http://localhost:3000` should work; a custom
domain or Vercel URL needs to be registered with Sphere first.

**Both browser windows show the same player.**
They're sharing one wallet session. Use an incognito window for the second player.

**"Opponent disconnected" appears when nobody left.**
A brief network drop. The room stays open — the other player can rejoin with the same code.

**Chess AI feels slow on Advanced.**
It thinks for up to ~2.5 seconds. That's the deliberate cap that keeps the tab
responsive. Use Hard for faster replies.

**Match-3 or Runner shows "Loading game engine…" and never starts.**
The Phaser engine is downloaded on demand the first time you open one of those two games.
On a slow connection this takes a moment. If it never finishes, hard-refresh the page
(`Ctrl+Shift+R`).

**My personal best disappeared.**
Bests are stored in your browser, per wallet. It resets if you clear site data, switch
browsers, use a private window, or connect a different wallet. Set up the optional
leaderboard in step 5 if you want scores stored off-device.

**The Runner feels too fast.**
It is meant to. Speed increases with distance and never stops climbing, so every run ends
eventually — the score is how far you got, not whether you finished.


