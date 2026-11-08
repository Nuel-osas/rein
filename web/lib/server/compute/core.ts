// The compute gateway's logic, with every outside effect injected (store, chain reads, the 0G
// backend, the refund) so it can be tested without a validator, a 0G wallet or a model. Route
// handlers wire the real ones in `./wire.ts`. Money is bigint base units of test USDC (6 decimals,
// 1 test USDC = $1) throughout.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { SERVICE_TABLE, type ComputeService } from './catalog';
import type { Store } from '../store';

export { SERVICE_TABLE, type ComputeService };
export const isComputeService = (s: unknown): s is ComputeService => typeof s === 'string' && Object.hasOwn(SERVICE_TABLE, s);

export const PROMPT_MAX_CHARS = 4_000;
export const MAX_TOKENS_CAP = 1_024;
export const QUOTE_TTL_SEC = 25 * 60 * 60;
export const RESULT_TTL_SEC = 7 * 24 * 60 * 60;
export const REFUND_TTL_SEC = 30 * 24 * 60 * 60;
export const RUN_LOCK_SEC = 90;
export const TEAM_LOCK_SEC = 60;
export const TEAM_RUNS_PER_DAY = 20;
/** First runs on a provider include its funding transactions (~20 s live); funded runs take ~5 s. */
export const UPSTREAM_TIMEOUT_MS = 45_000;
export const CENT = 10_000n; // base units
export const INTENT_RE = /^c[A-Za-z0-9_-]{31}$/;


// ------------------------------------------------------------------ pricing and intents ---

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * price = 0G's worst case for one run (maxCostNeuron × USD per 0G) × 1.5, rounded up to the cent,
 * at least $0.01, in test USDC base units (1 test USDC = $1, so a base unit is a micro-dollar).
 * `worst` is the same cost without the markup, rounded up to a base unit: what the daily budget is
 * charged. The rate is rounded up to the micro-dollar so a float never under-prices.
 */
export function priceOf(maxCostNeuron: bigint, usdPerZg: number): { amount: bigint; worst: bigint } {
  if (!(usdPerZg > 0) || !Number.isFinite(usdPerZg) || maxCostNeuron <= 0n) throw new Error('bad price inputs');
  const microPerZg = BigInt(Math.ceil(usdPerZg * 1e6));
  const worst = ceilDiv(maxCostNeuron * microPerZg, NEURON_PER_ZG);
  const cents = ceilDiv(worst * 3n, 2n * CENT);
  return { amount: (cents < 1n ? 1n : cents) * CENT, worst };
}

export const NEURON_PER_ZG = 10n ** 18n;

