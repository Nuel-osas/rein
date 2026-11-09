// Prices one paid 0G compute run and returns the intent to pay it under.
//   POST { team, service: "<id from /api/compute/catalog>", prompt? , audio?: { base64, mime }, authority? }
// prompt for the text and image services; audio (ai-voice) is base64 of the file, at most 3 MB and
// 60 s, and its sha256 is bound into the intent the way a prompt's is. `authority` is the spender
// key that will sign `pay`; it defaults to the team's agent key. Nothing moves here: the caller pays
// the quoted amount to the quoted service with the intent, then calls /api/compute/run.

import { agentKeyFor } from '@/lib/server/agent-key';
import { quote } from '@/lib/server/compute/core';
import { readComputeRequest } from '@/lib/server/compute/request';
import { computeDeps } from '@/lib/server/compute/wire';
import { allow, tooMany } from '@/lib/server/limit';
import { storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const r0 = await readComputeRequest(req);
  if ('error' in r0) return fail(r0.error, r0.status);
  let authority = r0.authority;
  if (authority === undefined) {
    authority = agentKeyFor(r0.team)?.publicKey.toBase58() ?? null;
    if (!authority) return fail('No agent key is configured on this server; pass authority.', 503);
  }
  if (!authority) return fail('authority must be a public key');
  if (!allow('compute-quote', req, 30, 10 * 60_000)) return tooMany();

  const deps = computeDeps();
  if (!deps) return storeUnavailable();
  try {
    const r = await quote(deps, { team: r0.team, authority, service: r0.service, prompt: r0.prompt, audio: r0.audio });
    return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return fail('The quote could not be made. Try again.', 503);
  }
}
