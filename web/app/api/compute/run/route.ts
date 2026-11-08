// Runs a paid compute quote once.   POST { intent }
// The payment record is derived here from the quoted spender and the intent, never taken from the
// client, and must be a Rein Payment that is Paid or Settled for exactly the quoted team, spender,
// service, payee and amount. A run that cannot happen after payment is refunded in full.

import { run } from '@/lib/server/compute/core';
import { computeDeps } from '@/lib/server/compute/wire';
import { allow, tooMany } from '@/lib/server/limit';
import { storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let body: { intent?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 512) return fail('request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return fail('bad json');
  }
  if (!body || typeof body !== 'object' || typeof body.intent !== 'string') return fail('intent is required');
  if (!allow('compute-run', req, 60, 10 * 60_000)) return tooMany();
  const deps = computeDeps();
  if (!deps) return storeUnavailable();
  try {
    const r = await run(deps, body.intent);
    return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    // Unknown state: the payment may be fine and the run may not have started. Retrying is safe.
    return Response.json({ ok: false, status: 'unknown', error: 'The run could not be checked. Try again.' }, { status: 503 });
  }
}
