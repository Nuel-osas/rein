// The services beyond ai-chat: which backend serves each one, how voice audio and image results are
// checked, bound, stored and served, and that a Router service without its key never fakes a run.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryStore } from '../store';
import {
  checkInput,
  decodeBase64,
  priceOf,
  quote,
  resultBlob,
  run,
  sha256Bytes,
  sniffImage,
  type BackendInput,
  type BackendMissing,
  type ComputeBackendLike,
  type ComputeService,
  type Deps,
  type PaymentView,
  type Quote,
  type RefundOutcome,
} from './core';
import { buildServiceTable, COMING_SOON, modelFromEnv, relayedMaxTokens, SERVICE_TABLE } from './catalog';
import { chooseBackend, FAKE_MP4, FAKE_PNG, fakeBackend, ROUTER_KEY_MISSING, type BackendMakers } from './backend';
import { kvBlobs, KV_MAX_BYTES } from './blobs';
import { ROUTER_BASE, routerBackend, routerVideoWorstCase, videoTokens } from './router';
import { JOB_DEADLINE_MS, result, type JobPoll } from './core';

const PROGRAM = 'F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe';
const TEAM = 'EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5';
const AUTH = 'EYCrH75r2ELjg8LR2S3v4DLErGa5d3y7Lr7x5jhHEdhT';
const SPENDER = 'GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d';
const SVC = 'SvcPda1111111111111111111111111111111111111';
const GW_TOKEN = 'GwTok11111111111111111111111111111111111111';

/** A PCM WAV: 16 kHz, mono, 16-bit, `seconds` long, silent. */
function wav(seconds: number): Uint8Array {
  const rate = 16_000;
  const data = Math.round(rate * 2 * seconds);
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(data, 40);
  return new Uint8Array(b);
}

type Over = { backend?: (s: ComputeService) => ComputeBackendLike | BackendMissing; noBlobs?: boolean };

function harness(over: Over = {}) {
  const store = memoryStore();
  let payment: PaymentView | null = null;
  const calls = { upstream: 0, inputs: [] as BackendInput[], refunds: [] as string[] };
  const fake = fakeBackend();
  const counted: ComputeBackendLike = {
    ...fake,
    run: async (s, input, o) => {
      calls.upstream++;
      calls.inputs.push(input);
      return fake.run(s, input, o);
    },
  };
  const blobs = kvBlobs(store, 3600);
  const d: Deps = {
    store,
    env: { production: false, enabled: true, fake: true, dailyBudget: 5_000_000n, ledgerFloor: 0n, gatewaySecret: 'x'.repeat(40), zgKeyPresent: true },
    programId: PROGRAM,
    now: () => Date.UTC(2026, 10, 9, 9, 0, 0),
    readService: async () => ({ address: SVC, payeeToken: GW_TOKEN, active: true }),
    gatewayToken: async () => GW_TOKEN,
    spenderPda: () => SPENDER,
    paymentPda: (s, i) => `pay:${s}:${i}`,
    readPayment: async () => payment,
    backend: async (s) => (over.backend ? over.backend(s) : counted),
    blobs: over.noBlobs ? undefined : blobs,
    refund: async (q: Quote, reason: string): Promise<RefundOutcome> => {
      calls.refunds.push(reason);
      const signature = `sig-${q.intent.slice(0, 6)}`;
      await store.setNX(`refund:${q.intent}`, JSON.stringify({ signature, state: 'confirmed', reason }), 60);
      return { state: 'confirmed', signature, reason };
    },
  };
  const pay = (q: { amount: string }) =>
    (payment = { owner: PROGRAM, team: TEAM, spender: SPENDER, service: SVC, payeeToken: GW_TOKEN, amount: BigInt(q.amount), status: 'paid', deadline: 0 });
  return { d, store, blobs, calls, pay, setPending: () => payment && (payment = { ...payment, status: 'pending', deadline: 2_000_000_000 }) };
}

const makers = () => {
  const made: string[] = [];
  const m: BackendMakers = {
    router: (k) => {
      made.push(k ? 'router' : 'router-pricer');
      return { ...fakeBackend(), route: 'router' };
    },
    wallet: () => {
      made.push('wallet');
      return { ...fakeBackend(), route: 'wallet' };
    },
  };
  return { m, made };
};