/** Neuron at a USD rate, in base units (micro-dollars), rounded down: a balance is never overstated. */
export function neuronToMicroUsd(neuron: bigint, usdPerZg: number): bigint {
  return (neuron * BigInt(Math.floor(usdPerZg * 1e6))) / NEURON_PER_ZG;
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** "c" + base64url(HMAC(secret, team|spender|service|amount|sha256(prompt)|maxTokens|nonce)), 32 chars. */
export function intentFor(secret: string, f: { team: string; spender: string; service: string; amount: bigint; promptSha: string; maxTokens: number; nonce: string }): string {
  const msg = [f.team, f.spender, f.service, f.amount.toString(), f.promptSha, String(f.maxTokens), f.nonce].join('|');
  const mac = createHmac('sha256', secret).update(msg, 'utf8').digest('base64url');
  return ('c' + mac).slice(0, 32);
}

export const utcDay = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

// ------------------------------------------------------------------------------ config ---

export type ComputeEnv = {
  production: boolean;
  enabled: boolean;
  /** The labelled fake 0G backend. Never in production, whatever the flag says. */
  fake: boolean;
  dailyBudget: bigint; // base units
  ledgerFloor: bigint; // base units
  gatewaySecret: string | null;
  zgKeyPresent: boolean;
};

const usd = (raw: string | undefined, dflt: string): bigint => {
  // Fail closed: a malformed amount is zero (a budget of zero refuses everything).
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(raw?.trim() || dflt);
  return m ? BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0')) : 0n;
};

export function readComputeEnv(env: Record<string, string | undefined> = process.env): ComputeEnv {
  const production = env.NODE_ENV === 'production';
  const secret = env.GATEWAY_SECRET?.trim();
  const floorRaw = env.ZG_LEDGER_FLOOR_USD?.trim();
  return {
    production,
    enabled: (env.COMPUTE_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    fake: !production && env.COMPUTE_FAKE_UPSTREAM === '1',
    dailyBudget: usd(env.COMPUTE_DAILY_BUDGET_USD, '5'),
    // A malformed floor is treated as huge, so quotes stop rather than run the ledger dry.
    ledgerFloor: floorRaw && !/^\d{1,6}(?:\.\d{1,6})?$/.test(floorRaw) ? 10n ** 15n : usd(floorRaw, '0.25'),
    gatewaySecret: secret && secret.length >= 32 ? secret : null,
    zgKeyPresent: !!env.ZG_PRIVATE_KEY?.trim(),
  };
}

// ------------------------------------------------------------------------------ deps ---

export type Quote = {
  v: 1;
  intent: string;
  team: string;
  authority: string;
  spender: string;
  service: ComputeService;
  servicePda: string;
  payeeToken: string;
  model: string;
  amount: string;
  worst: string;
  maxTokens: number;
  promptSha: string;
  prompt: string;
  nonce: string;
  /** 0G's price revision the quote was made from (provider, unit prices, rate, time). */
  revision: string;
  createdAt: number;
};

export type ComputeResult = {
  intent: string;
  service: ComputeService;
  model: string;
  text: string;
  /** True when no model was called (COMPUTE_FAKE_UPSTREAM=1, never in production). The text says so too. */
  fake: boolean;
  /** True only when the provider's TEE signature over the answer checked out. */
  verified: boolean;
  /** What the signature covers: "output", "route" or "none" (a relayed model: unchecked). */
  covers: string | null;
  provider: string | null;
  /** What the run cost on 0G, neuron, as the provider reported it; null when it reported none. */
  costNeuron: string | null;
  resultHash: string;
  createdAt: number;
};

export type PaymentView = {
  owner: string;
  team: string;
  spender: string;
  service: string;
  payeeToken: string;
  amount: bigint;
  status: string;
  deadline: number;
};

export type RefundOutcome =
  | { state: 'confirmed' | 'pending' | 'failed' | 'signed'; signature: string; reason: string }
  /** Nothing was signed or recorded (a key or a read was missing). Safe to try again. */
  | { state: 'unavailable'; error: string };

export type BackendPrice = { ok: true; maxCostNeuron: bigint; usdPerZg: number; revision: string } | { ok: false; reason: string };
export type BackendRun =
  | { ok: true; text: string; fake: boolean; verified: boolean; covers: string | null; provider: string | null; costNeuron: bigint | null }
  | { ok: false; code: string; message: string };

/** What the gateway needs from 0G: the adapter (`@rein/zg-compute`) or the labelled fake. */
export interface ComputeBackendLike {
  model(service: ComputeService): string;
  priceOf(service: ComputeService): Promise<BackendPrice>;
  /** The ledger's available balance, neuron; null when unread. */
  ledgerNeuron(): Promise<bigint | null>;
  run(service: ComputeService, prompt: string, o: { purchaseId: string; signal: AbortSignal }): Promise<BackendRun>;
}

export interface Deps {
  store: Store;
  env: ComputeEnv;
  programId: string;
  now: () => number;
  /** The Service account for an id: its PDA, payee token, whether it is active; null if absent; 'error' if unread. */
  readService: (id: ComputeService) => Promise<{ address: string; payeeToken: string; active: boolean } | null | 'error'>;
  /** The gateway's own token account: the only payee a compute quote accepts. null: no gateway key; 'error': unread. */
  gatewayToken: () => Promise<string | null | 'error'>;
  spenderPda: (team: string, authority: string) => string;
  paymentPda: (spender: string, intent: string) => string;
  /** The Payment account and its owner; null when absent; 'error' when the read failed. */
  readPayment: (address: string) => Promise<PaymentView | null | 'error'>;
  /** The 0G backend, or why there is none (no ZG_PRIVATE_KEY): the service then answers 503. */
  backend: () => Promise<ComputeBackendLike | { error: string }>;
  refund: (q: Quote, reason: string) => Promise<RefundOutcome>;
  /** Durable record (Postgres). Best effort: never blocks a result. */
  record?: (row: { intent: string; team: string; spender: string; service: string; amount: bigint; status: string; resultHash?: string | null; refundSig?: string | null }) => Promise<void>;
}

export type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body: { ok: status < 400, ...body } });

async function halted(d: Deps): Promise<boolean> {
  if (!d.env.enabled) return true;
  return (await d.store.get('compute:halt')) !== null;
}

