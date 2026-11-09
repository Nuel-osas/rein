// Where run inputs (ai-voice audio) and image results (ai-image) are kept, by intent.
//   Postgres (DATABASE_URL): compute_inputs and compute_results, bytea plus mime, durable.
//   Without Postgres: the KV store (Redis, or memory in dev and tests) with a TTL, only for blobs up
//   to KV_MAX_BYTES; anything larger is refused, so a quote or result is never half stored.
// A failed read throws, so the caller answers "unknown" and never "missing".

import { createHash } from 'node:crypto';
import { ensureComputeBlobs, type KV, type Sql } from '../store';
import type { BlobStore } from './core';

export const KV_MAX_BYTES = 1024 * 1024;
const TABLE = { input: 'compute_inputs', output: 'compute_results' } as const;

export function sqlBlobs(sql: Sql): BlobStore {
  return {
    async put(intent, role, mime, bytes) {
      await ensureComputeBlobs(sql);
      const sha = createHash('sha256').update(bytes).digest('hex');
      // First write wins: a stored input or result is never replaced under the same intent.
      await sql`INSERT INTO ${sql(TABLE[role])} (intent, mime, bytes, sha256) VALUES (${intent}, ${mime}, ${Buffer.from(bytes)}, ${sha}) ON CONFLICT (intent) DO NOTHING`;
    },
    async get(intent, role) {
      await ensureComputeBlobs(sql);
      const rows = await sql<{ mime: string; bytes: Buffer; sha256: string }[]>`SELECT mime, bytes, sha256 FROM ${sql(TABLE[role])} WHERE intent = ${intent}`;
      const r = rows[0];
      if (!r) return null;
      const bytes = new Uint8Array(r.bytes);
      // A row whose bytes no longer hash to what was written is not served.
      if (createHash('sha256').update(bytes).digest('hex') !== r.sha256) throw new Error('stored blob does not match its hash');
      return { mime: r.mime, bytes };
    },
  };
}

export function kvBlobs(kv: KV, ttlSec: number): BlobStore {
  const key = (intent: string, role: string) => `blob:${role}:${intent}`;
  return {
    async put(intent, role, mime, bytes) {
      if (bytes.length > KV_MAX_BYTES) throw new Error('too large for the KV store; set DATABASE_URL');
      const ok = await kv.setNX(key(intent, role), JSON.stringify({ mime, b64: Buffer.from(bytes).toString('base64') }), ttlSec);
      if (!ok) return; // first write wins
    },
    async get(intent, role) {
      const raw = await kv.get(key(intent, role));
      if (!raw) return null;
      const j = JSON.parse(raw) as { mime?: unknown; b64?: unknown };
      if (typeof j.mime !== 'string' || typeof j.b64 !== 'string') throw new Error('malformed blob record');
      return { mime: j.mime, bytes: new Uint8Array(Buffer.from(j.b64, 'base64')) };
    },
  };
}