describe('catalog', () => {
  it('labels every service "run by Rein on 0G" with an honest trust level, and fits the 32-byte registry label', () => {
    for (const [id, meta] of Object.entries(SERVICE_TABLE)) {
      assert.ok(Buffer.byteLength(meta.label) <= 32, `${id} label is ${Buffer.byteLength(meta.label)} bytes`);
      assert.match(meta.name, /, run by Rein on 0G$/);
    }
    assert.deepEqual(
      Object.fromEntries(Object.entries(SERVICE_TABLE).map(([id, m]) => [id, [m.route, m.trust]])),
      { 'ai-chat': ['wallet', 'tee'], 'ai-image': ['wallet', 'tee'], 'ai-voice': ['wallet', 'tee'], 'ai-claude': ['router', 'relayed'], 'ai-gpt': ['router', 'relayed'], 'ai-video': ['router', 'relayed'] },
    );
    assert.equal(COMING_SOON.length, 0);
    assert.equal(SERVICE_TABLE['ai-video'].async, true);
    assert.equal(SERVICE_TABLE['ai-video'].model, 'bytedance/seedance-2.0-fast');
  });
  it('takes the Claude and GPT models from env, with defaults, and refuses a malformed id', () => {
    const d = buildServiceTable({});
    assert.equal(d['ai-claude'].model, 'claude-haiku-5.5');
    assert.equal(d['ai-gpt'].model, 'gpt-5.6-luna');
    const t = buildServiceTable({ COMPUTE_CLAUDE_MODEL: 'claude-sonnet-5.5', COMPUTE_GPT_MODEL: 'gpt-5.6-sol' });
    assert.equal(t['ai-claude'].model, 'claude-sonnet-5.5');
    assert.equal(t['ai-claude'].name, 'Claude Sonnet 5.5, run by Rein on 0G');
    assert.equal(t['ai-gpt'].model, 'gpt-5.6-sol');
    assert.equal(modelFromEnv('bad model; drop', 'x'), null);
    assert.equal(buildServiceTable({ COMPUTE_RELAYED_MAX_TOKENS: '200' })['ai-gpt'].maxOutputTokens, 200);
    assert.equal(relayedMaxTokens(undefined), 1_024);
    assert.equal(relayedMaxTokens('99999'), 64);
    assert.equal(relayedMaxTokens('abc'), 64);
    assert.notEqual(buildServiceTable({ COMPUTE_CLAUDE_MODEL: 'a b' })['ai-claude'].model, 'claude-haiku-5.5');
  });
});

describe('backend per service', () => {
  it('runs chat, voice and image on the wallet even with a Router key, and Claude and GPT only on the Router', () => {
    const { m, made } = makers();
    const both = { routerKey: 'sk-x', zgKey: '0xkey', maxLedgerZg: 10 };
    for (const s of ['ai-voice', 'ai-image', 'ai-claude', 'ai-gpt', 'ai-video', 'ai-chat'] as ComputeService[]) chooseBackend(s, both, m);
    // The Router's private mode returned no tee_verified (2026-11-09), so TEE services never go there.
    assert.deepEqual(made, ['wallet', 'wallet', 'router', 'router', 'router', 'wallet']);
  });
  it('without a Router key: chat stays on the wallet, Claude and GPT are not configured but can be priced', () => {
    const { m, made } = makers();
    const wallet = { routerKey: null, zgKey: '0xkey', maxLedgerZg: 10 };
    assert.equal('error' in chooseBackend('ai-chat', wallet, m), false);
    const c = chooseBackend('ai-claude', wallet, m);
    assert.ok('error' in c && c.notConfigured && c.pricer);
    assert.equal((c as BackendMissing).error, ROUTER_KEY_MISSING);
    assert.deepEqual(made, ['wallet', 'router-pricer']);
  });
  it('without a wallet key: chat, voice and image are not configured and have no pricer (never sent to the Router)', () => {
    const { m, made } = makers();
    const routerOnly = { routerKey: 'sk-x', zgKey: null, maxLedgerZg: 10 };
    for (const s of ['ai-chat', 'ai-voice', 'ai-image'] as ComputeService[]) {
      const b = chooseBackend(s, routerOnly, m);
      assert.ok('error' in b && b.notConfigured && !b.pricer);
    }
    assert.deepEqual(made, []);
  });
});

