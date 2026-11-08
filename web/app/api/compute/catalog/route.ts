// The compute services on sale: id, label, 0G model, limits and the live test-USDC price of one run
// (null with a reason when it cannot be quoted right now). Only services registered and active in
// the Rein registry with this gateway as payee are listed.

import { catalog } from '@/lib/server/compute/core';
import { computeDeps } from '@/lib/server/compute/wire';
import { allow, tooMany } from '@/lib/server/limit';
import { storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!allow('compute-catalog', req, 60, 60_000)) return tooMany();
  const deps = computeDeps();
  if (!deps) return storeUnavailable();
  try {
    const r = await catalog(deps);
    return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'The catalog could not be read. Try again.' }, { status: 503 });
  }
}
