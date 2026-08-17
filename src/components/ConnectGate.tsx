'use client';

/**
 * ConnectGate — the wallet wall.
 *
 * HARD REQUIREMENT (Task 2): nothing in the arcade renders until the wallet is
 * connected. This component renders `children` only when the wallet reports a
 * connected session; every other state renders an explicit screen.
 */

import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

import { useWallet } from '@/wallet/WalletProvider';
import { WALLET_URL } from '@/lib/sphere-config';

const EASE = [0.16, 1, 0.3, 1] as const;

function ScanLines() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 hud-grid opacity-40" />
      <motion.div
        className="absolute inset-x-0 h-40 bg-gradient-to-b from-transparent via-hud-cyan/5 to-transparent"
        animate={{ y: ['-20%', '120%'] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
      />
      <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-hud-cyan/10 blur-[120px]" />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-void px-5 py-12">
      <ScanLines />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </main>
  );
}

/** The animated Unicity mark used on the gate. */
function ArcadeSigil({ spin = false }: { spin?: boolean }) {
  return (
    <div className="relative mx-auto mb-8 h-20 w-20">
      <motion.div
        className="absolute inset-0 rounded-2xl border border-hud-cyan/30"
        animate={spin ? { rotate: 360 } : { rotate: [0, 8, 0, -8, 0] }}
        transition={
          spin
            ? { duration: 2.2, repeat: Infinity, ease: 'linear' }
            : { duration: 9, repeat: Infinity, ease: 'easeInOut' }
        }
      />
      <motion.div
        className="absolute inset-2 rounded-xl border border-hud-magenta/25"
        animate={spin ? { rotate: -360 } : { rotate: [0, -10, 0, 10, 0] }}
        transition={
          spin
            ? { duration: 3, repeat: Infinity, ease: 'linear' }
            : { duration: 11, repeat: Infinity, ease: 'easeInOut' }
        }
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl text-glow-cyan" aria-hidden="true">
          ◈
        </span>
      </div>
      <div className="absolute inset-0 -z-10 rounded-full bg-hud-cyan/20 blur-2xl" />
    </div>
  );
}

export function ConnectGate({ children }: { children: ReactNode }) {
  const { status, error, connect, reset, isConnected } = useWallet();

  // Connected — hand the arcade over.
  if (isConnected) return <>{children}</>;

  const isBusy = status === 'connecting' || status === 'restoring';

  return (
    <Shell>
      <AnimatePresence mode="wait">
        {/* ---------- Restoring a previous session ---------- */}
        {status === 'restoring' && (
          <motion.div
            key="restoring"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="text-center"
          >
            <ArcadeSigil spin />
            <p className="hud-label text-hud-cyan">Restoring session</p>
            <p className="mt-3 text-sm text-zinc-500">Reconnecting to your Sphere wallet…</p>
          </motion.div>
        )}

        {/* ---------- Connecting (wallet popup open) ---------- */}
        {status === 'connecting' && (
          <motion.div
            key="connecting"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="text-center"
          >
            <ArcadeSigil spin />
            <p className="hud-label text-hud-cyan">Awaiting approval</p>
            <h1 className="mt-3 text-xl font-semibold text-zinc-100">Check your wallet</h1>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-zinc-500">
              Approve the connection request in the Sphere window to enter the arcade.
            </p>

            <div className="mt-8 flex items-center justify-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-hud-cyan"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={reset}
              className="mt-8 hud-label text-zinc-600 underline-offset-4 transition-colors hover:text-zinc-400 hover:underline"
            >
              Cancel
            </button>
          </motion.div>
        )}

        {/* ---------- Rejected / Failed ---------- */}
        {(status === 'rejected' || status === 'failed') && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden rounded-3xl border border-hairline bg-panel/80 backdrop-blur-xl"
          >
            <div
              className={`h-0.5 w-full ${
                status === 'rejected'
                  ? 'bg-gradient-to-r from-transparent via-hud-amber to-transparent'
                  : 'bg-gradient-to-r from-transparent via-red-500 to-transparent'
              }`}
            />
            <div className="p-8 text-center">
              <div
                className={`mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border ${
                  status === 'rejected'
                    ? 'border-hud-amber/30 bg-hud-amber/10 text-hud-amber'
                    : 'border-red-500/30 bg-red-500/10 text-red-400'
                }`}
                aria-hidden="true"
              >
                <span className="text-xl">{status === 'rejected' ? '⃠' : '⚠'}</span>
              </div>

              <p
                className={`hud-label ${
                  status === 'rejected' ? 'text-hud-amber' : 'text-red-400'
                }`}
              >
                {status === 'rejected' ? 'Request declined' : 'Connection failed'}
              </p>
              <h1 className="mt-3 text-xl font-semibold text-zinc-100">{error.title}</h1>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-zinc-500">
                {error.message}
              </p>

              {error.code !== null && (
                <p className="mt-4 font-mono text-[10px] text-zinc-700">
                  sphere-connect code {error.code}
                </p>
              )}

              <div className="mt-8 flex flex-col gap-2.5">
                <motion.button
                  type="button"
                  onClick={() => void connect()}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
                >
                  Try again
                </motion.button>
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded-xl border border-hairline py-3 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                >
                  Back
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ---------- Disconnected: the entry screen ---------- */}
        {status === 'disconnected' && (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="text-center"
          >
            <ArcadeSigil />

            <p className="hud-label text-hud-cyan">Unicity Network</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Unicity <span className="text-hud-cyan text-glow-cyan">Arcade</span>
            </h1>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-zinc-500">
              Free-to-play multiplayer, straight in your browser. Your Sphere wallet is your
              player identity — no email, no password, no sign-up.
            </p>

            <motion.button
              type="button"
              onClick={() => void connect()}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group relative mt-10 w-full overflow-hidden rounded-xl bg-white py-3.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-100 disabled:opacity-60"
            >
              <span className="relative z-10">Connect Sphere Wallet</span>
              <motion.span
                className="absolute inset-0 -z-0 bg-gradient-to-r from-hud-cyan/0 via-hud-cyan/30 to-hud-cyan/0"
                initial={{ x: '-120%' }}
                animate={{ x: '120%' }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                aria-hidden="true"
              />
            </motion.button>

            <div className="mt-6 space-y-1.5">
              <p className="hud-label text-zinc-700">Wallet required to enter</p>
              <p className="text-[11px] text-zinc-700">
                No wallet yet?{' '}
                <a
                  href={WALLET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-500 underline decoration-zinc-800 underline-offset-2 transition-colors hover:text-hud-cyan"
                >
                  Create one on Sphere
                </a>
              </p>
            </div>

            {/* Trust strip */}
            <div className="mt-10 grid grid-cols-3 gap-2 border-t border-hairline pt-6">
              {[
                { label: 'Free to play', value: '0 fees' },
                { label: 'Identity', value: 'Self-custody' },
                { label: 'Network', value: 'Testnet2' },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-semibold text-zinc-300">{item.value}</p>
                  <p className="mt-0.5 hud-label text-zinc-700">{item.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}
