// The image an ai-image run or the clip an ai-video run delivered, as stored by the gateway
// (Postgres compute_results). The intent is the capability: an unguessable HMAC, so only whoever
// holds the quote can fetch it. Served only as an image or MP4 type told by the bytes themselves,
// never as anything a browser would run.

import { resultBlob } from '@/lib/server/compute/core';
import { computeDeps } from '@/lib/server/compute/wire';
import { allow, tooMany } from '@/lib/server/limit';
import { storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ intent: string }> }) {
  if (!allow('compute-blob', req, 120, 10 * 60_000)) return tooMany();
  const { intent } = await ctx.params;
  const deps = computeDeps();
  if (!deps) return storeUnavailable();
  try {
    const r = await resultBlob(deps, intent);
    if ('status' in r) return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
    return new Response(Buffer.from(r.bytes), {
      headers: {
        'content-type': r.mime,
        'content-length': String(r.bytes.length),
        'content-disposition': `inline; filename="${intent}.${r.mime.split('/')[1]}"`,
        'cache-control': 'private, max-age=86400, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return Response.json({ ok: false, error: 'The result could not be read. Try again.' }, { status: 503 });
  }
}
