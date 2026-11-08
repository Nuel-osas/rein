// The stored result of a compute run (kept 7 days), or its refund. The intent is the capability:
// it is an unguessable HMAC, so only whoever holds the quote can read the answer.

import { result } from '@/lib/server/compute/core';
import { computeDeps } from '@/lib/server/compute/wire';
import { allow, tooMany } from '@/lib/server/limit';
import { storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ intent: string }> }) {
  if (!allow('compute-result', req, 120, 10 * 60_000)) return tooMany();
  const { intent } = await ctx.params;
  const deps = computeDeps();
  if (!deps) return storeUnavailable();
  try {
    const r = await result(deps, intent);
    return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'The result could not be read. Try again.' }, { status: 503 });
  }
}
