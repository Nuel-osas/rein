import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryStore, MemoryKV } from '../store';
import {
  catalog,
  intentFor,
  INTENT_RE,
  neuronToMicroUsd,
  priceOf,
  quote,
  readComputeEnv,
  result,
  run,
  type ComputeBackendLike,
  type Deps,
  type PaymentView,
  type Quote,
  type RefundOutcome,
} from './core';
import { FAKE_PREFIX, fakeBackend } from './backend';

const PROGRAM = 'F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe';
const TEAM = 'EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5';
const AUTH = 'EYCrH75r2ELjg8LR2S3v4DLErGa5d3y7Lr7x5jhHEdhT';
const SPENDER = 'GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d';
const SVC = 'SvcPda1111111111111111111111111111111111111';
const GW_TOKEN = 'GwTok11111111111111111111111111111111111111';

function harness(over: { env?: Record<string, string>; payment?: PaymentView | null | 'error'; upstreamFails?: boolean; payee?: string; ledgerNeuron?: bigint | null; noBackend?: boolean } = {}) {
  const store = memoryStore();
  let payment: PaymentView | null | 'error' = over.payment === undefined ? null : over.payment;
  const calls = { upstream: 0, refund: 0, refunds: [] as string[] };
  const fake = fakeBackend({ ledgerNeuron: over.ledgerNeuron, fail: over.upstreamFails });
  const counted: ComputeBackendLike = {
    ...fake,
    run: async (svc, prompt, o) => {
      calls.upstream++;
      return fake.run(svc, prompt, o);
    },
  };
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
    backend: async () => (over.noBackend ? { error: 'no 0G wallet key on this server' } : counted),
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
  const r = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as { intent: string; amount: string };
}

describe('pricing', () => {
  it('charges at least one cent', () => {
    // The live probe's chat worst case: 0.00583 0G at $0.2536 is about $0.0015, so the floor applies.
    assert.equal(priceOf(5_830_000_000_000_000n, 0.2536).amount, 10_000n);
  });
  it('is 0G worst case x rate x 1.5, rounded up to the cent', () => {
    // 1 0G at $0.25 = 250,000 base units; x1.5 = 375,000 = $0.375 -> $0.38
    const { amount, worst } = priceOf(10n ** 18n, 0.25);
    assert.equal(worst, 250_000n);
    assert.equal(amount, 380_000n);
    // the rate is rounded up to the micro-dollar, never down
    assert.equal(priceOf(10n ** 18n, 0.2500001).worst, 250_001n);
  });
  it('refuses nonsense inputs', () => {
    assert.throws(() => priceOf(0n, 0.25));
    assert.throws(() => priceOf(1n, 0));
    assert.throws(() => priceOf(1n, Number.NaN));
  });
  it('values the ledger rounding down', () => {
    assert.equal(neuronToMicroUsd(10n ** 18n, 0.2536), 253_600n);
    assert.equal(neuronToMicroUsd(1n, 0.2536), 0n);
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
  it('never fakes in production', () => {
    assert.equal(readComputeEnv({ NODE_ENV: 'production', COMPUTE_FAKE_UPSTREAM: '1' }).fake, false);
    assert.equal(readComputeEnv({ NODE_ENV: 'development', COMPUTE_FAKE_UPSTREAM: '1' }).fake, true);
  });
  it('defaults to a $5 day and a $0.25 ledger floor, and fails closed on junk', () => {
    const e = readComputeEnv({});
    assert.equal(e.dailyBudget, 5_000_000n);
    assert.equal(e.ledgerFloor, 250_000n);
    assert.equal(readComputeEnv({ COMPUTE_DAILY_BUDGET_USD: 'lots' }).dailyBudget, 0n);
    assert.ok(readComputeEnv({ ZG_LEDGER_FLOOR_USD: 'none' }).ledgerFloor > 10n ** 12n);
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
    assert.equal((await quote(off.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 503);
    const h = harness();
    await h.store.set('compute:halt', '1', 60);
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 503);
  });
  it('answers 503 "not configured" without a 0G key', async () => {
    const h = harness({ noBackend: true });
    const r = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' });
    assert.equal(r.status, 503);
    assert.match(String(r.body.error), /not configured/);
  });
  it('refuses quotes when the 0G ledger is under its floor or unread', async () => {
    const low = harness({ ledgerNeuron: 10n ** 17n }); // 0.1 0G = $0.025 < $0.25
    assert.equal((await quote(low.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 503);
    const unread = harness({ ledgerNeuron: null });
    assert.equal((await quote(unread.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 503);
  });
  it('lists registered services with a live price', async () => {
    const h = harness();
    const c = await catalog(h.d);
    const rows = c.body.services as { id: string; price: string; available: boolean; model: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'ai-chat');
    assert.equal(rows[0].model, '0GM-1.0-35B-A3B');
    assert.equal(rows[0].price, '10000');
    assert.equal(rows[0].available, true);
    const low = harness({ ledgerNeuron: 0n });
    const r = (await catalog(low.d)).body.services as { available: boolean; price: string | null; reason: string }[];
    assert.equal(r[0].available, false);
    assert.equal(r[0].price, null);
    assert.match(r[0].reason, /floor/);
  });
  it('refuses a service whose registry payee is not the gateway', async () => {
    const h = harness({ payee: 'Other1111111111111111111111111111111111111' });
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 503);
  });
  it('refuses over the daily budget and over the team run count', async () => {
    const h = harness({ env: { COMPUTE_DAILY_BUDGET_USD: '0.01' } });
    await h.store.set('spend:2026-11-08', '9000', 60);
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 429);
    const t = harness();
    await t.store.set(`runs:${TEAM}:2026-11-08`, '20', 60);
    assert.equal((await quote(t.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).status, 429);
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
    const res = done.body.result as { text: string; fake: boolean; verified: boolean };
    assert.equal(res.fake, true);
    assert.equal(res.verified, false, 'a fake is never reported as verified');
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
    await h.store.set('spend:2026-11-08', '9000', 60);
    const r = await run(h.d, q.intent);
    assert.equal(r.body.status, 'refunded');
    assert.equal(h.calls.upstream, 0);
    assert.equal(await h.store.get('spend:2026-11-08'), '9000', 'the counter is restored');
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

describe('gateway key', () => {
  it('says compute is not configured when the gateway key is missing', async () => {
    const h = harness();
    h.d.gatewayToken = async () => null;
    const r = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' });
    assert.equal(r.status, 503);
    assert.match(String(r.body.error), /no gateway key/);
    h.d.gatewayToken = async () => 'error';
    assert.match(String((await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-chat', prompt: 'x' })).body.error), /Could not read/);
  });
});
