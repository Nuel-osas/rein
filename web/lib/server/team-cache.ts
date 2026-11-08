// One shared, cached read of a team from chain, so every visitor is served from the same copy
// instead of each browser polling the RPC. Devnet's public RPC rate-limits getProgramAccounts per IP
// (HTTP 429 "Too many requests for a specific RPC call"), and the team view needs two of those per
// read; with a browser poller per visitor the lists failed to load for anyone who kept a page open.
//
// A read is fresh for FRESH_MS. A lock (Redis when configured, else in-process) lets one request
// refresh while the rest are served the cached copy. When the chain read fails for a part (spenders,
// payments, …) the last good value of that part is kept and named in `stale`, so the UI shows
// slightly old data with a note instead of "could not read". A part that never read stays null,
// which the UI shows as unknown, never zero.

import { loadTeam, readServices, type Service, type TeamState } from '@/lib/rein';
import { fromWire, toWire } from '@/lib/wire';
import { store } from './store';
import { serverConnection } from './send';

const FRESH_MS = 6_000;
const KEEP_SEC = 300;
const PARTS = ['team', 'config', 'balance', 'spenders', 'payments', 'services'] as const;
type Part = (typeof PARTS)[number];

type Cached = { at: number; state: TeamState };
const memory = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();

async function readCached(key: string): Promise<Cached | null> {
  const m = memory.get(key);
  const kv = store();
  if (!kv) return m ?? null;
  try {
    const raw = await kv.get(key);
    const r = raw ? fromWire<Cached>(raw) : null;
    if (r && (!m || r.at > m.at)) return r;
  } catch {
    /* the cache is an optimisation; a failed read falls back to memory */
  }
  return m ?? null;
}

async function writeCached(key: string, c: Cached): Promise<void> {
  memory.set(key, c);
  const kv = store();
  if (kv) await kv.set(key, toWire(c), KEEP_SEC).catch(() => undefined);
}

/** Keep the last good value of each part that failed to read this time. */
export function mergeStale(next: TeamState, prev: TeamState | null): { state: TeamState; stale: Part[] } {
  if (!prev || next.missing) return { state: next, stale: [] };
  const state = { ...next } as Record<Part, unknown> & TeamState;
  const stale: Part[] = [];
  for (const p of PARTS) {
    if (next[p] === null && prev[p] !== null) {
      (state as Record<Part, unknown>)[p] = prev[p];
      stale.push(p);
    }
  }
  return { state, stale };
}

export async function cachedTeamState(team: string, opts: { fresh?: boolean } = {}): Promise<{ state: TeamState; stale: Part[]; age: number }> {
  const key = `teamstate:v1:${team}`;
  const cached = await readCached(key);
  const now = Date.now();
  if (cached && !opts.fresh && now - cached.at < FRESH_MS) return { state: cached.state, stale: [], age: now - cached.at };

  // One refresh at a time per team: in-process first, then across instances through Redis.
  const running = inflight.get(key);
  if (running) {
    const c = await running;
    return { state: c.state, stale: [], age: Date.now() - c.at };
  }
  const kv = store();
  if (kv && cached) {
    const got = await kv.setNX(`teamstate:lock:${team}`, '1', 5).catch(() => true);
    if (!got) return { state: cached.state, stale: [], age: now - cached.at };
  }

  let stale: Part[] = [];
  const p = (async () => {
    const next = await loadTeam(serverConnection(), team);
    const merged = mergeStale(next, cached?.state ?? null);
    stale = merged.stale;
    const c = { at: Date.now(), state: merged.state };
    await writeCached(key, c);
    return c;
  })();
  inflight.set(key, p);
  try {
    const c = await p;
    return { state: c.state, stale, age: 0 };
  } finally {
    inflight.delete(key);
  }
}

const SERVICES_KEY = 'services:v1';
const SERVICES_FRESH_MS = 60_000;
let servicesMemory: { at: number; services: Service[] } | null = null;

/** The service registry, shared and cached for a minute. Null only when it has never been read. */
export async function cachedServices(): Promise<Service[] | null> {
  const now = Date.now();
  if (servicesMemory && now - servicesMemory.at < SERVICES_FRESH_MS) return servicesMemory.services;
  const kv = store();
  if (kv) {
    try {
      const raw = await kv.get(SERVICES_KEY);
      const r = raw ? fromWire<{ at: number; services: Service[] }>(raw) : null;
      if (r && now - r.at < SERVICES_FRESH_MS) {
        servicesMemory = r;
        return r.services;
      }
    } catch {
      /* fall through to a chain read */
    }
  }
  const services = await readServices(serverConnection());
  if (services) {
    servicesMemory = { at: Date.now(), services };
    if (kv) await kv.set(SERVICES_KEY, toWire(servicesMemory), 600).catch(() => undefined);
    return services;
  }
  return servicesMemory?.services ?? null;
}
