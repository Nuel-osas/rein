// The compute gateway's logic, with every outside effect injected (store, chain reads, the model
// call, the refund) so it can be tested without a validator or an API key. Route handlers wire the
// real ones in `./wire.ts`. Money is bigint base units of test USDC (6 decimals) throughout.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { CATALOG, parsePriceOverride, type ModelPrice } from './catalog';
import type { Store } from '../store';

export const SERVICES = ['claude-run', 'codex-run'] as const;
export type ComputeService = (typeof SERVICES)[number];
export const isComputeService = (s: unknown): s is ComputeService => typeof s === 'string' && (SERVICES as readonly string[]).includes(s);

export const PROMPT_MAX_CHARS = 4_000;
export const MAX_TOKENS_CAP = 1_024;
export const QUOTE_TTL_SEC = 25 * 60 * 60;
export const RESULT_TTL_SEC = 7 * 24 * 60 * 60;
export const REFUND_TTL_SEC = 30 * 24 * 60 * 60;
export const RUN_LOCK_SEC = 90;
export const TEAM_LOCK_SEC = 60;
export const TEAM_RUNS_PER_DAY = 20;
export const UPSTREAM_TIMEOUT_MS = 35_000;
export const CENT = 10_000n; // base units
export const INTENT_RE = /^c[A-Za-z0-9_-]{31}$/;

/** Sent with every run; counted in the price. Model output is returned as data to the caller. */
export const SYSTEM_PROMPT =
  'You answer one request that a team bought through Rein. Answer the request directly and concisely in plain text.';

// ------------------------------------------------------------------ pricing and intents ---

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * price = ceil to the cent of (bytes(system+prompt) × input price + max_tokens × output price) × 1.5,
 * at least $0.01. Bytes stand in for tokens: a token is at least one byte, so this never under-prices.
 * `worst` is the same upstream cost without the markup, rounded up to a base unit: what the daily
 * budget is charged.
 */
export function priceOf(price: ModelPrice, prompt: string, maxTokens: number): { amount: bigint; worst: bigint } {
  const bytes = BigInt(Buffer.byteLength(SYSTEM_PROMPT + prompt, 'utf8'));
  // micro-USD per MTok × tokens = base units × 1e6
  const scaled = bytes * price.inMicroPerMTok + BigInt(maxTokens) * price.outMicroPerMTok;
  const amountCents = ceilDiv(scaled * 3n, 2n * 1_000_000n * CENT);
  const amount = (amountCents < 1n ? 1n : amountCents) * CENT;
  const worst = ceilDiv(scaled, 1_000_000n);
  return { amount, worst };
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
  fake: boolean;
  dailyBudget: bigint; // base units
  gatewaySecret: string | null;
  models: Record<ComputeService, string | null>;
  keys: Record<ComputeService, string | null>;
  priceOverrides: Record<ComputeService, ModelPrice | null>;
};

export function readComputeEnv(env: Record<string, string | undefined> = process.env): ComputeEnv {
  const budgetUsd = env.COMPUTE_DAILY_BUDGET_USD?.trim() || '10';
  // Fail closed: a malformed budget is zero, so every quote is refused.
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(budgetUsd);
  const dailyBudget = m ? BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(2, '0')) * CENT : 0n;
  const secret = env.GATEWAY_SECRET?.trim();
  return {
    production: env.NODE_ENV === 'production',
    enabled: (env.COMPUTE_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    fake: env.COMPUTE_FAKE_UPSTREAM === '1',
    dailyBudget,
    gatewaySecret: secret && secret.length >= 32 ? secret : null,
    models: {
      'claude-run': env.CLAUDE_MODEL?.trim() || 'claude-haiku-5-5',
      'codex-run': env.CODEX_MODEL?.trim() || null,
    },
    keys: {
      'claude-run': env.ANTHROPIC_API_KEY?.trim() || null,
      'codex-run': env.OPENAI_API_KEY?.trim() || null,
    },
    priceOverrides: {
      'claude-run': parsePriceOverride(env.COMPUTE_PRICE_CLAUDE_RUN),
      'codex-run': parsePriceOverride(env.COMPUTE_PRICE_CODEX_RUN),
    },
  };
}

/** The model and its price, or why the service cannot run. */
export function serviceSetup(env: ComputeEnv, service: ComputeService): { ok: true; model: string; price: ModelPrice } | { ok: false; error: string } {
  const model = env.models[service];
  if (!model) return { ok: false, error: `${service} is not configured: no model is set` };
  const price = env.priceOverrides[service] ?? CATALOG[model] ?? null;
  if (!price) return { ok: false, error: `${service} is not configured: no verified price for model ${model}` };
  if (!env.keys[service] && !env.fake) return { ok: false, error: `${service} is not configured: no API key on this server` };
  return { ok: true, model, price };
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
  createdAt: number;
};

