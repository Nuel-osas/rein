import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryStore, MemoryKV } from '../store';
import { CATALOG, parsePriceOverride } from './catalog';
import {
  intentFor,
  INTENT_RE,
  priceOf,
  quote,
  readComputeEnv,
  result,
  run,
  serviceSetup,
  SYSTEM_PROMPT,
  type Deps,
  type PaymentView,
  type Quote,
  type RefundOutcome,
} from './core';
import { FAKE_PREFIX, realUpstream } from './upstream';

const PROGRAM = 'F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe';
const TEAM = 'EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5';
const AUTH = 'EYCrH75r2ELjg8LR2S3v4DLErGa5d3y7Lr7x5jhHEdhT';
const SPENDER = 'GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d';
const SVC = 'SvcPda1111111111111111111111111111111111111';
const GW_TOKEN = 'GwTok11111111111111111111111111111111111111';

function harness(over: { env?: Record<string, string>; payment?: PaymentView | null | 'error'; upstreamFails?: boolean; payee?: string } = {}) {
  const store = memoryStore();
  let payment: PaymentView | null | 'error' = over.payment === undefined ? null : over.payment;
  const calls = { upstream: 0, refund: 0, refunds: [] as string[] };
  const fake = realUpstream(true);
  const d: Deps = {
    store,
    env: readComputeEnv({ GATEWAY_SECRET: 'x'.repeat(40), COMPUTE_FAKE_UPSTREAM: '1', NODE_ENV: 'test', ...over.env }),
    programId: PROGRAM,
    now: () => Date.UTC(2026, 10, 8, 14, 0, 0),
    readService: async () => ({ address: SVC, payeeToken: over.payee ?? GW_TOKEN, active: true }),
    gatewayToken: async () => GW_TOKEN,
    spenderPda: () => SPENDER,
    paymentPda: (s, i) => `pay:${s}:${i}`,
    readPayment: async () => payment,
    upstream: async (a) => {
      calls.upstream++;
      if (over.upstreamFails) throw new Error('boom');
      return fake(a);
    },
    refund: async (q: Quote, reason: string): Promise<RefundOutcome> => {
      calls.refund++;
      calls.refunds.push(reason);
      const signature = `sig-${q.intent.slice(0, 6)}`;
      if (!(await store.setNX(`refund:${q.intent}`, JSON.stringify({ signature, state: 'confirmed', reason }), 60))) {
        return { state: 'confirmed', signature, reason };
      }
      return { state: 'confirmed', signature, reason };
    },
  };
  const setPayment = (p: PaymentView | null | 'error') => (payment = p);
  return { d, store, calls, setPayment };
}

const paidFor = (q: { amount: string }, over: Partial<PaymentView> = {}): PaymentView => ({
  owner: PROGRAM,
  team: TEAM,
  spender: SPENDER,
  service: SVC,
  payeeToken: GW_TOKEN,
  amount: BigInt(q.amount),
  status: 'paid',
  deadline: 0,
  ...over,
});

