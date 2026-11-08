// The fee sponsor. A wallet signs its part of a Rein transaction with the sponsor as fee payer;
// this route checks it, co-signs as fee payer and sends it, so people and agents never hold SOL.
// It refuses anything but Rein's user instructions (and compute-budget settings), plus one
// create-if-missing of the signer's own test-USDC account for a withdraw. The sponsor key may appear
// only as the fee payer, as the `payer` of pay, create_team or add_spender, and as the payer of that
// token account.
//
// Rate limits: a request with a verified Privy access token is limited per Privy user; one without
// a token per IP, as before; one with a token that fails verification is refused.

import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import { utils } from '@coral-xyz/anchor';
import { PROGRAM_ID } from '@/lib/chain';
import { instructionName, readConfig } from '@/lib/rein';
import { serverKey } from '@/lib/server/keys';
import { allow, allowKey, tooMany } from '@/lib/server/limit';
import { privySession } from '@/lib/server/privy';
import { broadcast, serverConnection } from '@/lib/server/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set([
  'pay',
  'approve',
  'decline',
  'cancel',
  'create_team',
  'add_spender',
  'set_policy',
  'set_services',
  'set_spender_status',
  'revoke',
  'set_paused',
  'withdraw',
]);
/** Where the sponsor may sit: account 0 (`payer`) of these, and nowhere else. */
const PAYER_AT_ZERO = new Set(['pay', 'create_team', 'add_spender']);
const MAX_IXS = 6;
const MAX_CU_PRICE = 100_000n; // micro-lamports per CU
const MAX_CU_LIMIT = 400_000;

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function GET() {
  const sponsor = serverKey('sponsor');
  if (!sponsor) return fail('no sponsor on this server', 404);
  return Response.json({ address: sponsor.publicKey.toBase58() });
}

/** The registry's mint, cached for a minute: the only token whose account the sponsor will open. */
let mintCache: { mint: string; at: number } | null = null;
async function registryMint(): Promise<string | null> {
  if (mintCache && Date.now() - mintCache.at < 60_000) return mintCache.mint;
  const config = await readConfig(serverConnection());
  if (!config) return null;
  mintCache = { mint: config.mint, at: Date.now() };
  return config.mint;
}

export async function POST(req: Request) {
  const session = await privySession(req);
  if (session.kind === 'invalid') return fail('Your session has expired. Sign in again.', 401);
  const within = session.kind === 'user' ? allowKey('sponsor', `user:${session.userId}`, 30, 60_000) : allow('sponsor', req, 20, 60_000);
  if (!within) return tooMany();
  const sponsor = serverKey('sponsor');
  if (!sponsor) return fail('no sponsor on this server', 503);

  let tx: Transaction;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return fail('request too large', 413);
    const body = JSON.parse(raw) as { tx?: unknown };
    if (typeof body.tx !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.tx)) return fail('tx must be base64');
    const bytes = Buffer.from(body.tx, 'base64');
    if (bytes.length > 1232) return fail('transaction too large');
    tx = Transaction.from(bytes);
  } catch {
    return fail('not a legacy transaction');
  }

  if (!tx.feePayer || !tx.feePayer.equals(sponsor.publicKey)) return fail('the sponsor must be the fee payer');
  if (tx.instructions.length === 0 || tx.instructions.length > MAX_IXS) return fail('1 to 6 instructions');

  const signers = new Set(tx.signatures.map((x) => x.publicKey.toBase58()));
  let reinCount = 0;
  let ataCount = 0;
  for (const ix of tx.instructions) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const tag = ix.data[0];
      if (tag === 2 && ix.data.length === 5) {
        if (ix.data.readUInt32LE(1) > MAX_CU_LIMIT) return fail('compute limit too high');
      } else if (tag === 3 && ix.data.length === 9) {
        if (ix.data.readBigUInt64LE(1) > MAX_CU_PRICE) return fail('priority fee too high');
      } else {
        return fail('only compute unit limit and price are allowed');
      }
      if (ix.keys.length !== 0) return fail('compute budget takes no accounts');
      continue;
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // CreateIdempotent of the signer's own account for the registry's token, at most once.
      // Accounts: payer, the token account, its owner, the mint, system program, token program.
      if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) return fail('only creating your own token account is sponsored');
      if (++ataCount > 1) return fail('one token account at a time');
      const owner = ix.keys[2].pubkey;
      if (owner.equals(sponsor.publicKey) || !signers.has(owner.toBase58())) return fail('the token account must be your own');
      const mint = await registryMint();
      if (!mint) return fail('Could not read the Rein config from chain. Nothing was sent.', 502);
      if (ix.keys[3].pubkey.toBase58() !== mint) return fail('only the registry token is sponsored');
      for (let i = 1; i < ix.keys.length; i++) if (ix.keys[i].pubkey.equals(sponsor.publicKey)) return fail('the sponsor may only pay for the token account');
      continue;
    }
    if (!ix.programId.equals(PROGRAM_ID)) return fail(`program ${ix.programId.toBase58()} is not allowed`);
    const name = instructionName(ix.data);
    if (!name || !ALLOWED.has(name)) return fail(`instruction ${name ?? 'unknown'} is not sponsored`);
    reinCount++;
    for (let i = 0; i < ix.keys.length; i++) {
      if (!ix.keys[i].pubkey.equals(sponsor.publicKey)) continue;
      if (!(i === 0 && PAYER_AT_ZERO.has(name))) return fail(`the sponsor may not appear as account ${i} of ${name}`);
    }
  }
  if (reinCount === 0) return fail('no Rein instruction');

  // Every other required signature must already be there and valid.
  tx.partialSign(sponsor);
  if (!tx.verifySignatures(true)) return fail('a required signature is missing or invalid');

  const signature = utils.bytes.bs58.encode(tx.signature!);
  const sent = await broadcast(tx.serialize(), signature, false).catch(() => ({ signature, status: 'pending' as const }));
  if (sent.status === 'failed') return fail(sent.error ?? 'the transaction was refused', 422);
  // Sent: the client confirms by signature.
  return Response.json({ ok: true, sent: true, signature });
}