describe('Router services without a key never fake', () => {
  it('quotes from the public price, then refunds the paid run with 503 not_configured and calls nothing', async () => {
    let fetched = 0;
    const models = { data: [{ id: 'claude-haiku-5.5', pricing: { prompt: '714175272182', completion: '3570876360906' }, pricing_usd: { prompt: '0.0000001', completion: '0.0000005' } }] };
    const f = (async (url: string | URL) => {
      fetched++;
      if (String(url).endsWith('/models')) return new Response(JSON.stringify(models), { status: 200 });
      throw new Error('a run must not reach the Router');
    }) as unknown as typeof fetch;
    delete (globalThis as { __reinRouterModels?: unknown }).__reinRouterModels;
    const h = harness({ backend: (s) => chooseBackend(s, { routerKey: null, zgKey: '0xkey', maxLedgerZg: 10 }, { router: (k) => routerBackend(k, f), wallet: () => fakeBackend() }) });
    const q = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-claude', prompt: 'Review this policy.' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.configured, false);
    assert.equal(q.body.code, 'not_configured');
    assert.equal(q.body.trust, 'relayed');
    assert.equal(q.body.amount, '10000'); // the $0.01 floor: Haiku's worst case is about $0.002
    // Pending until the owner approves: nothing runs, nothing is refunded.
    h.pay(q.body as { amount: string });
    h.setPending();
    const waiting = await run(h.d, q.body.intent as string);
    assert.equal(waiting.status, 402);
    // Approved (paid): no key, so the full price goes back and the reply says not configured.
    h.pay(q.body as { amount: string });
    const r = await run(h.d, q.body.intent as string);
    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'refunded');
    assert.equal(r.body.code, 'not_configured');
    assert.equal(h.calls.refunds.length, 1);
    assert.match(h.calls.refunds[0], /not configured/);
    assert.equal(fetched, 1); // the model list only
    assert.equal(await h.store.get(`result:${q.body.intent}`), null);
  });
});

