'use client';


/**
 * Connected-wallet indicator for the arcade HUD.
 *
 * Shows the player's identity (nametag or truncated pubkey), a live status lamp,
 * the transport in use, and a disconnect control. Clicking the chip reveals the
 * full public key and lets the player copy it.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';

import { useWallet } from '@/wallet/WalletProvider';
import { ARCADE_NETWORK } from '@/lib/sphere-config';

export function WalletIndicator() {
  const { player, isLocked, transport, disconnect, isConnected } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close the popover on outside tap / Escape.
  useEffect(() => {
    if (!open) return;

    // AUDIT FIX: this listened for `mousedown`, which touchscreens only emulate — and
    // they fire it late, after `click`. On mobile that meant tapping outside the popover
    // often failed to close it, or closed it a beat later than the tap. `pointerdown`
    // fires for mouse, touch and pen alike, at press time.
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);


  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!isConnected || !player) return null;

  const lamp = isLocked ? 'bg-hud-amber' : 'bg-hud-lime';
  const lampLabel = isLocked ? 'Wallet locked' : 'Online';

  async function copyKey() {
    if (!player) return;
    try {
      await navigator.clipboard.writeText(player.chainPubkey);
      setCopied(true);
    } catch {
      /* Clipboard blocked — the key is visible on screen for manual copy. */
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
        aria-expanded={open}
        aria-label={`Wallet ${player.displayName}. ${lampLabel}.`}
        className="flex items-center gap-2.5 rounded-full border border-hairline bg-panel/80 py-1.5 pr-2 pl-3 backdrop-blur transition-colors hover:border-hud-cyan/50"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${lamp} opacity-60 ${
              isLocked ? '' : 'animate-ping'
            }`}
          />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${lamp}`} />
        </span>

        <span className="max-w-[10rem] truncate font-mono text-xs text-zinc-100 sm:text-sm">
          {player.displayName}
        </span>

        <span className="hidden rounded-full border border-hairline bg-black/60 px-2 py-0.5 hud-label text-zinc-500 sm:inline">
          {ARCADE_NETWORK.name ?? `net ${ARCADE_NETWORK.id}`}
        </span>

        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="mr-1 text-zinc-500"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 z-50 mt-2 w-[19rem] overflow-hidden rounded-2xl border border-hairline bg-panel-raised/95 shadow-2xl shadow-black backdrop-blur-xl"
          >
            <div className="border-b border-hairline px-4 py-3">
              <p className="hud-label text-zinc-500">Player identity</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100">
                {player.nametag ?? 'Unnamed player'}
              </p>
            </div>

            <div className="space-y-3 px-4 py-3">
              <div>
                <p className="hud-label text-zinc-500">Chain pubkey</p>
                <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-zinc-400">
                  {player.chainPubkey}
                </p>
              </div>

              {player.directAddress && (
                <div>
                  <p className="hud-label text-zinc-500">Direct address</p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-zinc-400">
                    {player.directAddress}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
                <span className="hud-label text-zinc-500">Transport</span>
                <span className="font-mono text-[11px] text-zinc-300">{transport ?? '—'}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="hud-label text-zinc-500">Status</span>
                <span
                  className={`font-mono text-[11px] ${
                    isLocked ? 'text-hud-amber' : 'text-hud-lime'
                  }`}
                >
                  {isLocked ? 'locked' : 'live'}
                </span>
              </div>
            </div>

            {isLocked && (
              <p className="mx-4 mb-3 rounded-lg border border-hud-amber/30 bg-hud-amber/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                Your wallet is locked. Your session is still active — unlock Sphere to keep
                playing.
              </p>
            )}

            {/* Profile link. Hidden when already on the profile page so the popover
                never offers a no-op navigation. */}
            {pathname !== '/profile' && (
              <Link
                href="/profile"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3 transition-colors hover:bg-hud-cyan/[0.06]"
              >
                <span className="text-xs font-medium text-zinc-200">
                  View profile &amp; stats
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-hud-cyan"
                  aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            )}

            <div className="flex gap-2 border-t border-hairline p-3">
              <button
                type="button"
                onClick={copyKey}
                className="flex-1 rounded-lg border border-hairline bg-black/40 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-hud-cyan/40 hover:text-white"
              >
                {copied ? 'Copied' : 'Copy key'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
                className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200"
              >
                Disconnect
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