export type ComputeResult = {
  intent: string;
  service: ComputeService;
  model: string;
  text: string;
  /** True when no model was called (COMPUTE_FAKE_UPSTREAM=1). The text says so too. */
  fake: boolean;
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

export type UpstreamCall = (a: { service: ComputeService; model: string; system: string; prompt: string; maxTokens: number; key: string | null; signal: AbortSignal; price: ModelPrice }) => Promise<{ text: string; fake: boolean }>;

export interface Deps {
  store: Store;
  env: ComputeEnv;
  programId: string;
  now: () => number;
  /** The Service account for an id: its PDA, payee token, whether it is active; null if absent; 'error' if unread. */
  readService: (id: ComputeService) => Promise<{ address: string; payeeToken: string; active: boolean } | null | 'error'>;
  /** The gateway's own token account: the only payee a compute quote accepts. */
  gatewayToken: () => Promise<string | null>;
  spenderPda: (team: string, authority: string) => string;
  paymentPda: (spender: string, intent: string) => string;
  /** The Payment account and its owner; null when absent; 'error' when the read failed. */
  readPayment: (address: string) => Promise<PaymentView | null | 'error'>;
  upstream: UpstreamCall;
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

export async function quote(d: Deps, input: { team: string; authority: string; service: ComputeService; prompt: string; maxTokens: number }): Promise<Reply> {
  if (await halted(d)) return reply(503, { error: 'Compute is switched off on this server.' });
  if (!d.env.gatewaySecret) return reply(503, { error: 'Compute is not configured on this server (no gateway secret).' });
  const setup = serviceSetup(d.env, input.service);
  if (!setup.ok) return reply(503, { error: setup.error });

  const [svc, gatewayToken] = await Promise.all([d.readService(input.service), d.gatewayToken()]);
  if (svc === 'error' || gatewayToken === null) return reply(503, { error: 'Could not read the service registry. Try again.' });
  if (!svc) return reply(503, { error: `${input.service} is not registered on chain.` });
  if (!svc.active) return reply(503, { error: `${input.service} is suspended in the registry.` });
  if (svc.payeeToken !== gatewayToken) return reply(503, { error: `${input.service} pays an account this gateway does not hold; refusing to quote.` });

  const { amount, worst } = priceOf(setup.price, input.prompt, input.maxTokens);
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
  const intent = intentFor(d.env.gatewaySecret, { team: input.team, spender, service: input.service, amount, promptSha, maxTokens: input.maxTokens, nonce });
  const q: Quote = {
    v: 1,
    intent,
    team: input.team,
    authority: input.authority,
    spender,
    service: input.service,
    servicePda: svc.address,
    payeeToken: svc.payeeToken,
    model: setup.model,
    amount: amount.toString(),
    worst: worst.toString(),
    maxTokens: input.maxTokens,
    promptSha,
    prompt: input.prompt,
    nonce,
    createdAt: nowMs,
  };
  if (!(await d.store.setNX(`quote:${intent}`, JSON.stringify(q), QUOTE_TTL_SEC))) return reply(409, { error: 'Quote collision; ask again.' });
  return reply(200, {
    intent,
    service: input.service,
    model: setup.model,
    amount: amount.toString(),
    amount_usdc: fmt(amount),
    max_tokens: input.maxTokens,
    spender,
    authority: input.authority,
    payee_token: svc.payeeToken,
    fake_upstream: d.env.fake,
    expires_at: new Date(nowMs + QUOTE_TTL_SEC * 1000).toISOString(),
    pay_with: { service_id: input.service, amount_base_units: amount.toString(), intent },
  });
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
  const setup = serviceSetup(d.env, q.service);
  if (!setup.ok || setup.model !== q.model) return doRefund(d, q, setup.ok ? 'the model changed since the quote' : setup.error);

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
    let out: { text: string; fake: boolean };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      out = await d.upstream({ service: q.service, model: q.model, system: SYSTEM_PROMPT, prompt: q.prompt, maxTokens: q.maxTokens, key: d.env.keys[q.service], signal: ac.signal, price: setup.price });
    } catch (e) {
      // The spend stays counted: the provider may have billed a partial call.
      const why = ac.signal.aborted ? 'the model did not answer within 35 seconds' : `the model call failed (${String((e as Error)?.message ?? e).slice(0, 120)})`;
      return await doRefund(d, q, why);
    } finally {
      clearTimeout(timer);
    }
    if (!out.text.trim()) return await doRefund(d, q, 'the model returned no text');

    const result: ComputeResult = {
      intent,
      service: q.service,
      model: q.model,
      text: out.text,
      fake: out.fake,
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