describe('voice', () => {
  it('checks the audio by its bytes: container, declared type, size and length', () => {
    const ok = checkInput('ai-voice', { audio: { bytes: wav(2), mime: 'audio/wav' } });
    assert.ok(!('error' in ok) && ok.kind === 'audio');
    if ('error' in ok || ok.kind !== 'audio') return;
    assert.equal(ok.mime, 'audio/wav');
    assert.ok(ok.seconds >= 2 && ok.seconds < 2.1);
    assert.equal(ok.sha, sha256Bytes(wav(2)));
    assert.match(String((checkInput('ai-voice', { audio: { bytes: wav(2), mime: 'audio/mpeg' } }) as { error: string }).error), /wav but was sent as audio\/mpeg/);
    assert.match(String((checkInput('ai-voice', { audio: { bytes: wav(61), mime: 'audio/wav' } }) as { error: string }).error), /at most 60 seconds/);
    assert.match(String((checkInput('ai-voice', { audio: { bytes: new TextEncoder().encode('<html>not audio</html>') } }) as { error: string }).error), /could not read/);
    assert.match(String((checkInput('ai-voice', { audio: { bytes: new Uint8Array(3 * 1024 * 1024 + 1) } }) as { error: string }).error), /at most 3 MB/);
    assert.match(String((checkInput('ai-voice', { prompt: 'hi' }) as { error: string }).error), /audio file/);
    assert.match(String((checkInput('ai-chat', { audio: { bytes: wav(1) } }) as { error: string }).error), /prompt, not audio/);
  });
  it('decodes only base64 within the cap', () => {
    assert.deepEqual(decodeBase64(Buffer.from('abc').toString('base64'), 10), new Uint8Array(Buffer.from('abc')));
    assert.equal(decodeBase64('not base64!', 10), null);
    assert.equal(decodeBase64(Buffer.alloc(11).toString('base64'), 10), null);
    assert.equal(decodeBase64('', 10), null);
  });
  it("binds the audio's sha256 into the intent, stores it, and runs exactly those bytes", async () => {
    const h = harness();
    const a = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-voice', audio: { bytes: wav(2), mime: 'audio/wav' } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-voice', audio: { bytes: wav(3), mime: 'audio/wav' } });
    assert.notEqual(a.body.intent, b.body.intent);
    assert.equal((a.body.audio as { sha256: string }).sha256, sha256Bytes(wav(2)));
    const stored = await h.blobs.get(a.body.intent as string, 'input');
    assert.deepEqual(stored?.bytes, wav(2));
    h.pay(a.body as { amount: string });
    const r = await run(h.d, a.body.intent as string);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const input = h.calls.inputs[0];
    assert.ok('audio' in input);
    if (!('audio' in input)) return;
    assert.deepEqual(input.audio.bytes, wav(2));
    assert.equal(input.audio.mime, 'audio/wav');
    const result = r.body.result as { output: string; text: string };
    assert.equal(result.output, 'text');
  });
  it('refunds instead of running audio that no longer matches the quote', async () => {
    const h = harness();
    const a = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-voice', audio: { bytes: wav(2), mime: 'audio/wav' } });
    const intent = a.body.intent as string;
    await h.store.del(`blob:input:${intent}`);
    await h.blobs.put(intent, 'input', 'audio/wav', wav(3));
    h.pay(a.body as { amount: string });
    const r = await run(h.d, intent);
    assert.equal(r.body.status, 'refunded');
    assert.match(h.calls.refunds[0], /does not match/);
    assert.equal(h.calls.upstream, 0);
  });
  it('refuses to quote audio or images without a blob store', async () => {
    const h = harness({ noBlobs: true });
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-voice', audio: { bytes: wav(1) } })).status, 503);
    assert.equal((await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-image', prompt: 'a cat' })).status, 503);
  });
});

describe('image', () => {
  it('stores the image and serves it from the blob route, told by its bytes', async () => {
    const h = harness();
    const q = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-image', prompt: 'A purple lighthouse at night' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.output, 'image');
    h.pay(q.body as { amount: string });
    const intent = q.body.intent as string;
    const r = await run(h.d, intent);
    const res = r.body.result as { output: string; url: string; mime: string; bytes: number; text: string; resultHash: string };
    assert.equal(res.output, 'image');
    assert.equal(res.url, `/api/compute/result/${intent}/blob`);
    assert.equal(res.mime, 'image/png');
    assert.equal(res.bytes, FAKE_PNG.length);
    assert.equal(res.text, '');
    assert.equal(res.resultHash, sha256Bytes(FAKE_PNG));
    const blob = await resultBlob(h.d, intent);
    assert.ok('ok' in blob && blob.ok);
    if (!('ok' in blob)) return;
    assert.equal(blob.mime, 'image/png');
    assert.deepEqual(blob.bytes, FAKE_PNG);
  });
  it('refunds bytes that are not an image, and never serves them', async () => {
    const h = harness({
      backend: () => ({ ...fakeBackend(), run: async () => ({ ok: true, output: { kind: 'image', mime: 'image/png', bytes: new TextEncoder().encode('<script>alert(1)</script>') }, fake: true, verified: false, covers: 'none', provider: null, costNeuron: null }) }),
    });
    const q = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-image', prompt: 'x' });
    h.pay(q.body as { amount: string });
    const r = await run(h.d, q.body.intent as string);
    assert.equal(r.body.status, 'refunded');
    assert.equal(((await resultBlob(h.d, q.body.intent as string)) as { status: number }).status, 404);
  });
  it('answers 400 for a bad intent, 404 for none, and never serves a stored non-image', async () => {
    const h = harness();
    assert.equal(((await resultBlob(h.d, 'nope')) as { status: number }).status, 400);
    const intent = 'c' + 'A'.repeat(31);
    assert.equal(((await resultBlob(h.d, intent)) as { status: number }).status, 404);
    await h.blobs.put(intent, 'output', 'image/png', new TextEncoder().encode('<html></html>'));
    assert.equal(((await resultBlob(h.d, intent)) as { status: number }).status, 404);
    assert.equal(sniffImage(FAKE_PNG), 'image/png');
    assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  });
  it('keeps small blobs in the KV store and refuses large ones there', async () => {
    const kv = kvBlobs(memoryStore(), 60);
    await assert.rejects(kv.put('i', 'output', 'image/png', new Uint8Array(KV_MAX_BYTES + 1)));
    await kv.put('i', 'output', 'image/png', FAKE_PNG);
    await kv.put('i', 'output', 'image/png', Uint8Array.from([1])); // first write wins
    assert.deepEqual((await kv.get('i', 'output'))?.bytes, FAKE_PNG);
  });
});