const fmt = (units: bigint) => {
  const w = units / 1_000_000n;
  const f = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${w}.${f}`;
};

// ------------------------------------------------------------------------------ quote ---

async function backendOf(d: Deps): Promise<ComputeBackendLike | { error: string }> {
  try {
    return await d.backend();
  } catch {
    return { error: 'Could not reach the 0G compute network.' };
  }
}

/** A live price for one service: its registry entry, 0G's worst case now, and the ledger floor. */
async function livePrice(d: Deps, service: ComputeService) {
  const [svc, gatewayToken] = await Promise.all([d.readService(service), d.gatewayToken()]);
  if (gatewayToken === null) return { ok: false as const, status: 503, error: 'Compute is not configured on this server (no gateway key).' };
  if (svc === 'error' || gatewayToken === 'error') return { ok: false as const, status: 503, error: 'Could not read the service registry. Try again.' };
  if (!svc) return { ok: false as const, status: 503, error: `${service} is not registered on chain.` };
  if (!svc.active) return { ok: false as const, status: 503, error: `${service} is suspended in the registry.` };
  if (svc.payeeToken !== gatewayToken) return { ok: false as const, status: 503, error: `${service} pays an account this gateway does not hold; refusing to quote.` };
  const b = await backendOf(d);
  if ('error' in b) return { ok: false as const, status: 503, error: `${service} is not configured: ${b.error}` };
  const [price, ledger] = await Promise.all([b.priceOf(service), b.ledgerNeuron()]);
  if (!price.ok) return { ok: false as const, status: 503, error: price.reason };
  // Hard cap: the 0G ledger, with a floor so the last runs never fail for want of funds.
  if (ledger === null) return { ok: false as const, status: 503, error: 'Could not read the 0G compute balance. Try again.' };
  if (neuronToMicroUsd(ledger, price.usdPerZg) < d.env.ledgerFloor) return { ok: false as const, status: 503, error: 'The compute balance is below its floor; no new runs until it is topped up.' };
  const { amount, worst } = priceOf(price.maxCostNeuron, price.usdPerZg);
  return { ok: true as const, svc, model: b.model(service), amount, worst, revision: price.revision };
}

export async function quote(d: Deps, input: { team: string; authority: string; service: ComputeService; prompt: string }): Promise<Reply> {
  if (await halted(d)) return reply(503, { error: 'Compute is switched off on this server.' });
  if (!d.env.gatewaySecret) return reply(503, { error: 'Compute is not configured on this server (no gateway secret).' });
  const maxTokens = SERVICE_TABLE[input.service].maxOutputTokens;

  const live = await livePrice(d, input.service);
  if (!live.ok) return reply(live.status, { error: live.error });
  const { svc, amount, worst } = live;
  const nowMs = d.now();
  const day = utcDay(nowMs);
  const [spentRaw, runsRaw] = await Promise.all([d.store.get(`spend:${day}`), d.store.get(`runs:${input.team}:${day}`)]);
  const spent = spentRaw === null ? 0n : BigInt(spentRaw);
  if (spent + worst > d.env.dailyBudget) return reply(429, { error: "Today's compute budget for this server is used up. Try again tomorrow (UTC)." });
  const runs = runsRaw === null ? 0 : Number(runsRaw);
  if (runs >= TEAM_RUNS_PER_DAY) return reply(429, { error: `This team has used its ${TEAM_RUNS_PER_DAY} compute runs for today (UTC).` });

  const spender = d.spenderPda(input.team, input.authority);
  const promptSha = sha256Hex(input.prompt);
  const nonce = randomBytes(16).toString('hex');
  const intent = intentFor(d.env.gatewaySecret, { team: input.team, spender, service: input.service, amount, promptSha, maxTokens, nonce });
  const q: Quote = {
    v: 1,
    intent,
    team: input.team,
    authority: input.authority,
    spender,
    service: input.service,
    servicePda: svc.address,
    payeeToken: svc.payeeToken,
    model: live.model,
    amount: amount.toString(),
    worst: worst.toString(),
    maxTokens,
    promptSha,
    prompt: input.prompt,
    nonce,
    revision: live.revision,
    createdAt: nowMs,
  };
  if (!(await d.store.setNX(`quote:${intent}`, JSON.stringify(q), QUOTE_TTL_SEC))) return reply(409, { error: 'Quote collision; ask again.' });
  return reply(200, {
    intent,
    service: input.service,
    model: live.model,
    amount: amount.toString(),
    amount_usdc: fmt(amount),
    max_tokens: maxTokens,
    spender,
    authority: input.authority,
    payee_token: svc.payeeToken,
    fake_upstream: d.env.fake,
    expires_at: new Date(nowMs + QUOTE_TTL_SEC * 1000).toISOString(),
    pay_with: { service_id: input.service, amount_base_units: amount.toString(), intent },
  });
}

/** Every registered compute service with its live price (or why it has none). For the claim lane's UI. */
export async function catalog(d: Deps): Promise<Reply> {
  const off = await halted(d);
  const rows = [];
  for (const [id, meta] of Object.entries(SERVICE_TABLE) as [ComputeService, (typeof SERVICE_TABLE)[ComputeService]][]) {
    const svc = await d.readService(id);
    if (svc === 'error') return reply(503, { error: 'Could not read the service registry. Try again.' });
    if (!svc || !svc.active) continue; // not sold: never registered, or suspended
    const live = off ? null : await livePrice(d, id);
    rows.push({
      id,
      label: meta.label,
      model: meta.model,
      summary: meta.summary,
      max_prompt_chars: meta.maxPromptChars,
      max_tokens: meta.maxOutputTokens,
      available: !!live?.ok,
      price: live?.ok ? live.amount.toString() : null,
      price_usdc: live?.ok ? fmt(live.amount) : null,
      reason: off ? 'Compute is switched off on this server.' : live && !live.ok ? live.error : null,
    });
  }
  return reply(200, { services: rows, fake_upstream: d.env.fake });
}

// -------------------------------------------------------------------------------- run ---

async function loadQuote(d: Deps, intent: string): Promise<Quote | null> {
  const raw = await d.store.get(`quote:${intent}`);
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as Quote;
    return q && q.v === 1 && q.intent === intent ? q : null;
  } catch {
    return null;
  }
}

async function loadJson<T>(d: Deps, key: string): Promise<T | null> {
  const raw = await d.store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function refundReply(q: Quote, r: RefundOutcome): Reply {
  if (r.state === 'unavailable') return reply(503, { status: 'refund_due', intent: q.intent, error: `The run did not happen and the refund could not be sent yet: ${r.error}. Call run again to retry the refund.` });
  // An unconfirmed refund is pending, never failed, so nobody refunds twice.
  return reply(200, {
    status: 'refunded',
    intent: q.intent,
    refund: { state: r.state, signature: r.signature, amount: q.amount, amount_usdc: fmt(BigInt(q.amount)) },
    reason: r.reason,
  });
}

async function doRefund(d: Deps, q: Quote, reason: string): Promise<Reply> {
  await d.store.set(`due:${q.intent}`, reason, REFUND_TTL_SEC);
  const r = await d.refund(q, reason);
  if (r.state !== 'unavailable') {
    await d.record?.({ intent: q.intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: `refund_${r.state}`, refundSig: r.signature }).catch(() => {});
  }
  return refundReply(q, r);
}

export async function run(d: Deps, intent: string): Promise<Reply> {
  if (!INTENT_RE.test(intent)) return reply(400, { error: 'intent must be a compute intent from /api/compute/quote' });
  const q = await loadQuote(d, intent);
  if (!q) return reply(404, { error: 'No quote with that intent (it may have expired after 25 hours).' });

  const done = await loadJson<ComputeResult>(d, `result:${intent}`);
  if (done) return reply(200, { status: 'done', result: done });
  const refunded = await loadJson<{ signature: string; state: string; reason: string }>(d, `refund:${intent}`);
  if (refunded) {
    return reply(200, { status: 'refunded', intent, refund: { state: refunded.state, signature: refunded.signature, amount: q.amount, amount_usdc: fmt(BigInt(q.amount)) }, reason: refunded.reason });
  }
  const due = await d.store.get(`due:${intent}`);
  if (due) return doRefund(d, q, due);

  // The payment record, derived here from the quoted spender and the intent. Never from the client.
  const address = d.paymentPda(q.spender, intent);
  const p = await d.readPayment(address);
  if (p === 'error') return reply(503, { status: 'unknown', error: 'Could not read the payment on chain. Try again.' });
  if (!p) return reply(402, { status: 'unpaid', payment: address, error: 'No payment for this intent yet. Pay it with the quoted service, amount and intent, then call run.' });
  if (p.owner !== d.programId) return reply(409, { status: 'invalid', error: 'The payment account is not owned by the Rein program.' });
  if (p.status === 'pending') {
    return reply(402, { status: 'pending_approval', payment: address, approve_by: p.deadline ? new Date(p.deadline * 1000).toISOString() : null, error: 'The payment is waiting for the team owner to approve it.' });
  }
  if (p.status !== 'paid' && p.status !== 'settled') return reply(409, { status: 'not_paid', payment: address, payment_status: p.status, error: `The payment was ${p.status}; nothing will run.` });
  const mismatch = [
    p.team !== q.team && 'team',
    p.spender !== q.spender && 'spender',
    p.service !== q.servicePda && 'service',
    p.payeeToken !== q.payeeToken && 'payee',
    p.amount !== BigInt(q.amount) && 'amount',
  ].filter(Boolean);
  if (mismatch.length) return reply(409, { status: 'mismatch', payment: address, error: `The payment does not match the quote (${mismatch.join(', ')}); nothing will run.` });

  // Paid for exactly this quote. From here on, anything that stops the run refunds it.
  if (await halted(d)) return doRefund(d, q, 'compute was switched off before the run');
  const backend = await backendOf(d);
  if ('error' in backend) return doRefund(d, q, `compute is not configured: ${backend.error}`);
  if (backend.model(q.service) !== q.model) return doRefund(d, q, 'the model changed since the quote');

  if (!(await d.store.setNX(`run:${intent}`, '1', RUN_LOCK_SEC))) return reply(409, { status: 'running', error: 'This run is already in progress. Ask for the result in a moment.' });
  const teamLock = `teamrun:${q.team}`;
  if (!(await d.store.setNX(teamLock, intent, TEAM_LOCK_SEC))) {
    await d.store.del(`run:${intent}`);
    return reply(409, { status: 'busy', error: 'This team already has a run in progress. Call run again in a few seconds.' });
  }

  try {
    const day = utcDay(d.now());
    const runsKey = `runs:${q.team}:${day}`;
    const runs = await d.store.incrBy(runsKey, 1n, 2 * 24 * 60 * 60);
    if (runs > BigInt(TEAM_RUNS_PER_DAY)) {
      await d.store.incrBy(runsKey, -1n);
      return await doRefund(d, q, `the team used its ${TEAM_RUNS_PER_DAY} runs for today`);
    }
    const worst = BigInt(q.worst);
    const spendKey = `spend:${day}`;
    const spent = await d.store.incrBy(spendKey, worst, 2 * 24 * 60 * 60);
    if (spent > d.env.dailyBudget) {
      await d.store.incrBy(spendKey, -worst);
      await d.store.incrBy(runsKey, -1n);
      return await doRefund(d, q, "the server's daily compute budget is used up");
    }

    await d.record?.({ intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: 'running' }).catch(() => {});
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    let out: BackendRun;
    try {
      out = await backend.run(q.service, q.prompt, { purchaseId: intent, signal: ac.signal });
    } catch (e) {
      out = { ok: false, code: 'threw', message: String((e as Error)?.message ?? e).slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
    // A failed run keeps its spend counted: 0G may have billed part of it.
    if (!out.ok) return await doRefund(d, q, ac.signal.aborted ? 'the model did not answer in time' : `the run failed: ${out.message}`);
    if (!out.text.trim()) return await doRefund(d, q, 'the model returned no text');

    const result: ComputeResult = {
      intent,
      service: q.service,
      model: q.model,
      text: out.text,
      fake: out.fake,
      verified: out.verified,
      covers: out.covers,
      provider: out.provider,
      costNeuron: out.costNeuron === null ? null : out.costNeuron.toString(),
      resultHash: sha256Hex(out.text),
      createdAt: d.now(),
    };
    await d.store.set(`result:${intent}`, JSON.stringify(result), RESULT_TTL_SEC);
    await d.record?.({ intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: 'done', resultHash: result.resultHash }).catch(() => {});
    return reply(200, { status: 'done', result });
  } finally {
    await d.store.del(teamLock).catch(() => {});
    await d.store.del(`run:${intent}`).catch(() => {});
  }
}

// ----------------------------------------------------------------------------- result ---

export async function result(d: Deps, intent: string): Promise<Reply> {
  if (!INTENT_RE.test(intent)) return reply(400, { error: 'not a compute intent' });
  const done = await loadJson<ComputeResult>(d, `result:${intent}`);
  if (done) return reply(200, { status: 'done', result: done });
  const refunded = await loadJson<{ signature: string; state: string; reason: string }>(d, `refund:${intent}`);
  if (refunded) return reply(200, { status: 'refunded', intent, refund: { state: refunded.state, signature: refunded.signature }, reason: refunded.reason });
  if (await d.store.get(`run:${intent}`)) return reply(202, { status: 'running' });
  if (await d.store.get(`quote:${intent}`)) return reply(404, { status: 'not_run', error: 'Quoted but not run yet. Pay it, then call run.' });
  return reply(404, { status: 'unknown', error: 'No result for that intent.' });
}
