// The service registry, read once a minute and shared, instead of one getProgramAccounts per browser.

import { cachedServices } from '@/lib/server/team-cache';
import { toWire } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const services = await cachedServices().catch(() => null);
  return new Response(toWire({ ok: services !== null, services }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
