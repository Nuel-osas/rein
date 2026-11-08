// The public demo: lets anyone, with no wallet, act as the demo team's owner on three things.
//   approve | decline  a Pending payment on the demo team, signed by the demo owner key
//   reset              top the demo vault back up to 500 test USDC from the mint authority
// Inputs are checked against chain before anything is signed: the payment must exist, belong to the
// demo team and be Pending. The sponsor pays the fee when one is configured. Rate-limited per IP.

import { createMintToInstruction } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { DEMO_TEAM, parseAddress } from '@/lib/chain';
import { ixs, readConfig, readPayment, readTeam, readTokenBalance } from '@/lib/rein';
import { serverKey } from '@/lib/server/keys';
import { allow, tooMany } from '@/lib/server/limit';
import { sendSigned, serverConnection } from '@/lib/server/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESET_TARGET = 500_000_000n; // 500 USDC in base units

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let body: { action?: unknown; payment?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 512) return fail('request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return fail('bad json');
  }
  if (!body || typeof body !== 'object') return fail('bad request');
  const action = body.action;
  if (action !== 'approve' && action !== 'decline' && action !== 'reset') return fail('action must be approve, decline or reset');
  if (action === 'reset' ? !allow('demo-reset', req, 4, 60_000) : !allow('demo', req, 30, 60_000)) return tooMany();

  if (!DEMO_TEAM) return fail('No demo team is configured on this server.', 503);
  const owner = serverKey('demoOwner');
  if (!owner) return fail('The demo owner key is not configured on this server.', 503);
  const sponsor = serverKey('sponsor');
  const conn = serverConnection();

  try {
    const team = await readTeam(conn, DEMO_TEAM);
    if (!team) return fail('Could not read the demo team from chain. Try again.', 502);
    if (team.owner !== owner.publicKey.toBase58()) return fail('The demo owner key does not own the demo team.', 503);

    if (action === 'reset') {
      const authority = serverKey('mintAuthority');
      if (!authority) return fail('The mint authority key is not configured on this server.', 503);
      const config = await readConfig(conn);
      if (!config) return fail('Could not read the Rein config from chain.', 502);
      if (config.mint !== team.mint) return fail('The demo team holds a different token than the registry.', 503);
      const balance = await readTokenBalance(conn, team.vault);
      if (balance === null) return fail('Could not read the demo vault. Nothing was minted.', 502);
      if (balance >= RESET_TARGET) return Response.json({ ok: true, status: 'confirmed', note: 'The demo vault already holds 500 USDC or more.' });
      const amount = RESET_TARGET - balance;
      const ix = createMintToInstruction(new PublicKey(config.mint), new PublicKey(team.vault), authority.publicKey, amount);
      const sent = await sendSigned([ix], sponsor ? [sponsor, authority] : [authority]);
      return Response.json({ ok: sent.status !== 'failed', ...sent, minted: amount.toString() });
    }

    const address = parseAddress(typeof body.payment === 'string' ? body.payment : null);
    if (!address) return fail('payment must be a payment account address');
    const payment = await readPayment(conn, address);
    if (!payment) return fail('That is not a Rein payment account.', 404);
    if (payment.team !== DEMO_TEAM) return fail('That payment is not on the demo team.', 403);
    if (payment.status !== 'pending') return fail(`That payment is ${payment.status}, not pending.`, 409);
    if (action === 'approve' && Date.now() / 1000 >= payment.deadline) return fail('That payment is past its approval deadline.', 409);

    const ix =
      action === 'approve'
        ? ixs.approve({ owner: owner.publicKey, team, payment })
        : ixs.decline({ owner: owner.publicKey, team: team.address, payment: payment.address });
    const signers = sponsor && !sponsor.publicKey.equals(owner.publicKey) ? [sponsor, owner] : [owner];
    const sent = await sendSigned([ix], signers);
    // An approval can still be refused at settlement (a stop applied); report what the chain says.
    const after = sent.status === 'confirmed' ? await readPayment(conn, address) : null;
    return Response.json({ ok: sent.status !== 'failed', ...sent, result: after?.status ?? null });
  } catch (e) {
    return fail(String((e as Error)?.message ?? e).slice(0, 200), 500);
  }
}
