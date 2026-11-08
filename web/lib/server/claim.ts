// The daily claim: 0.10 test USDC from the claim pool (scripts/pool-setup.ts) into a team's vault,
// once per Privy user and once per wallet per UTC day, under a global daily count.
//
// Order, so a claim is never sent twice and a refusal never costs a claim:
//   1. read the team and the pool from chain (unknown → refuse, nothing taken)
//   2. SET NX claim:user:<id>:<day> and claim:wallet:<w>:<day>, 25 h TTL (the lock)
//   3. INCRBY claim:count:<day> under CLAIM_DAILY_CAP (default 200)
//   4. sign the transfer, record its signature in Postgres (unique per user and per wallet per day)
//   5. broadcast. A preflight refusal is failed: nothing moved, the locks are released. Anything
//      else unknown is pending under the recorded signature, and the locks stay.
// Import only from route handlers.

import { utils } from '@coral-xyz/anchor';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';
import { USDC_DECIMALS } from '@/lib/chain';
import { pda, readConfig, toTeam, type Team } from '@/lib/rein';
import { serverKey } from './keys';
import { broadcast, serverConnection } from './send';
import { ensureSchema, type Store } from './store';

/** 0.10 test USDC in base units. */
export const CLAIM_UNITS = 100_000n;
const LOCK_TTL = 25 * 3600;

export const CLAIMS_DDL = `
CREATE TABLE IF NOT EXISTS claims (
  id          bigserial PRIMARY KEY,
  day         date NOT NULL,
  user_id     text NOT NULL,
  wallet      text NOT NULL,
  team        text NOT NULL,
  amount      bigint NOT NULL,
  signature   text NOT NULL UNIQUE,
  status      text NOT NULL,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_user_day ON claims (user_id, day) WHERE status <> 'failed';
CREATE UNIQUE INDEX IF NOT EXISTS claims_wallet_day ON claims (wallet, day) WHERE status <> 'failed';
`;

