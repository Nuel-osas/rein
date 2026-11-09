// Which team's agent a request may act as, shared by /api/agent and /api/compute/buy.
//   no team, or the demo team: the demo agent key, open to anyone (rate-limited per IP), as the
//     public demo always was.
//   another team: only its owner, proven by a Privy session whose linked Solana wallet owns the team
//     on chain; the agent key is the one derived for that team (agent-key.ts).
// Never returns a key the caller did not prove they may use.

import type { Keypair } from '@solana/web3.js';
import { DEMO_TEAM, parseAddress } from '@/lib/chain';
import { readTeam } from '@/lib/rein';
import { agentKeyFor } from '@/lib/server/agent-key';
import { serverKey } from '@/lib/server/keys';
import { allow, allowKey } from '@/lib/server/limit';
import { privySession, privySolanaWallets } from '@/lib/server/privy';
import { serverConnection } from '@/lib/server/send';

export type TeamAgent = { ok: true; team: string; agent: Keypair; demo: boolean } | { ok: false; status: number; error: string };

/** `bucket` names the rate limit (6 per 10 minutes per IP for the demo team, per user otherwise). */
export async function teamAgent(req: Request, teamField: unknown, bucket: string): Promise<TeamAgent> {
  if (teamField === undefined || teamField === DEMO_TEAM) {
    if (!allow(bucket, req, 6, 10 * 60_000)) return { ok: false, status: 429, error: 'Too many requests. Try again in a few minutes.' };
    if (!DEMO_TEAM) return { ok: false, status: 503, error: 'No demo team is configured on this server.' };
    const agent = serverKey('demoAgent');
    if (!agent) return { ok: false, status: 503, error: 'The demo agent key is not configured on this server.' };
    return { ok: true, team: DEMO_TEAM, agent, demo: true };
  }
  const asked = parseAddress(typeof teamField === 'string' ? teamField : null);
  if (!asked) return { ok: false, status: 400, error: 'team must be a team account address' };
  const session = await privySession(req);
  if (session.kind !== 'user') return { ok: false, status: 401, error: 'Sign in as the team owner to run its agent.' };
  if (!allowKey(bucket, `user:${session.userId}`, 6, 10 * 60_000)) return { ok: false, status: 429, error: 'Too many requests. Try again in a few minutes.' };
  const [onChain, wallets] = await Promise.all([readTeam(serverConnection(), asked), privySolanaWallets(session.userId)]);
  if (!onChain) return { ok: false, status: 404, error: 'Could not read that team on chain.' };
  if (wallets === null) return { ok: false, status: 503, error: 'Could not check your wallets. Try again.' };
  if (!wallets.includes(onChain.owner)) return { ok: false, status: 403, error: 'Only the team owner can run its agent.' };
  const agent = agentKeyFor(asked);
  if (!agent) return { ok: false, status: 503, error: 'No agent key is configured on this server.' };
  return { ok: true, team: asked, agent, demo: false };
}
