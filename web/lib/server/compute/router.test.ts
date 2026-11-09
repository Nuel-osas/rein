import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routerBackend, routerWorstCase, ROUTER_BASE } from './router';

// gpt-5.6-luna's entry as https://router-api.0g.ai/v1/models listed it on 2026-11-08 (prices only),
// renamed to the model ai-chat uses so the backend finds it.
const LISTED = {
  id: '0gm-1.0-35b-a3b',
  pricing: { prompt: '1376311883284', completion: '8257871299700' },
  pricing_usd: { prompt: '0.0000002', completion: '0.0000012' },
};
// claude-haiku-5.5 as /v1/models listed it on 2026-11-09 (prices only).
const HAIKU = {
  id: 'claude-haiku-5.5',
  pricing: { prompt: '714175272182', completion: '3570876360906' },
  pricing_usd: { prompt: '0.0000001', completion: '0.0000005' },
};

type Call = { url: string; init?: RequestInit };
function fakeFetch(chat: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [LISTED, HAIKU] }), { status: 200 });
    return new Response(JSON.stringify(chat.body), { status: chat.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const sig = () => new AbortController().signal;

describe('0G Router backend', () => {
  it('prices the worst case from the listed neuron prices and derives USD per 0G from the two lists', () => {
    const p = routerWorstCase(LISTED, 4_000, 1_024);
    assert.equal(p.ok, true);
    if (!p.ok) return;
    assert.ok(p.maxCostNeuron > 0n);
    assert.ok(Math.abs(p.usdPerZg - 0.2 / 1.376311883284) < 1e-9);
  });

  it('refuses a model with no listed price', () => {
    assert.equal(routerWorstCase({ id: 'x' }, 4_000, 1_024).ok, false);
  });

  it('sends private trust mode and verify_tee, and reports verified only when the Router says tee_verified', async () => {
    delete (globalThis as { __reinRouterModels?: unknown }).__reinRouterModels;
    const { f, calls } = fakeFetch({
      status: 200,
      body: { choices: [{ message: { content: 'hello' } }], x_0g_trace: { provider: '0xabc', tee_verified: true, billing: { total_cost: '1234' } } },
    });
    const b = routerBackend('sk-test', f);
    const price = await b.priceOf('ai-chat');
    assert.equal(price.ok, true);
    const r = await b.run('ai-chat', { prompt: 'hi' }, { purchaseId: 'q1', signal: sig() });
    assert.deepEqual(r, { ok: true, output: { kind: 'text', text: 'hello' }, fake: false, verified: true, covers: 'response', provider: '0xabc', costNeuron: 1234n });
    const chat = calls.find((c) => c.url === `${ROUTER_BASE}/chat/completions`)!;
    const h = chat.init!.headers as Record<string, string>;
    assert.equal(h['x-0g-provider-trust-mode'], 'private');
    assert.equal(h.authorization, 'Bearer sk-test');
    const body = JSON.parse(String(chat.init!.body));
    assert.equal(body.model, '0gm-1.0-35b-a3b');
    assert.equal(body.verify_tee, true);
    assert.equal(body.max_tokens, 1024);
  });

  it('does not call a run verified without tee_verified', async () => {
    const { f } = fakeFetch({ status: 200, body: { choices: [{ message: { content: 'hi' } }], x_0g_trace: {} } });
    const r = await routerBackend('sk-test', f).run('ai-chat', { prompt: 'hi' }, { purchaseId: 'q2', signal: sig() });
    assert.equal(r.ok && r.verified, false);
  });

  it('turns a refusal (no TEE provider) into a failed run, which the gateway refunds', async () => {
    const { f } = fakeFetch({ status: 503, body: { error: { type: 'server_error', code: 'no_provider_for_trust_mode', message: 'no provider available for trust mode: tier=private' } } });
    const r = await routerBackend('sk-test', f).run('ai-chat', { prompt: 'hi' }, { purchaseId: 'q3', signal: sig() });
    assert.deepEqual(r.ok ? null : r.code, 'no_provider_for_trust_mode');
  });

  it('treats an empty answer and an unpaid account as failures', async () => {
    const empty = await routerBackend('sk-test', fakeFetch({ status: 200, body: { choices: [{ message: { content: '' } }] } }).f).run('ai-chat', { prompt: 'hi' }, { purchaseId: 'q4', signal: sig() });
    assert.equal(empty.ok, false);
    const broke = await routerBackend('sk-test', fakeFetch({ status: 402, body: { error: { code: 'insufficient_balance', message: 'deposit more' } } }).f).run('ai-chat', { prompt: 'hi' }, { purchaseId: 'q5', signal: sig() });
    assert.deepEqual(broke.ok ? null : broke.code, 'insufficient_balance');
  });

  it('has no readable balance by design, so the floor check is skipped', async () => {
    const b = routerBackend('sk-test', fakeFetch({ status: 200, body: {} }).f);
    assert.equal(b.ledgerOptional, true);
    assert.equal(await b.ledgerNeuron(), null);
  });

  it('runs Claude relayed: standard trust, low reasoning effort, never verified, covers none', async () => {
    delete (globalThis as { __reinRouterModels?: unknown }).__reinRouterModels;
    const { f, calls } = fakeFetch({ status: 200, body: { choices: [{ message: { content: 'hi from claude' } }], x_0g_trace: { provider: '0xdef', tee_verified: true } } });
    const b = routerBackend('sk-test', f);
    assert.equal(b.model('ai-claude'), 'claude-haiku-5.5');
    const price = await b.priceOf('ai-claude');
    assert.equal(price.ok, true);
    const r = await b.run('ai-claude', { prompt: 'hi' }, { purchaseId: 'q6', signal: sig() });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Even a trace that claims tee_verified does not make a relayed answer verified.
    assert.equal(r.verified, false);
    assert.equal(r.covers, 'none');
    const chat = calls.find((c) => c.url === `${ROUTER_BASE}/chat/completions`)!;
    assert.equal((chat.init!.headers as Record<string, string>)['x-0g-provider-trust-mode'], 'standard');
    const body = JSON.parse(String(chat.init!.body));
    assert.equal(body.model, 'claude-haiku-5.5');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.verify_tee, undefined);
  });

  it('without a key it prices from the public list but never runs or fakes an answer', async () => {
    delete (globalThis as { __reinRouterModels?: unknown }).__reinRouterModels;
    const { f, calls } = fakeFetch({ status: 200, body: { choices: [{ message: { content: 'must not be returned' } }] } });
    const b = routerBackend(null, f);
    assert.equal((await b.priceOf('ai-gpt')).ok, false); // gpt-5.6-luna is not in this fake list
    assert.equal((await b.priceOf('ai-claude')).ok, true);
    const r = await b.run('ai-claude', { prompt: 'hi' }, { purchaseId: 'q7', signal: sig() });
    assert.deepEqual(r.ok ? null : r.code, 'not_configured');
    assert.equal(calls.some((c) => c.url.endsWith('/chat/completions')), false);
  });

  it('refuses audio and image services', async () => {
    const r = await routerBackend('sk-test', fakeFetch({ status: 200, body: {} }).f).run('ai-voice', { prompt: 'x' }, { purchaseId: 'q8', signal: sig() });
    assert.equal(r.ok, false);
  });
});
