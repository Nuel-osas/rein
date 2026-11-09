// The browser's side of the compute gateway (documented contract):
//   POST /api/compute/buy {team, service, prompt | audio} → the team's Rein agent quotes and pays: {intent, amount, payment}
//   POST /api/compute/run {intent}         → done {result} | refunded {refund} | 402 pending_approval/unpaid | 409 running/busy | 503 refund_due
//   GET  /api/compute/result/<intent>      → done {result} | refunded | 202 running | 404 not_run/unknown
//   GET  /api/compute/result/<intent>/blob → the image bytes of an image result
// A missing route (404 with no JSON) is "gateway not available", never a result. A refund is a
// refund whatever the HTTP status (an unconfigured Router service answers 503 with status refunded).

import { COMPUTE_INTENT_RE } from './agent-setup';

export type RunResult = {
  intent: string;
  service: string;
  model: string;
  /** What the run produced. Absent on older results: text. */
  output?: 'text' | 'image' | 'video';
  /** The answer or transcript; empty for an image. */
  text: string;
  mime?: string;
  /** Where the bytes of an image (or video) result are served. Use only through `resultBlobUrl`. */
  url?: string;
  bytes?: number;
  fake: boolean;
  /** True only when the provider's TEE signature over the output checked out. */
  verified?: boolean;
  /** "output", "route" or "none" (relayed: nothing checked). */
  covers?: string | null;
  provider?: string | null;
  costNeuron?: string | null;
  trust?: 'tee' | 'relayed';
  resultHash: string;
  createdAt: number;
};

const BLOB_RE = /^\/api\/compute\/result\/c[A-Za-z0-9_-]{31}\/blob$/;

/** The result's own blob route, or null. Never an outside URL: an image is only shown from the gateway. */
export function resultBlobUrl(r: RunResult): string | null {
  if (typeof r.url !== 'string' || !BLOB_RE.test(r.url)) return null;
  return r.url.slice('/api/compute/result/'.length, -'/blob'.length) === r.intent ? r.url : null;
}

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

export type BuyPayment = {
  status: 'paid' | 'pending' | 'refused' | 'failed';
  signature: string | null;
  /** The Payment account. */
  payment: string | null;
  reasons: string[];
  approveBy: string | null;
  unconfirmed: boolean;
  error: string | null;
};

export type BuyReply =
  | { ok: true; intent: string; service: string; model: string | null; amount: bigint | null; payment: BuyPayment }
  /** `unknown`: no readable answer, so a payment may have been sent. Check Activity before trying again. */
  | { ok: false; error: string; code: string | null; unknown: boolean };

const PAY_STATUSES = ['paid', 'pending', 'refused', 'failed'] as const;

/**
 * The team's Rein agent quotes one run and pays it under its on-chain policy (no model involved).
 * Paid: call startRun(intent). Pending: it waits for the owner. A reply that cannot be read is
 * unknown, never failed, so nobody pays twice.
 */
export async function buyCompute(
  body: { team: string; service: string; prompt?: string; audio?: { base64: string; mime: string } },
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<BuyReply> {
  let res: Response;
  try {
    res = await fetch('/api/compute/buy', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { ok: false, error: 'Stopped watching. If the agent had already paid, the payment is on chain: check Activity before trying again.', code: 'aborted', unknown: true };
    return { ok: false, error: 'Could not reach the server. A payment may still have been sent: check Activity before trying again.', code: null, unknown: true };
  }
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j) {
    if (res.status === 404) return { ok: false, error: 'Buying compute is not available on this deployment yet.', code: 'missing', unknown: false };
    return { ok: false, error: `No readable answer (${res.status}). A payment may still have been sent: check Activity before trying again.`, code: null, unknown: true };
  }
  if (!res.ok || j.ok !== true) {
    return { ok: false, error: typeof j.error === 'string' ? j.error.slice(0, 300) : `The server answered ${res.status}.`, code: typeof j.code === 'string' ? j.code : null, unknown: false };
  }
  const intent = typeof j.intent === 'string' && COMPUTE_INTENT_RE.test(j.intent) ? j.intent : null;
  const p = (j.payment ?? null) as Record<string, unknown> | null;
  const status = p && (PAY_STATUSES as readonly unknown[]).includes(p.status) ? (p.status as BuyPayment['status']) : null;
  // A reply without a valid intent or payment status says nothing reliable about the payment.
  if (!intent || !p || !status) return { ok: false, error: 'The server answered without a readable payment. Check Activity before trying again.', code: null, unknown: true };
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    ok: true,
    intent,
    service: typeof j.service === 'string' ? j.service : body.service,
    model: s(j.model),
    amount: typeof j.amount === 'string' && /^\d{1,19}$/.test(j.amount) ? BigInt(j.amount) : null,
    payment: {
      status,
      signature: s(p.signature),
      payment: s(p.payment),
      reasons: Array.isArray(p.reasons) ? p.reasons.filter((r): r is string => typeof r === 'string') : [],
      approveBy: s(p.approve_by),
      unconfirmed: p.unconfirmed === true,
      error: s(p.error),
    },
  };
}

/** Raw bytes as base64 (no data: prefix), in chunks so a few MB never overflows the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const EXT_MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm' };

/** An audio file's type without parameters ("audio/webm;codecs=opus" → "audio/webm"), else from its extension; '' when unknown (the gateway reads the bytes). */
export function audioMime(type: string, name = ''): string {
  const t = type.split(';')[0].trim().toLowerCase();
  if (t) return t;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return EXT_MIME[ext] ?? '';
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
