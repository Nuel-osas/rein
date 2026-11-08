// Cluster settings and display helpers, shared by the browser and the server. Every address comes
// from env or from chain, so moving from a local validator to devnet is config only:
//   NEXT_PUBLIC_RPC_URL    the JSON-RPC endpoint the browser reads from
//   NEXT_PUBLIC_CLUSTER    devnet | localnet (explorer links and labels)
//   NEXT_PUBLIC_DEMO_TEAM  the team PDA the landing page and the public demo read
// The program id is the one in the IDL. The USDC mint is read from the Config account, never here.

import { Connection, PublicKey } from '@solana/web3.js';
import idl from './idl/rein.json';

export const PROGRAM_ID = new PublicKey(idl.address);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
export const CLUSTER: 'devnet' | 'localnet' = process.env.NEXT_PUBLIC_CLUSTER === 'localnet' ? 'localnet' : 'devnet';
export const CLUSTER_LABEL = CLUSTER === 'devnet' ? 'SOLANA DEVNET' : 'SOLANA LOCALNET';
export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;

/** The demo team, or null when unset or not a valid address. */
export const DEMO_TEAM: string | null = (() => {
  const raw = process.env.NEXT_PUBLIC_DEMO_TEAM?.trim();
  if (!raw) return null;
  return parseAddress(raw);
})();

/** A base58 public key, or null. Never throws. */
export function parseAddress(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string' || raw.length < 32 || raw.length > 44) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw)) return null;
  try {
    return new PublicKey(raw).toBase58() === raw ? raw : null;
  } catch {
    return null;
  }
}

let shared: Connection | null = null;
/** One connection per runtime, at confirmed commitment: a payment shows as soon as it lands. */
export function connection(): Connection {
  if (!shared) shared = new Connection(RPC_URL, { commitment: 'confirmed', disableRetryOnRateLimit: false });
  return shared;
}

function clusterParam(): string {
  if (CLUSTER === 'devnet') return '?cluster=devnet';
  return `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

export function explorer(kind: 'address' | 'tx', id: string): string {
  return `https://explorer.solana.com/${kind}/${id}${clusterParam()}`;
}

/** Formats USDC base units for display only. Money stays in base units everywhere else. */
export function usdc(units: bigint | null | undefined): string {
  if (units === null || units === undefined) return '—';
  const neg = units < 0n;
  const n = neg ? -units : units;
  const whole = n / USDC_UNIT;
  const frac = (n % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0');
  // Two decimals unless the amount needs more, so $0.405 never displays as $0.40.
  const trimmed = frac.replace(/0+$/, '');
  const shown = trimmed.length <= 2 ? frac.slice(0, 2) : trimmed;
  return `${neg ? '-' : ''}$${whole.toLocaleString('en-US')}.${shown}`;
}

export function short(addr: string | null | undefined, n = 4): string {
  if (!addr) return '—';
  return addr.length > 2 * n + 1 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr;
}

/** "12s ago" from unix seconds. */
export function ago(unix: number | null | undefined, nowMs = Date.now()): string {
  if (!unix) return '';
  const s = Math.max(0, Math.round(nowMs / 1000 - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function period(secs: number): string {
  if (secs % 604800 === 0) return secs === 604800 ? 'week' : `${secs / 604800} weeks`;
  if (secs % 86400 === 0) return secs === 86400 ? 'day' : `${secs / 86400} days`;
  if (secs % 3600 === 0) return secs === 3600 ? 'hour' : `${secs / 3600} hours`;
  if (secs % 60 === 0) return `${secs / 60} min`;
  return `${secs}s`;
}

/** "23h 59m" or "4m 12s" until a unix time; "expired" once past. */
export function countdown(deadline: number, nowMs = Date.now()): string {
  const s = Math.floor(deadline - nowMs / 1000);
  if (s <= 0) return 'expired';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}
