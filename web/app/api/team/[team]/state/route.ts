// The team view's data, read from chain once and shared (see lib/server/team-cache.ts), so browsers
// no longer poll the RPC themselves. `?fresh=1` (rate-limited) skips the freshness window after an
// action, so a payment or approval shows at once.

import { parseAddress } from '@/lib/chain';
import { cachedTeamState } from '@/lib/server/team-cache';
import { allow } from '@/lib/server/limit';
import { toWire } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ team: string }> }) {
  const team = parseAddress((await ctx.params).team);
  if (!team) return Response.json({ ok: false, error: 'not a team address' }, { status: 400 });
  if (!allow('team-state', req, 120, 60_000)) return Response.json({ ok: false, error: 'Too many requests. Wait a moment.' }, { status: 429 });
  const fresh = new URL(req.url).searchParams.get('fresh') === '1' && allow('team-state-fresh', req, 20, 60_000);
  try {
    const r = await cachedTeamState(team, { fresh });
    return new Response(toWire({ ok: true, ...r }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'Could not read the team from chain. Try again.' }, { status: 502 });
  }
}
