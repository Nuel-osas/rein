// The browser's side of the compute gateway (another lane's routes, documented contract):
//   POST /api/compute/run {intent}         → done {result} | refunded {refund} | 402 pending_approval/unpaid | 409 running/busy | 503 refund_due
//   GET  /api/compute/result/<intent>      → done {result} | refunded | 202 running | 404 not_run/unknown
// A missing route (404 with no JSON) is "gateway not available", never a result.

import { COMPUTE_INTENT_RE } from './agent-setup';

export type RunResult = { intent: string; service: string; model: string; text: string; fake: boolean; resultHash: string; createdAt: number };

export type Outcome =
  | { kind: 'done'; result: RunResult }
  | { kind: 'refunded'; signature: string | null; state: string | null; reason: string | null; amount: string | null }
  | { kind: 'running' }
  | { kind: 'waiting'; approveBy: string | null }
  | { kind: 'unpaid' }
  | { kind: 'not_run' }
  | { kind: 'refused'; error: string }
  | { kind: 'unavailable'; error: string }
  | { kind: 'error'; error: string };

function toOutcome(status: number, j: Record<string, unknown> | null): Outcome {
  if (!j) return status === 404 ? { kind: 'unavailable', error: 'The compute gateway is not available on this deployment.' } : { kind: 'error', error: `No readable answer (${status}).` };
  const s = typeof j.status === 'string' ? j.status : null;
  const err = typeof j.error === 'string' ? j.error : null;
  if (s === 'done' && j.result && typeof j.result === 'object') return { kind: 'done', result: j.result as RunResult };
  if (s === 'refunded') {
    const r = (j.refund ?? {}) as Record<string, unknown>;
    return {
      kind: 'refunded',
      signature: typeof r.signature === 'string' ? r.signature : null,
      state: typeof r.state === 'string' ? r.state : null,
      reason: typeof j.reason === 'string' ? j.reason : null,
      amount: typeof r.amount === 'string' ? r.amount : null,
    };
  }
  if (s === 'running' || s === 'busy') return { kind: 'running' };
  if (s === 'pending_approval') return { kind: 'waiting', approveBy: typeof j.approve_by === 'string' ? j.approve_by : null };
  if (s === 'unpaid') return { kind: 'unpaid' };
  if (s === 'not_run') return { kind: 'not_run' };
  if (s === 'not_paid' || s === 'mismatch' || s === 'invalid') return { kind: 'refused', error: err ?? s };
  if (status === 503) return { kind: 'unavailable', error: err ?? 'Compute is not available right now.' };
  return { kind: 'error', error: err ?? `The gateway answered ${status}.` };
}

async function call(url: string, init?: RequestInit): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    return { kind: 'error', error: 'Could not reach the compute gateway. Nothing was charged by this check.' };
  }
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return toOutcome(res.status, j);
}

/** Starts (or re-asks for) the run of a paid intent. Safe to repeat: the gateway runs an intent once. */
export function startRun(intent: string, headers: Record<string, string> = {}): Promise<Outcome> {
  return call('/api/compute/run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ intent }) });
}

export function readResult(intent: string): Promise<Outcome> {
  return call(`/api/compute/result/${encodeURIComponent(intent)}`);
}

export function isComputeIntent(s: unknown): s is string {
  return typeof s === 'string' && COMPUTE_INTENT_RE.test(s);
}

/** The first compute intent anywhere in a value (an agent event, a tool result), or null. */
export function findIntent(v: unknown, depth = 0): string | null {
  if (depth > 6 || v === null || v === undefined) return null;
  if (typeof v === 'string') {
    if (COMPUTE_INTENT_RE.test(v)) return v;
    const m = v.match(/\bc[A-Za-z0-9_-]{31}\b/);
    return m && isComputeIntent(m[0]) ? m[0] : null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = findIntent(x, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (isComputeIntent(o.intent)) return o.intent as string;
    for (const k of Object.keys(o)) {
      const f = findIntent(o[k], depth + 1);
      if (f) return f;
    }
  }
  return null;
}

/** A quoted amount (base units) in a tool result, if one is there. */
export function findAmount(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  for (const k of ['amount', 'amount_base_units']) if (typeof o[k] === 'string' && /^\d+$/.test(o[k] as string)) return o[k] as string;
  for (const x of Object.values(o)) {
    const f = typeof x === 'object' ? findAmount(x) : null;
    if (f) return f;
  }
  return null;
}