describe('pricing of the new services', () => {
  it('is the worst case x 1.5, rounded up to the cent, at least $0.01', () => {
    // At $1 per 0G, a worst case of N 0G is $N. 0G's live worst cases on 2026-11-09:
    const at = (usd: number) => priceOf(BigInt(Math.round(usd * 1e6)) * 10n ** 12n, 1).amount;
    assert.equal(at(0.0015), 10_000n); // chat: $0.00225 -> the $0.01 floor
    assert.equal(at(0.008), 20_000n); // voice: $0.012 -> $0.02
    assert.equal(at(0.009), 20_000n); // image: $0.0135 -> $0.02
  });
});

// bytedance/seedance-2.0-fast's 480p prices as /v1/models listed them on 2026-11-09.
const SEEDANCE = {
  id: 'bytedance/seedance-2.0-fast',
  pricing: { prompt: '0', completion: '39993815242143', variants: [{ dimensions: { has_video_input: 'false', resolution: '480p' }, unit: 'video_token', unit_price: '39993815242143' }, { dimensions: { has_video_input: 'true', resolution: '480p' }, unit: 'video_token', unit_price: '23567783981978' }] },
  pricing_usd: { variants: [{ dimensions: { has_video_input: 'false', resolution: '480p' }, unit: 'video_token', unit_price: '0.0000056' }, { dimensions: { has_video_input: 'true', resolution: '480p' }, unit: 'video_token', unit_price: '0.0000033' }] },
};

