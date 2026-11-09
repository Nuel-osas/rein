// Server state for the compute gateway and the claim pool. Redis (REDIS_URL) holds locks, counters
// and TTL'd records; Postgres (DATABASE_URL) holds the durable rows. An in-memory store stands in
// for both in dev and tests only: in production a missing REDIS_URL means `store()` returns null
// and the route answers 503 (`storeUnavailable()`). Fail closed; never fall back silently.
// Import only from route handlers and other server modules.

import Redis from 'ioredis';
import postgres from 'postgres';

/** Redis semantics. Values are strings; TTLs are whole seconds. */
export interface KV {
  get(key: string): Promise<string | null>;
  /** SET key val EX ttlSec. */
  set(key: string, val: string, ttlSec: number): Promise<void>;
  /** SET key val NX EX ttlSec: true only for the caller that created the key. */
  setNX(key: string, val: string, ttlSec: number): Promise<boolean>;
  /** INCRBY key by; when ttlSec is given the key's expiry is (re)set to it. Returns the new value. */
  incrBy(key: string, by: bigint, ttlSec?: number): Promise<bigint>;
  del(key: string): Promise<void>;
}

export type Sql = ReturnType<typeof postgres>;

export interface Store extends KV {
  kind: 'redis' | 'memory';
  /** Postgres, or null when DATABASE_URL is not set (dev and tests). */
  sql: Sql | null;
}

// ----- in-memory (dev and tests only) -----

type Entry = { val: string; expires: number };

export class MemoryKV implements KV {
  private m = new Map<string, Entry>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  private live(key: string): Entry | null {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.expires <= this.now()) {
      this.m.delete(key);
      return null;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.val ?? null;
  }
  async set(key: string, val: string, ttlSec: number) {
    this.m.set(key, { val, expires: this.now() + ttlSec * 1000 });
  }
  async setNX(key: string, val: string, ttlSec: number) {
    if (this.live(key)) return false;
    this.m.set(key, { val, expires: this.now() + ttlSec * 1000 });
    return true;
  }
  async incrBy(key: string, by: bigint, ttlSec?: number) {
    const e = this.live(key);
    let cur = 0n;
    if (e) {
      if (!/^-?\d+$/.test(e.val)) throw new Error('ERR value is not an integer');
      cur = BigInt(e.val);
    }
    const next = cur + by;
    const expires = ttlSec !== undefined ? this.now() + ttlSec * 1000 : (e?.expires ?? Number.POSITIVE_INFINITY);
    this.m.set(key, { val: next.toString(), expires });
    return next;
  }
  async del(key: string) {
    this.m.delete(key);
  }
}

// ----- Redis -----

class RedisKV implements KV {
  constructor(private r: Redis) {}
  async get(key: string) {
    return this.r.get(key);
  }
  async set(key: string, val: string, ttlSec: number) {
    await this.r.set(key, val, 'EX', ttlSec);
  }
  async setNX(key: string, val: string, ttlSec: number) {
    return (await this.r.set(key, val, 'EX', ttlSec, 'NX')) === 'OK';
  }
  async incrBy(key: string, by: bigint, ttlSec?: number) {
    const m = this.r.multi().incrby(key, by.toString());
    if (ttlSec !== undefined) m.expire(key, ttlSec);
    const res = await m.exec();
    if (!res) throw new Error('redis transaction aborted');
    const [err, val] = res[0];
    if (err) throw err;
    return BigInt(val as number | string);
  }
  async del(key: string) {
    await this.r.del(key);
  }
}

// ----- selection -----

/** Production is NODE_ENV=production unless REIN_ALLOW_MEMORY_STORE=1 (a local `next start` only). */
function memoryAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.REIN_ALLOW_MEMORY_STORE === '1';
}

type Cached = { store: Store | null };
const g = globalThis as unknown as { __reinStore?: Cached };

function make(): Store | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  const dbUrl = process.env.DATABASE_URL?.trim();
  const sql: Sql | null = dbUrl
    ? postgres(dbUrl, { max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} })
    : null;
  if (redisUrl) {
    const r = new Redis(redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 5_000, enableOfflineQueue: true, lazyConnect: false });
    // Errors surface on each command; this only keeps an unhandled 'error' event from crashing the process.
    r.on('error', () => {});
    const kv = new RedisKV(r);
    return { kind: 'redis', sql, ...bind(kv) };
  }
  if (!memoryAllowed()) return null;
  const kv = new MemoryKV();
  return { kind: 'memory', sql, ...bind(kv) };
}

function bind(kv: KV): KV {
  return {
    get: kv.get.bind(kv),
    set: kv.set.bind(kv),
    setNX: kv.setNX.bind(kv),
    incrBy: kv.incrBy.bind(kv),
    del: kv.del.bind(kv),
  };
}

/** The process-wide store, or null in production when REDIS_URL is missing (answer 503). */
export function store(): Store | null {
  if (!g.__reinStore) g.__reinStore = { store: make() };
  return g.__reinStore.store;
}

/** Replace the store (tests). Pass undefined to rebuild from env on next use. */
export function setStoreForTests(s: Store | null | undefined) {
  g.__reinStore = s === undefined ? undefined : { store: s };
}

export function memoryStore(now?: () => number): Store {
  return { kind: 'memory', sql: null, ...bind(new MemoryKV(now)) };
}

export function storeUnavailable() {
  return Response.json({ ok: false, error: 'This service is not available: its state store is not configured.' }, { status: 503 });
}

// ----- Postgres schema, migrated on first use -----

const done = new Map<string, Promise<void>>();

/** Runs `ddl` once per process under `name` (idempotent DDL only: CREATE ... IF NOT EXISTS). */
export function ensureSchema(sql: Sql, name: string, ddl: string): Promise<void> {
  let p = done.get(name);
  if (!p) {
    p = sql.unsafe(ddl).then(() => undefined);
    p.catch(() => done.delete(name));
    done.set(name, p);
  }
  return p;
}

/** The compute gateway's durable record. Redis holds the locks, counters and TTLs. */
export const COMPUTE_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS compute_runs (
  intent       text PRIMARY KEY,
  team         text NOT NULL,
  spender      text NOT NULL,
  service      text NOT NULL,
  amount       bigint NOT NULL,
  status       text NOT NULL,
  result_hash  text,
  refund_sig   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compute_runs_team_created ON compute_runs (team, created_at DESC);
`;

export function ensureComputeRuns(sql: Sql): Promise<void> {
  return ensureSchema(sql, 'compute_runs', COMPUTE_RUNS_DDL);
}

/**
 * Binary inputs and outputs of compute runs, by intent: the ai-voice audio a quote bound (role
 * 'input', compute_inputs) and the ai-image image a run delivered (role 'output', compute_results).
 * Kept durably, unlike the TTL'd Redis result.
 */
export const COMPUTE_BLOBS_DDL = `
CREATE TABLE IF NOT EXISTS compute_results (
  intent      text PRIMARY KEY,
  mime        text NOT NULL,
  bytes       bytea NOT NULL,
  sha256      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS compute_inputs (
  intent      text PRIMARY KEY,
  mime        text NOT NULL,
  bytes       bytea NOT NULL,
  sha256      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
`;

export function ensureComputeBlobs(sql: Sql): Promise<void> {
  return ensureSchema(sql, 'compute_blobs', COMPUTE_BLOBS_DDL);
}
