// Test USDC for the demo team only: mints up to 100 USDC into its vault from the mint authority.
// Any other team is refused: an open faucet would let anyone mint test USDC and buy real 0G
// compute with it through the gateway. Rate-limited per IP.

import { createMintToInstruction } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { DEMO_TEAM, parseAddress } from '@/lib/chain';
import { parseUsdc } from '@/lib/money';
import { readConfig, readTeam } from '@/lib/rein';
import { serverKey } from '@/lib/server/keys';
import { allow, tooMany } from '@/lib/server/limit';
import { sendSigned, serverConnection } from '@/lib/server/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 100_000_000n; // 100 USDC

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let body: { team?: unknown; amount?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 512) return fail('request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return fail('bad json');
  }
  if (!body || typeof body !== 'object') return fail('bad request');
  const teamAddr = parseAddress(typeof body.team === 'string' ? body.team : null);
  if (!teamAddr) return fail('team must be a team account address');
  if (!DEMO_TEAM) return fail('The faucet is not configured on this server.', 503);
  if (teamAddr !== DEMO_TEAM) return fail('The faucet only tops up the demo team.', 403);
  const amount = body.amount === undefined ? MAX : typeof body.amount === 'string' ? parseUsdc(body.amount) : null;
  if (amount === null || amount <= 0n) return fail('amount must be a USDC amount above 0, like "25"');
  if (amount > MAX) return fail('The faucet gives at most 100 USDC at a time.');
  if (!allow('faucet', req, 3, 10 * 60_000)) return tooMany();

  const authority = serverKey('mintAuthority');
  if (!authority) return fail('The faucet is not configured on this server.', 503);
  const sponsor = serverKey('sponsor');
  const conn = serverConnection();
  try {
    const [team, config] = await Promise.all([readTeam(conn, teamAddr), readConfig(conn)]);
    if (!config) return fail('Could not read the Rein config from chain.', 502);
    if (!team) return fail('That address is not a Rein team.', 404);
    if (team.mint !== config.mint) return fail('That team holds a different token than the registry.', 409);
    const ix = createMintToInstruction(new PublicKey(config.mint), new PublicKey(team.vault), authority.publicKey, amount);
    const sent = await sendSigned([ix], sponsor ? [sponsor, authority] : [authority]);
    return Response.json({ ok: sent.status !== 'failed', ...sent, minted: amount.toString() });
  } catch (e) {
    return fail(String((e as Error)?.message ?? e).slice(0, 200), 500);
  }
}
