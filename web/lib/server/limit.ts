// In-memory, per-IP rate limits. Each server instance keeps its own window, which is enough to
// stop one visitor hammering a route; it is not a global quota.

type Window = { start: number; count: number };
const buckets = new Map<string, Map<string, Window>>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.headers.get('x-real-ip') ?? 'local').slice(0, 64);
}

/** true when the caller is within `max` calls per `windowMs` for this route. */
export function allow(route: string, req: Request, max: number, windowMs: number): boolean {
  return allowKey(route, `ip:${clientIp(req)}`, max, windowMs);
}

/** The same window, keyed by anything: an IP, or a signed-in user's id. */
export function allowKey(route: string, key: string, max: number, windowMs: number): boolean {
  let b = buckets.get(route);
  if (!b) {
    b = new Map();
    buckets.set(route, b);
  }
  const ip = key;
  const now = Date.now();
  const w = b.get(ip);
  if (!w || now - w.start >= windowMs) {
    b.set(ip, { start: now, count: 1 });
    if (b.size > 10_000) {
      for (const [k, v] of b) if (now - v.start >= windowMs) b.delete(k);
    }
    return true;
  }
  if (w.count >= max) return false;
  w.count++;
  return true;
}

export function tooMany() {
  return Response.json({ ok: false, error: 'Too many requests from this address. Wait a minute and try again.' }, { status: 429 });
}
