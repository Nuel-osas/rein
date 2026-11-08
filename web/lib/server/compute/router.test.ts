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

type Call = { url: string; init?: RequestInit };
function fakeFetch(chat: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [LISTED] }), { status: 200 });
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
    const r = await b.run('ai-chat', 'hi', { purchaseId: 'q1', signal: sig() });
    assert.deepEqual(r, { ok: true, text: 'hello', fake: false, verified: true, covers: 'response', provider: '0xabc', costNeuron: 1234n });
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
    const r = await routerBackend('sk-test', f).run('ai-chat', 'hi', { purchaseId: 'q2', signal: sig() });
    assert.equal(r.ok && r.verified, false);
  });

  it('turns a refusal (no TEE provider) into a failed run, which the gateway refunds', async () => {
    const { f } = fakeFetch({ status: 503, body: { error: { type: 'server_error', code: 'no_provider_for_trust_mode', message: 'no provider available for trust mode: tier=private' } } });
    const r = await routerBackend('sk-test', f).run('ai-chat', 'hi', { purchaseId: 'q3', signal: sig() });
    assert.deepEqual(r.ok ? null : r.code, 'no_provider_for_trust_mode');
  });

  it('treats an empty answer and an unpaid account as failures', async () => {
    const empty = await routerBackend('sk-test', fakeFetch({ status: 200, body: { choices: [{ message: { content: '' } }] } }).f).run('ai-chat', 'hi', { purchaseId: 'q4', signal: sig() });
    assert.equal(empty.ok, false);
    const broke = await routerBackend('sk-test', fakeFetch({ status: 402, body: { error: { code: 'insufficient_balance', message: 'deposit more' } } }).f).run('ai-chat', 'hi', { purchaseId: 'q5', signal: sig() });
    assert.deepEqual(broke.ok ? null : broke.code, 'insufficient_balance');
  });

  it('has no readable balance by design, so the floor check is skipped', async () => {
    const b = routerBackend('sk-test', fakeFetch({ status: 200, body: {} }).f);
    assert.equal(b.ledgerOptional, true);
    assert.equal(await b.ledgerNeuron(), null);
  });
});