async function quoted(h: ReturnType<typeof harness>, prompt = 'What is Rein?') {
  const r = await quote(h.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt, maxTokens: 1024 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as { intent: string; amount: string };
}

describe('pricing', () => {
  it('charges at least one cent', () => {
    const { amount } = priceOf(CATALOG['claude-haiku-5-5'], 'hi', 1024);
    assert.equal(amount, 10_000n);
  });
  it('rounds the marked-up worst case up to the cent', () => {
    // $10/MTok in and out: bytes × 10 + 1000 × 10 micro... = 1.5 × (bytes + 1000) × 10 base units
    const p = { inMicroPerMTok: 10_000_000n, outMicroPerMTok: 10_000_000n, source: 't' };
    const prompt = 'a'.repeat(4000);
    const bytes = BigInt(Buffer.byteLength(SYSTEM_PROMPT + prompt));
    const raw = (bytes + 1000n) * 10n; // base units
    const want = ((raw * 3n + 2n * 10_000n - 1n) / (2n * 10_000n)) * 10_000n;
    const { amount, worst } = priceOf(p, prompt, 1000);
    assert.equal(amount, want);
    assert.equal(worst, raw);
    assert.equal(amount % 10_000n, 0n);
  });
  it('counts bytes, not characters', () => {
    const p = { inMicroPerMTok: 1_000_000_000n, outMicroPerMTok: 1n, source: 't' };
    assert.ok(priceOf(p, 'é'.repeat(100), 1).worst > priceOf(p, 'e'.repeat(100), 1).worst);
  });
  it('parses an operator price and refuses junk', () => {
    assert.deepEqual(parsePriceOverride('1.25/10')?.inMicroPerMTok, 1_250_000n);
    assert.equal(parsePriceOverride('free'), null);
    assert.equal(parsePriceOverride('0/0'), null);
  });
});

describe('intent', () => {
  it('is c + 31 base64url characters, valid for the program, and keyed', () => {
    const f = { team: TEAM, spender: SPENDER, service: 'claude-run', amount: 10_000n, promptSha: 'ab', maxTokens: 1024, nonce: 'n' };
    const a = intentFor('s'.repeat(32), f);
    assert.equal(a.length, 32);
    assert.match(a, INTENT_RE);
    assert.equal(a, intentFor('s'.repeat(32), f));
    assert.notEqual(a, intentFor('t'.repeat(32), f));
    assert.notEqual(a, intentFor('s'.repeat(32), { ...f, amount: 20_000n }));
  });
});

describe('config', () => {
  it('needs a key unless the fake upstream is on, and a price for codex', () => {
    const env = readComputeEnv({ NODE_ENV: 'production' });
    assert.equal(serviceSetup(env, 'claude-run').ok, false);
    assert.equal(serviceSetup(env, 'codex-run').ok, false);
    const withKey = readComputeEnv({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', CODEX_MODEL: 'some-codex' });
    assert.equal(serviceSetup(withKey, 'claude-run').ok, true);
    assert.equal(serviceSetup(withKey, 'codex-run').ok, false, 'no verified price for an unknown codex model');
    const priced = readComputeEnv({ OPENAI_API_KEY: 'k', CODEX_MODEL: 'some-codex', COMPUTE_PRICE_CODEX_RUN: '1.25/10' });
    assert.equal(serviceSetup(priced, 'codex-run').ok, true);
  });
  it('treats a malformed budget as zero', () => {
    assert.equal(readComputeEnv({ COMPUTE_DAILY_BUDGET_USD: 'lots' }).dailyBudget, 0n);
    assert.equal(readComputeEnv({}).dailyBudget, 10_000_000n);
  });
});

describe('quote', () => {
  it('stores the quote for the intent', async () => {
    const h = harness();
    const q = await quoted(h);
    assert.match(q.intent, INTENT_RE);
    const stored = JSON.parse((await h.store.get(`quote:${q.intent}`))!);
    assert.equal(stored.prompt, 'What is Rein?');
    assert.equal(stored.spender, SPENDER);
    assert.equal(stored.payeeToken, GW_TOKEN);
  });
  it('refuses when halted by env or by the Redis key', async () => {
    const off = harness({ env: { COMPUTE_ENABLED: 'false' } });
    assert.equal((await quote(off.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt: 'x', maxTokens: 10 })).status, 503);
    const h = harness();
    await h.store.set('compute:halt', '1', 60);
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt: 'x', maxTokens: 10 })).status, 503);
  });
  it('answers 503 without a key in production', async () => {
    const h = harness({ env: { COMPUTE_FAKE_UPSTREAM: '0', NODE_ENV: 'production' } });
    const r = await quote(h.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt: 'x', maxTokens: 10 });
    assert.equal(r.status, 503);
    assert.match(String(r.body.error), /not configured/);
  });
  it('refuses a service whose registry payee is not the gateway', async () => {
    const h = harness({ payee: 'Other1111111111111111111111111111111111111' });
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt: 'x', maxTokens: 10 })).status, 503);
  });
  it('refuses over the daily budget and over the team run count', async () => {
    const h = harness({ env: { COMPUTE_DAILY_BUDGET_USD: '0.01' } });
    await h.store.set('spend:2026-11-08', '10000', 60);
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt: 'x', maxTokens: 10 })).status, 429);
    const t = harness();
    await t.store.set(`runs:${TEAM}:2026-11-08`, '20', 60);
    assert.equal((await quote(t.d, { team: TEAM, authority: AUTH, service: 'claude-run', prompt: 'x', maxTokens: 10 })).status, 429);
  });
});

