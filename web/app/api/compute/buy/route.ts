// Buys one compute run with the team's Rein agent key, with no model in the loop: quote, then pay
// the quoted amount to the quoted service under the agent's on-chain policy.
//   POST { team?, service, prompt? , audio?: { base64, mime } }
// The demo team (no `team`, or the demo team's address) is open to anyone, rate-limited; another
// team needs `Authorization: Bearer <Privy token>` of a user whose linked wallet owns it, as /api/agent.
// The program decides: inside the policy the payment settles (status paid) and the caller then asks
// /api/compute/run; over a limit it is filed Pending for the owner (status pending). This route
// never runs the model itself, so a slow 0G run never shares a function's time with the payment.

import { PublicKey } from '@solana/web3.js';
import { describeError, payService, ReinChain } from '@rein/agent';
import { DEMO_TEAM, PROGRAM_ID } from '@/lib/chain';
import { quote } from '@/lib/server/compute/core';
import { readComputeRequest } from '@/lib/server/compute/request';
import { computeDeps } from '@/lib/server/compute/wire';
import { serverKey } from '@/lib/server/keys';
import { serverConnection } from '@/lib/server/send';
import { storeUnavailable } from '@/lib/server/store';
import { teamAgent } from '@/lib/server/team-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error, ...extra }, { status });

export async function POST(req: Request) {
  // Read the body first (it carries the team; none means the demo team), then prove who may act as
  // that team's agent.
  const parsed = await readComputeRequest(req, { defaultTeam: DEMO_TEAM });
  if ('error' in parsed) return fail(parsed.error, parsed.status);
  const who = await teamAgent(req, parsed.team, 'compute-buy');
  if (!who.ok) return fail(who.error, who.status);
  const sponsor = serverKey('sponsor');
  if (!sponsor) return fail('The sponsor key is not configured on this server.', 503);
  const deps = computeDeps();
  if (!deps) return storeUnavailable();

  let q;
  try {
    q = await quote(deps, { team: who.team, authority: who.agent.publicKey.toBase58(), service: parsed.service, prompt: parsed.prompt, audio: parsed.audio });
  } catch {
    return fail('The quote could not be made. Try again.', 503);
  }
  if (q.status !== 200) return Response.json(q.body, { status: q.status, headers: { 'cache-control': 'no-store' } });
  const intent = q.body.intent as string;
  const amount = BigInt(q.body.amount as string);

  const chain = new ReinChain(serverConnection(), PROGRAM_ID);
  const o = await payService({ chain, team: new PublicKey(who.team), agent: who.agent, sponsor, serviceId: parsed.service, amount, memo: `compute ${parsed.service}`, intent });
  const payment = {
    status: o.status,
    ...(o.signature ? { signature: o.signature } : {}),
    ...(o.payment ? { payment: o.payment.toBase58() } : {}),
    ...(o.reasons ? { reasons: o.reasons } : {}),
    ...(o.deadline ? { approve_by: new Date(o.deadline * 1000).toISOString() } : {}),
    ...(o.unconfirmed ? { unconfirmed: true } : {}),
    ...(o.error ? { error: describeError(o.error) } : {}),
  };
  return Response.json(
    {
      ok: true,
      intent,
      service: parsed.service,
      model: q.body.model,
      input: q.body.input,
      output: q.body.output,
      trust: q.body.trust,
      configured: q.body.configured,
      ...(q.body.note ? { note: q.body.note } : {}),
      amount: amount.toString(),
      amount_usdc: q.body.amount_usdc,
      payment,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
