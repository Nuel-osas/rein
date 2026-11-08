// Prices one paid 0G compute run and returns the intent to pay it under.
//   POST { team, service: "<id from /api/compute/catalog>", prompt, authority? }
// `authority` is the spender key that will sign `pay`; it defaults to the team's agent key.
// Nothing moves here: the caller pays the quoted amount to the quoted service with the intent,
// then calls /api/compute/run.

import { parseAddress } from '@/lib/chain';
import { agentKeyFor } from '@/lib/server/agent-key';
import { isComputeService, quote, SERVICE_TABLE } from '@/lib/server/compute/core';
import { computeDeps } from '@/lib/server/compute/wire';
import { allow, tooMany } from '@/lib/server/limit';
import { storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let body: { team?: unknown; service?: unknown; prompt?: unknown; authority?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 20_000) return fail('request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return fail('bad json');
  }
  if (!body || typeof body !== 'object') return fail('bad request');
  const team = parseAddress(typeof body.team === 'string' ? body.team : null);
  if (!team) return fail('team must be a team account address');
  if (!isComputeService(body.service)) return fail(`service must be one of: ${Object.keys(SERVICE_TABLE).join(', ')}`);
  const maxChars = SERVICE_TABLE[body.service].maxPromptChars;
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) return fail('prompt is required');
  // The adapter checks the trimmed prompt against the same limit; the quote binds it as sent.
  if (body.prompt.length > maxChars) return fail(`prompt is at most ${maxChars} characters`);
  let authority: string | null;
  if (body.authority !== undefined) {
    authority = parseAddress(typeof body.authority === 'string' ? body.authority : null);
    if (!authority) return fail('authority must be a public key');
  } else {
    authority = agentKeyFor(team)?.publicKey.toBase58() ?? null;
    if (!authority) return fail('No agent key is configured on this server; pass authority.', 503);
  }
  if (!allow('compute-quote', req, 30, 10 * 60_000)) return tooMany();

  const deps = computeDeps();
  if (!deps) return storeUnavailable();
  try {
    const r = await quote(deps, { team, authority, service: body.service, prompt: body.prompt });
    return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return fail('The quote could not be made. Try again.', 503);
  }
}