describe('video', () => {
  it('prices one 4 s 480p clip from the per-token price, 25% over the probed token count, then x1.5', () => {
    assert.equal(videoTokens(), 40_595n); // 864 x 496 x 97 / 1024 rounded up; the adapter's paid probe was billed 40,594
    const p = routerVideoWorstCase(SEEDANCE);
    assert.ok(p.ok);
    if (!p.ok) return;
    // 40,594 x 1.25 x $0.0000056 = $0.2842; x 1.5 = $0.4263 -> $0.43
    assert.equal(priceOf(p.maxCostNeuron, p.usdPerZg).amount, 430_000n);
    assert.equal(routerVideoWorstCase({ id: 'x', pricing: { variants: [] } }).ok, false);
  });

  it('starts a job on run, finishes it on result, stores the clip and serves it', async () => {
    const h = harness();
    const q = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-video', prompt: 'A purple padlock turning slowly' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.output, 'video');
    h.pay(q.body as { amount: string });
    const intent = q.body.intent as string;
    const started = await run(h.d, intent);
    assert.equal(started.status, 202);
    assert.equal(started.body.status, 'running');
    assert.ok(await h.store.get(`job:${intent}`));
    const r = await result(h.d, intent);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const res = r.body.result as { output: string; mime: string; url: string; verified: boolean; trust: string };
    assert.equal(res.output, 'video');
    assert.equal(res.mime, 'video/mp4');
    assert.equal(res.url, `/api/compute/result/${intent}/blob`);
    assert.equal(res.verified, false);
    assert.equal(res.trust, 'relayed');
    const blob = await resultBlob(h.d, intent);
    assert.ok('ok' in blob);
    if ('ok' in blob) assert.deepEqual(blob.bytes, FAKE_MP4);
    // Asking run again returns the stored result and never starts a second job.
    assert.equal((await run(h.d, intent)).body.status, 'done');
  });

  it('keeps an unreadable job running, refunds a failed one, and refunds one past the deadline', async () => {
    let poll: JobPoll = { state: 'unknown', message: 'status read 502' };
    let starts = 0;
    let now = Date.UTC(2026, 10, 9, 9, 0, 0);
    const h = harness({ backend: () => ({ ...fakeBackend(), startJob: async () => (starts++, { ok: true, jobId: 'job-1' }), pollJob: async () => poll }) });
    h.d.now = () => now;
    const quoteOne = async () => {
      const q = await quote(h.d, { team: TEAM, authority: AUTH, service: 'ai-video', prompt: `clip ${Math.random()}` });
      h.pay(q.body as { amount: string });
      await run(h.d, q.body.intent as string);
      return q.body.intent as string;
    };
    const a = await quoteOne();
    assert.equal((await result(h.d, a)).status, 202); // unknown: still running, nothing refunded
    assert.equal(h.calls.refunds.length, 0);
    poll = { state: 'failed', code: 'job_failed', message: 'content policy' };
    assert.equal((await result(h.d, a)).body.status, 'refunded');
    poll = { state: 'running' };
    const b = await quoteOne();
    now += JOB_DEADLINE_MS + 1;
    assert.equal((await result(h.d, b)).body.status, 'refunded');
    assert.match(h.calls.refunds[1], /30 minutes/);
    assert.equal(starts, 2);
  });

  it('asks the Router for a fixed 4 s 480p 16:9 clip without audio, and reads its job states', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let status = 'queued';
    const f = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.endsWith('/models')) return new Response(JSON.stringify({ data: [SEEDANCE] }), { status: 200 });
      if (u === `${ROUTER_BASE}/videos` && init?.method === 'POST') return new Response(JSON.stringify({ id: 'video_abc123', status: 'queued' }), { status: 200 });
      if (u.endsWith('/content')) return new Response(FAKE_MP4, { status: 200, headers: { 'content-type': 'video/mp4' } });
      if (u === `${ROUTER_BASE}/videos/video_abc123`) return status === 'busy' ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ id: 'video_abc123', status, usage: { completion_tokens: 40594 } }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    delete (globalThis as { __reinRouterModels?: unknown }).__reinRouterModels;
    const b = routerBackend('sk-test', f);
    assert.equal(b.model('ai-video'), 'bytedance/seedance-2.0-fast');
    assert.equal((await b.priceOf('ai-video')).ok, true);
    const sig = new AbortController().signal;
    const st = await b.startJob!('ai-video', { prompt: 'a padlock' }, { purchaseId: 'p', signal: sig });
    assert.deepEqual(st, { ok: true, jobId: 'video_abc123' });
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body));
    assert.deepEqual(body, { model: 'bytedance/seedance-2.0-fast', prompt: 'a padlock', seconds: 4, metadata: { resolution: '480p', ratio: '16:9', generate_audio: false, return_last_frame: false, watermark: false } });
    assert.deepEqual(await b.pollJob!('ai-video', 'video_abc123', { signal: sig }), { state: 'running' });
    status = 'busy';
    assert.equal((await b.pollJob!('ai-video', 'video_abc123', { signal: sig })).state, 'unknown');
    status = 'completed';
    const done = await b.pollJob!('ai-video', 'video_abc123', { signal: sig });
    assert.equal(done.state, 'done');
    if (done.state !== 'done') return;
    assert.deepEqual(done.output, { kind: 'video', mime: 'video/mp4', bytes: FAKE_MP4 });
    assert.equal(done.verified, false);
    assert.equal(done.covers, 'none');
    assert.equal(done.costNeuron, 40_594n * 39_993_815_242_143n);
    status = 'failed';
    assert.equal((await b.pollJob!('ai-video', 'video_abc123', { signal: sig })).state, 'failed');
    // Without a key: no job is started and nothing is faked.
    assert.equal((await routerBackend(null, f).startJob!('ai-video', { prompt: 'x' }, { purchaseId: 'p', signal: sig })).ok, false);
  });
});