describe('run', () => {
  it('waits for payment, then for approval, then runs once and labels the fake', async () => {
    const h = harness();
    const q = await quoted(h);
    assert.equal((await run(h.d, q.intent)).status, 402);
    h.setPayment(paidFor(q, { status: 'pending', deadline: 1_800_000_000 }));
    const pending = await run(h.d, q.intent);
    assert.equal(pending.status, 402);
    assert.equal(pending.body.status, 'pending_approval');
    h.setPayment(paidFor(q, { status: 'settled' }));
    const done = await run(h.d, q.intent);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const res = done.body.result as { text: string; fake: boolean };
    assert.equal(res.fake, true);
    assert.ok(res.text.startsWith(FAKE_PREFIX));
    const again = await run(h.d, q.intent);
    assert.equal(again.body.status, 'done');
    assert.equal(h.calls.upstream, 1, 'a second call returns the stored result');
    assert.equal((await result(h.d, q.intent)).body.status, 'done');
    assert.equal(await h.store.get(`teamrun:${TEAM}`), null, 'team lock released');
  });
  it('refuses a payment that does not match the quote, without refunding', async () => {
    for (const bad of [{ amount: 1n }, { team: 'x' }, { spender: 'x' }, { service: 'x' }, { payeeToken: 'x' }] as Partial<PaymentView>[]) {
      const h = harness();
      const q = await quoted(h);
      h.setPayment(paidFor(q, bad));
      const r = await run(h.d, q.intent);
      assert.equal(r.status, 409, Object.keys(bad).join());
      assert.equal(h.calls.upstream + h.calls.refund, 0);
    }
  });
  it('refuses an account the program does not own, and a declined payment', async () => {
    const h = harness();
    const q = await quoted(h);
    h.setPayment(paidFor(q, { owner: '11111111111111111111111111111111' }));
    assert.equal((await run(h.d, q.intent)).status, 409);
    h.setPayment(paidFor(q, { status: 'declined' }));
    assert.equal((await run(h.d, q.intent)).status, 409);
    assert.equal(h.calls.upstream, 0);
  });
  it('treats an unread payment as unknown, not unpaid', async () => {
    const h = harness();
    const q = await quoted(h);
    h.setPayment('error');
    const r = await run(h.d, q.intent);
    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'unknown');
  });
  it('refunds a failed model call exactly once', async () => {
    const h = harness({ upstreamFails: true });
    const q = await quoted(h);
    h.setPayment(paidFor(q));
    const r = await run(h.d, q.intent);
    assert.equal(r.body.status, 'refunded');
    const again = await run(h.d, q.intent);
    assert.equal(again.body.status, 'refunded');
    assert.equal(h.calls.refund, 1);
    assert.equal((await result(h.d, q.intent)).body.status, 'refunded');
  });
  it('refunds a paid run when the budget ran out after the quote', async () => {
    const h = harness({ env: { COMPUTE_DAILY_BUDGET_USD: '0.01' } });
    const q = await quoted(h);
    h.setPayment(paidFor(q));
    await h.store.set('spend:2026-11-08', '9999', 60);
    const r = await run(h.d, q.intent);
    assert.equal(r.body.status, 'refunded');
    assert.equal(h.calls.upstream, 0);
    assert.equal(await h.store.get('spend:2026-11-08'), '9999', 'the counter is restored');
  });
  it('refunds when the team has used its runs, and when halted after payment', async () => {
    const h = harness();
    const q = await quoted(h);
    h.setPayment(paidFor(q));
    await h.store.set(`runs:${TEAM}:2026-11-08`, '20', 60);
    assert.equal((await run(h.d, q.intent)).body.status, 'refunded');
    const k = harness();
    const q2 = await quoted(k);
    k.setPayment(paidFor(q2));
    await k.store.set('compute:halt', '1', 60);
    assert.equal((await run(k.d, q2.intent)).body.status, 'refunded');
    assert.equal(h.calls.upstream + k.calls.upstream, 0);
  });
  it('runs one at a time per team and per intent', async () => {
    const h = harness();
    const q = await quoted(h);
    h.setPayment(paidFor(q));
    await h.store.set(`teamrun:${TEAM}`, 'other', 60);
    const busy = await run(h.d, q.intent);
    assert.equal(busy.body.status, 'busy');
    assert.equal(await h.store.get(`run:${q.intent}`), null, 'the intent lock is let go when the team is busy');
    await h.store.del(`teamrun:${TEAM}`);
    await h.store.set(`run:${q.intent}`, '1', 60);
    assert.equal((await run(h.d, q.intent)).body.status, 'running');
    assert.equal(h.calls.upstream, 0);
  });
  it('rejects malformed and unknown intents', async () => {
    const h = harness();
    assert.equal((await run(h.d, 'ag-123')).status, 400);
    assert.equal((await run(h.d, 'c' + 'A'.repeat(31))).status, 404);
  });
});

describe('memory store', () => {
  it('has Redis semantics for setNX, TTL and incrBy', async () => {
    let t = 0;
    const kv = new MemoryKV(() => t);
    assert.equal(await kv.setNX('a', '1', 10), true);
    assert.equal(await kv.setNX('a', '2', 10), false);
    t = 11_000;
    assert.equal(await kv.get('a'), null);
    assert.equal(await kv.setNX('a', '3', 10), true);
    assert.equal(await kv.incrBy('n', 5n), 5n);
    assert.equal(await kv.incrBy('n', -2n), 3n);
    await kv.set('s', 'x', 10);
    await assert.rejects(kv.incrBy('s', 1n));
  });
});
