// The fee sponsor. A wallet signs its part of a Rein transaction with the sponsor as fee payer;
// this route checks it, co-signs as fee payer and sends it, so people and agents never hold SOL.
// It refuses anything but Rein's user instructions (and compute-budget settings), and the sponsor
// key may appear only as the fee payer and as the `payer` of pay, create_team or add_spender.

import { ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import { utils } from '@coral-xyz/anchor';
import { PROGRAM_ID } from '@/lib/chain';
import { instructionName } from '@/lib/rein';
import { serverKey } from '@/lib/server/keys';
import { allow, tooMany } from '@/lib/server/limit';
import { broadcast } from '@/lib/server/send';

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

export async function POST(req: Request) {
  if (!allow('sponsor', req, 20, 60_000)) return tooMany();
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

  let reinCount = 0;
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
