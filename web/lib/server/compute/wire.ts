// Real dependencies for the compute gateway: chain reads, the gateway key, the refund, the 0G
// backend and the durable record. Import only from route handlers.

import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';
import { utils } from '@coral-xyz/anchor';
import { PROGRAM_ID, USDC_DECIMALS } from '@/lib/chain';
import { pda, readConfig, readTeam, toPayment, toService } from '@/lib/rein';
import { serverKey } from '@/lib/server/keys';
import { broadcast, serverConnection } from '@/lib/server/send';
import { store, type Store } from '@/lib/server/store';
import { recordRun } from './record';
import { readComputeEnv, REFUND_TTL_SEC, RESULT_TTL_SEC, type ComputeService, type Deps, type Quote, type RefundOutcome } from './core';
import { backendEnv, chooseBackend, fakeBackend } from './backend';
import { kvBlobs, sqlBlobs } from './blobs';

let mintCache: { mint: string; at: number } | null = null;
async function mint(): Promise<string | null> {
  if (mintCache && Date.now() - mintCache.at < 5 * 60_000) return mintCache.mint;
  const c = await readConfig(serverConnection());
  if (!c) return null;
  mintCache = { mint: c.mint, at: Date.now() };
  return c.mint;
}

async function gatewayToken(): Promise<string | null | 'error'> {
  const gw = serverKey('gateway');
  if (!gw) return null;
  const m = await mint();
  if (!m) return 'error';
  return getAssociatedTokenAddressSync(new PublicKey(m), gw.publicKey).toBase58();
}

async function readService(id: ComputeService) {
  const address = pda.service(id);
  try {
    const info = await serverConnection().getAccountInfo(address, 'confirmed');
    if (!info) return null;
    const s = toService(address.toBase58(), info);
    return s ? { address: s.address, payeeToken: s.payeeToken, active: s.active } : null;
  } catch {
    return 'error' as const;
  }
}

async function readPayment(address: string) {
  try {
    const info = await serverConnection().getAccountInfo(new PublicKey(address), 'confirmed');
    if (!info) return null;
    const owner = info.owner.toBase58();
    const p = toPayment(address, info);
    // Not ours, or not a Payment: report the owner so the caller refuses it.
    if (!p) return { owner: owner === PROGRAM_ID.toBase58() ? 'undecodable' : owner, team: '', spender: '', service: '', payeeToken: '', amount: 0n, status: 'invalid', deadline: 0 };
    return { owner, team: p.team, spender: p.spender, service: p.service, payeeToken: p.payeeToken, amount: p.amount, status: p.status, deadline: p.deadline };
  } catch {
    return 'error' as const;
  }
}

/**
 * Sends the full quoted amount back from the gateway's token account to the team vault, signed by
 * the gateway key with the sponsor paying the fee. `refund:<intent>` is written with the signature
 * before anything is broadcast, and only by the caller that created it, so a refund is never sent
 * twice. A send whose fate is unknown stays pending under that signature.
 */
function makeRefund(kv: Store) {
  return async (q: Quote, reason: string): Promise<RefundOutcome> => {
    const key = `refund:${q.intent}`;
    const prior = await kv.get(key);
    if (prior) {
      const p = JSON.parse(prior) as { signature: string; state: 'confirmed' | 'pending' | 'failed' | 'signed'; reason: string };
      return { state: p.state, signature: p.signature, reason: p.reason };
    }
    const gw = serverKey('gateway');
    const sponsor = serverKey('sponsor');
    if (!gw || !sponsor) return { state: 'unavailable', error: 'the gateway or sponsor key is not configured' };
    const conn = serverConnection();
    const [m, team] = await Promise.all([mint(), readTeam(conn, q.team)]);
    if (!m || !team) return { state: 'unavailable', error: 'could not read the team or the token mint' };
    if (team.mint !== m) return { state: 'unavailable', error: 'the team holds a different token' };
    const source = getAssociatedTokenAddressSync(new PublicKey(m), gw.publicKey);
    if (source.toBase58() !== q.payeeToken) return { state: 'unavailable', error: 'the quoted payee is not the gateway account' };
    let blockhash: string, lastValidBlockHeight: number;
    try {
      ({ blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed'));
    } catch {
      return { state: 'unavailable', error: 'could not fetch a blockhash' };
    }
    const ix = createTransferCheckedInstruction(source, new PublicKey(m), new PublicKey(team.vault), gw.publicKey, BigInt(q.amount), USDC_DECIMALS);
    const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    tx.sign(sponsor, gw);
    const signature = utils.bytes.bs58.encode(tx.signature!);
    const rec = { signature, state: 'signed', reason, at: Date.now(), amount: q.amount, vault: team.vault };
    if (!(await kv.setNX(key, JSON.stringify(rec), REFUND_TTL_SEC))) {
      const p = JSON.parse((await kv.get(key)) ?? '{}');
      return { state: p.state ?? 'pending', signature: p.signature ?? signature, reason: p.reason ?? reason };
    }
    const sent = await broadcast(tx.serialize(), signature);
    // Preflight refused means nothing was broadcast; the record stays so an operator decides, never an automatic resend.
    const state = sent.status === 'confirmed' ? 'confirmed' : sent.status === 'failed' ? 'failed' : 'pending';
    await kv.set(key, JSON.stringify({ ...rec, state, ...(sent.error ? { error: sent.error } : {}) }), REFUND_TTL_SEC);
    return { state, signature, reason };
  };
}

function makeRecord(kv: Store): Deps['record'] {
  const sql = kv.sql;
  return sql ? (r) => recordRun(sql, r) : undefined;
}

/** The gateway's dependencies, or null when the store is not configured (answer 503). */
export function computeDeps(): Deps | null {
  const kv = store();
  if (!kv) return null;
  const env = readComputeEnv();
  return {
    store: kv,
    env,
    programId: PROGRAM_ID.toBase58(),
    now: Date.now,
    readService,
    gatewayToken,
    spenderPda: (team, authority) => pda.spender(new PublicKey(team), new PublicKey(authority)).toBase58(),
    paymentPda: (spender, intent) => pda.payment(new PublicKey(spender), intent).toBase58(),
    readPayment,
    backend: async (service: ComputeService) => {
      // Dev only (env.fake is forced off in production). COMPUTE_FAKE_FAIL=1 exercises the refund path.
      if (env.fake) return fakeBackend({ fail: process.env.COMPUTE_FAKE_FAIL === '1' });
      // Per service (backend.ts chooseBackend): chat, voice and image on the 0G Compute SDK with the
      // funded wallet (chat on the Router in private mode when its key is set); Claude and GPT on
      // 0G Private Computer (the Router, one sk- key funded at pc.0g.ai) only.
      return chooseBackend(service, backendEnv());
    },
    // Postgres when configured; otherwise Redis with the result TTL, for small blobs only.
    blobs: kv.sql ? sqlBlobs(kv.sql) : kvBlobs(kv, RESULT_TTL_SEC),
    refund: makeRefund(kv),
    record: makeRecord(kv),
  };
}
