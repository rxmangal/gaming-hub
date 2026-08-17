'use client';

/**
 * Player profile — the arcade's "who am I and how am I doing" screen.
 *
 * Identity comes entirely from the Sphere wallet: there is no account to create, so this
 * page can be rendered the instant the wallet connects.
 *
 * Stats are read from the device inside an effect rather than during render, because
 * localStorage does not exist on the server. Reading it during render would either crash
 * the prerender or cause a hydration mismatch (server renders 0, client renders 12).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';

import { GameShell } from '@/components/game/GameShell';
import { FormStrip, OutcomeBar, Panel, StatCard } from './StatCard';
import { Leaderboard } from './Leaderboard';
import {
  type ProfileStats,
  type VersusGameId,
  readProfileStats,
  winRate,
} from '@/lib/profile';
import { useWallet } from '@/wallet/WalletProvider';

const VERSUS_LABEL: Record<VersusGameId, string> = {
  chess: 'Chess',
  'tic-tac-toe': 'Tic-Tac-Toe',
};

function joinedLabel(firstSeen: number | null): string {
  if (!firstSeen) return 'New player';
  const days = Math.floor((Date.now() - firstSeen) / 86_400_000);
  if (days <= 0) return 'Joined today';
  if (days === 1) return 'Joined yesterday';
  if (days < 30) return `Playing for ${days} days`;
  const months = Math.floor(days / 30);
  return `Playing for ${months} month${months === 1 ? '' : 's'}`;
}

export function PlayerProfile() {
  const { player, transport, isLocked } = useWallet();
  const [stats, setStats] = useState<ProfileStats | null>(null);

  // Client-only read. `null` until it lands, which also gives us a clean loading state.
  useEffect(() => {
    if (!player) return;
    setStats(readProfileStats(player.chainPubkey));
  }, [player]);

  // ConnectGate guarantees a player, but the type must still be narrowed.
  if (!player) return null;

  const totals = stats?.totals ?? { played: 0, wins: 0, losses: 0, draws: 0 };
  const rate = winRate(totals);

  return (
    <GameShell title="Player profile" subtitle="Identity provided by your Sphere wallet">
      {/* ---------------- Identity header ---------------- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-6 overflow-hidden rounded-3xl border border-hairline bg-panel/70 p-5 sm:p-6"
      >
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-hud-cyan/[0.07] blur-[90px]"
          aria-hidden="true"
        />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          {/* Avatar: derived from the pubkey so it is stable and needs no upload. */}
          <div className="relative h-16 w-16 shrink-0 sm:h-20 sm:w-20">
            <div
              className="grid h-full w-full place-items-center rounded-2xl border border-hud-cyan/25 font-mono text-2xl text-hud-cyan sm:text-3xl"
              style={{
                background: `radial-gradient(circle at 30% 25%, rgba(34,211,238,0.22), rgba(0,0,0,0.9))`,
              }}
              aria-hidden="true"
            >
              {(player.nametag ?? player.chainPubkey).replace('@', '').slice(0, 2).toUpperCase()}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-panel ${
                isLocked ? 'bg-hud-amber' : 'bg-hud-lime'
              }`}
              title={isLocked ? 'Wallet locked' : 'Online'}
            />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-bold tracking-tight text-white">
              {player.nametag ?? 'Unnamed player'}
            </h2>
            <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-zinc-600">
              {player.chainPubkey}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-hairline bg-black/50 px-2.5 py-1 hud-label text-zinc-500">
                {joinedLabel(stats?.firstSeen ?? null)}
              </span>
              {transport && (
                <span className="rounded-full border border-hairline bg-black/50 px-2.5 py-1 hud-label text-zinc-500">
                  {transport}
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ---------------- Headline stats (bento) ---------------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Games played"
          value={totals.played.toLocaleString()}
          accent="#e4e4e7"
          delay={0.05}
        />
        <StatCard
          label="Wins"
          value={totals.wins.toLocaleString()}
          accent="#a3e635"
          delay={0.1}
        />
        <StatCard
          label="Losses"
          value={totals.losses.toLocaleString()}
          accent="#f87171"
          delay={0.15}
        />
        <StatCard
          label="Win rate"
          value={rate === null ? '—' : `${rate}%`}
          accent="#22d3ee"
          sub={rate === null ? 'No decided matches yet' : 'Draws excluded'}
          delay={0.2}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------- Record ---------------- */}
        <Panel title="Record" hint="all games" delay={0.25}>
          <OutcomeBar wins={totals.wins} losses={totals.losses} draws={totals.draws} />

          {/* Per-game breakdown for the two versus games. */}
          <div className="mt-5 space-y-2.5 border-t border-hairline pt-4">
            {(Object.keys(VERSUS_LABEL) as VersusGameId[]).map((id) => {
              const s = stats?.perGame[id];
              const r = s ? winRate(s) : null;
              return (
                <div key={id} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400">{VERSUS_LABEL[id]}</span>
                  <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                    {s
                      ? `${s.wins}W · ${s.draws}D · ${s.losses}L${r === null ? '' : ` · ${r}%`}`
                      : 'not played'}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* ---------------- Solo bests ---------------- */}
        <Panel title="Personal bests" hint="solo games" delay={0.3}>
          <div className="space-y-2.5">
            {[
              { id: 'match-3' as const, label: 'Match-3', accent: '#fbbf24', href: '/play/match-3' },
              { id: 'runner' as const, label: 'Runner', accent: '#34d399', href: '/play/runner' },
            ].map((game) => {
              const best = stats?.soloBests[game.id];
              const played = stats?.perGame[game.id]?.played ?? 0;
              return (
                <Link
                  key={game.id}
                  href={game.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-black/40 px-3.5 py-3 transition-colors hover:border-hud-cyan/40"
                >
                  <span>
                    <span className="block text-xs font-medium text-zinc-200">{game.label}</span>
                    <span className="hud-label text-zinc-700">
                      {played === 0 ? 'never played' : `${played} run${played === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span
                    className="font-mono text-base tabular-nums"
                    style={{ color: best === undefined ? '#52525b' : game.accent }}
                  >
                    {best === undefined ? '—' : best.toLocaleString()}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-5 border-t border-hairline pt-4">
            <p className="mb-2.5 hud-label text-zinc-600">Recent form</p>
            <FormStrip outcomes={(stats?.recent ?? []).map((m) => m.outcome)} />
          </div>
        </Panel>

        {/* ---------------- Global leaderboard ---------------- */}
        <div className="lg:col-span-2">
          <Panel title="Global leaderboard" hint="top 10" delay={0.35}>
            <Leaderboard mePubkey={player.chainPubkey} />
          </Panel>
        </div>
      </div>

      {/* Honesty note: the player should understand where these numbers live. */}
      <p className="mx-auto mt-6 max-w-2xl text-center text-[11px] leading-relaxed text-zinc-700">
        Your record is stored in this browser and tied to your wallet, so it survives a
        refresh with no account needed. Pass-and-play matches count as games played but not
        as wins — both players share one wallet, so there is no way to tell who won.
      </p>
    </GameShell>
  );
}