/** The UTC day a claim counts against, as YYYY-MM-DD. */
export function claimDay(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Unix seconds of the next UTC midnight, when a new claim opens. */
export function nextClaimAt(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
}

/** CLAIM_DAILY_CAP as a positive whole number, 200 when unset, null when malformed (refuse). */
export function dailyCap(): number | null {
  const raw = process.env.CLAIM_DAILY_CAP?.trim();
  if (!raw) return 200;
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

export const keys = {
  user: (id: string, day: string) => `claim:user:${id}:${day}`,
  wallet: (w: string, day: string) => `claim:wallet:${w}:${day}`,
  count: (day: string) => `claim:count:${day}`,
};

/** The pool's token account for the registry's mint, or null when the pool key is not configured. */
export function poolToken(mint: string): { owner: PublicKey; token: PublicKey } | null {
  const pool = serverKey('pool');
  if (!pool) return null;
  return { owner: pool.publicKey, token: getAssociatedTokenAddressSync(new PublicKey(mint), pool.publicKey, false) };
}

let balanceCache: { token: string; units: bigint; at: number } | null = null;

/** The pool's balance from chain, cached 10 s; null when the read fails (unknown, never 0). */
export async function poolBalance(token: PublicKey): Promise<bigint | null> {
  const t = token.toBase58();
  if (balanceCache && balanceCache.token === t && Date.now() - balanceCache.at < 10_000) return balanceCache.units;
  try {
    const r = await serverConnection().getTokenAccountBalance(token, 'confirmed');
    if (!/^\d+$/.test(r.value.amount)) return null;
    const units = BigInt(r.value.amount);
    balanceCache = { token: t, units, at: Date.now() };
    return units;
  } catch {
    return null;
  }
}

export type ClaimReply = { http: number; body: Record<string, unknown> };
const refuse = (http: number, error: string, extra: Record<string, unknown> = {}): ClaimReply => ({ http, body: { ok: false, error, ...extra } });

/** Today's claim for this user and wallet: true, false, or null when the store could not say. */
export async function claimedToday(s: Store, userId: string, wallet: string | null, day = claimDay()): Promise<{ claimed: boolean | null; signature: string | null }> {
  try {
    const [u, w] = await Promise.all([s.get(keys.user(userId, day)), wallet ? s.get(keys.wallet(wallet, day)) : Promise.resolve(null)]);
    const v = u ?? w;
    return { claimed: v !== null, signature: v && v !== 'sending' ? v : null };
  } catch {
    return { claimed: null, signature: null };
  }
}

/** Reads the team account, distinguishing "not a team" from "could not read". */
async function teamOf(address: string): Promise<{ team: Team | null; read: boolean }> {
  try {
    const info = await serverConnection().getAccountInfo(new PublicKey(address), 'confirmed');
    return { team: toTeam(address, info), read: true };
  } catch {
    return { team: null, read: false };
  }
}

/**
 * One claim for a verified Privy user whose embedded wallet `wallet` owns `teamAddr`. The caller has
 * already checked the session, the wallet's link to the user, and that a store exists.
 */
export async function claim(s: Store, a: { userId: string; wallet: string; teamAddr: string; nowMs?: number }): Promise<ClaimReply> {
  const day = claimDay(a.nowMs);
  const cap = dailyCap();
  if (cap === null) return refuse(503, 'Claims are misconfigured on this server (CLAIM_DAILY_CAP). Nothing was sent.');
  const pool = serverKey('pool');
  const sponsor = serverKey('sponsor');
  if (!pool || !sponsor) return refuse(503, 'The claim pool is not configured on this server. Nothing was sent.');
  if (!s.sql && s.kind !== 'memory') return refuse(503, 'Claims need a database on this server. Nothing was sent.');

  // 1. Chain first: a refusal here takes no lock.
  let owner: PublicKey;
  try {
    owner = new PublicKey(a.wallet);
  } catch {
    return refuse(403, 'Your wallet address could not be read. Sign in again.');
  }
  if (pda.team(owner).toBase58() !== a.teamAddr) return refuse(403, 'That team is not owned by your signed-in wallet.');
  const conn = serverConnection();
  const [{ team, read }, config] = await Promise.all([teamOf(a.teamAddr), readConfig(conn)]);
  if (!read || !config) return refuse(502, 'Could not read the team or the Rein config from chain. Nothing was sent; try again.');
  if (!team) return refuse(404, 'That address is not a Rein team. Set up your team first.');
  if (team.owner !== a.wallet) return refuse(403, 'That team is not owned by your signed-in wallet.');
  if (team.mint !== config.mint || team.vault !== pda.vault(new PublicKey(config.mint), new PublicKey(team.address)).toBase58()) {
    return refuse(409, 'That team holds a different token than the registry.');
  }
  const p = poolToken(config.mint)!;
  const before = await poolBalance(p.token);
  if (before === null) return refuse(502, 'Could not read the pool balance from chain. Nothing was sent; try again.');
  if (before < CLAIM_UNITS) return refuse(410, 'The pool is empty. Every test USDC it held has been claimed.', { empty: true });

  // 2. The locks.
  const uKey = keys.user(a.userId, day);
  const wKey = keys.wallet(a.wallet, day);
  let tookUser = false;
  let tookWallet = false;
  const release = async () => {
    await Promise.allSettled([tookUser ? s.del(uKey) : null, tookWallet ? s.del(wKey) : null]);
  };
  try {
    tookUser = await s.setNX(uKey, 'sending', LOCK_TTL);
    if (!tookUser) return refuse(409, 'You already claimed today. A new claim opens at 00:00 UTC.', { claimed: true });
    tookWallet = await s.setNX(wKey, 'sending', LOCK_TTL);
    if (!tookWallet) {
      await release();
      return refuse(409, 'This wallet already claimed today. A new claim opens at 00:00 UTC.', { claimed: true });
    }
    // 3. The global count. Over it, the attempt still counts: the counter fails closed.
    const n = await s.incrBy(keys.count(day), 1n, LOCK_TTL);
    if (n > BigInt(cap)) {
      await release();
      return refuse(429, `Today's ${cap} claims are used up. Try again after 00:00 UTC.`);
    }
  } catch {
    await release().catch(() => {});
    return refuse(503, 'The claim store did not answer. Nothing was sent; try again.');
  }

  // 4. Sign, then record the signature before anything is broadcast.
  let raw: Buffer;
  let signature: string;
  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash, lastValidBlockHeight }).add(
      createTransferCheckedInstruction(p.token, new PublicKey(config.mint), new PublicKey(team.vault), pool.publicKey, CLAIM_UNITS, USDC_DECIMALS),
    );
    tx.sign(sponsor, pool);
    raw = tx.serialize();
    signature = utils.bytes.bs58.encode(tx.signature!);
  } catch {
    await release();
    return refuse(502, 'Could not reach the network to build the claim. Nothing was sent; try again.');
  }
  if (s.sql) {
    try {
      await ensureSchema(s.sql, 'claims', CLAIMS_DDL);
      await s.sql`INSERT INTO claims (day, user_id, wallet, team, amount, signature, status)
                  VALUES (${day}, ${a.userId}, ${a.wallet}, ${a.teamAddr}, ${CLAIM_UNITS.toString()}, ${signature}, 'sending')`;
    } catch (e) {
      // A unique violation is an earlier claim today: keep the locks, it stands.
      if ((e as { code?: string })?.code === '23505') return refuse(409, 'You already claimed today. A new claim opens at 00:00 UTC.', { claimed: true });
      await release();
      return refuse(503, 'Could not record the claim. Nothing was sent; try again.');
    }
  }

  // 5. Send and settle the record.
  const sent = await broadcast(raw, signature, true).catch(() => ({ signature, status: 'pending' as const, error: undefined }));
  const mark = async (status: string, error?: string) => {
    if (!s.sql) return;
    await s.sql`UPDATE claims SET status = ${status}, error = ${error ?? null}, updated_at = now() WHERE signature = ${signature}`.catch(() => {});
  };
  if (sent.status === 'failed') {
    await mark('failed', sent.error?.slice(0, 200));
    await release();
    await s.incrBy(keys.count(day), -1n).catch(() => {});
    const empty = /insufficient funds|0x1\b/i.test(sent.error ?? '');
    return empty
      ? refuse(410, 'The pool is empty. Every test USDC it held has been claimed.', { empty: true })
      : refuse(422, `The network refused the claim: ${sent.error ?? 'unknown reason'}. Nothing moved; you can try again.`);
  }
  await mark(sent.status);
  await Promise.allSettled([s.set(uKey, signature, LOCK_TTL), s.set(wKey, signature, LOCK_TTL)]);
  balanceCache = null;
  return {
    http: sent.status === 'confirmed' ? 200 : 202,
    body: {
      ok: true,
      status: sent.status,
      signature,
      amount: CLAIM_UNITS.toString(),
      day,
      nextAt: nextClaimAt(a.nowMs),
      ...(sent.status === 'pending' ? { note: 'Sent, not confirmed yet. Check the signature before trying again; today is already counted.' } : {}),
    },
  };
}
