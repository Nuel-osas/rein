// The public key of a team's agent, so the owner can add it as a spender.   GET ?team=<team PDA>
// Only the public key: the secret is derived on the server from REIN_AGENT_SEED and never leaves it.
// For the demo team it is the demo agent's key, the one /api/agent and /api/compute/buy act with
// there (lib/server/team-agent.ts), so the Compute page finds the demo team's research agent.

import { DEMO_TEAM, parseAddress } from '@/lib/chain';
import { agentKeyFor } from '@/lib/server/agent-key';
import { serverKey } from '@/lib/server/keys';
import { allow, tooMany } from '@/lib/server/limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!allow('agent-key', req, 60, 60_000)) return tooMany();
  const team = parseAddress(new URL(req.url).searchParams.get('team'));
  if (!team) return Response.json({ ok: false, error: 'team must be a team account address' }, { status: 400 });
  const kp = team === DEMO_TEAM ? serverKey('demoAgent') : agentKeyFor(team);
  if (!kp) return Response.json({ ok: false, error: 'No agent key is configured on this server.' }, { status: 503 });
  return Response.json({ ok: true, team, agent: kp.publicKey.toBase58() }, { headers: { 'cache-control': 'no-store' } });
}
