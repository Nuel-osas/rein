// The 0G backends and which one serves each service:
//   - the wallet route: the real adapter (`@rein/zg-compute`, the 0G Compute SDK with the gateway's
//     funded wallet, loaded lazily so tests and fake runs never load the SDK). Chat, voice and image,
//     each from a TEE provider whose signature the adapter checks.
//   - the Router route (./router.ts): 0G Private Computer with one `sk-` key. Claude and GPT only
//     go there (relayed, no TEE); chat may too when the key is set, in private (TEE-only) mode.
//   - a labelled fake for dev and tests. The fake never runs in production (readComputeEnv forces it
//     off there), and everything it returns says it is fake.

import { sha256Hex, type BackendInput, type BackendMissing, type ComputeBackendLike } from './core';
import { SERVICE_TABLE, type ComputeService } from './catalog';
import { routerBackend } from './router';

export const FAKE_PREFIX = '[FAKE 0G UPSTREAM: no model was called; COMPUTE_FAKE_UPSTREAM=1]';

/** Figures from the adapter's live probe (PROBE.md, chat): worst case 0.00583 0G at $0.2536 per 0G. */
export const FAKE_MAX_COST_NEURON = 5_830_000_000_000_000n;
export const FAKE_USD_PER_ZG = 0.2536;

/** A 1x1 PNG: what the fake returns for an image, so the store and the blob route can be exercised. */
export const FAKE_PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
);

const describeInput = (input: BackendInput) =>
  'prompt' in input
    ? `a ${Buffer.byteLength(input.prompt)}-byte prompt, sha256 ${sha256Hex(input.prompt).slice(0, 16)}`
    : `${input.audio.bytes.length} bytes of ${input.audio.mime} (${input.audio.seconds} s)`;

export function fakeText(service: string, model: string, prompt: string): string {
  return `${FAKE_PREFIX} ${service} would have asked ${model} about ${describeInput({ prompt })}.`;
}

export function fakeBackend(opts: { ledgerNeuron?: bigint | null; fail?: boolean } = {}): ComputeBackendLike {
  return {
    route: 'fake',
    model: (s) => SERVICE_TABLE[s].model,
    priceOf: async () => ({ ok: true, maxCostNeuron: FAKE_MAX_COST_NEURON, usdPerZg: FAKE_USD_PER_ZG, revision: 'fake;probe-2026-10-15' }),
    ledgerNeuron: async () => (opts.ledgerNeuron === undefined ? 10n ** 19n : opts.ledgerNeuron),
    run: async (s, input) => {
      if (opts.fail) return { ok: false, code: 'fake_failure', message: 'the fake upstream was told to fail' };
      const meta = SERVICE_TABLE[s];
      const output =
        meta.output === 'image'
          ? { kind: 'image' as const, mime: 'image/png', bytes: FAKE_PNG }
          : { kind: 'text' as const, text: `${FAKE_PREFIX} ${s} would have asked ${meta.model} about ${describeInput(input)}.` };
      return { ok: true, output, fake: true, verified: false, covers: 'none', provider: null, costNeuron: null };
    },
  };
}

type Zg = Awaited<ReturnType<typeof import('@rein/zg-compute').createZgCompute>>;
const g = globalThis as unknown as { __reinZg?: Promise<Zg> };

/** The adapter on 0G mainnet with the gateway's 0G wallet. One per process (its funding lock is in-process). */
export function zgBackend(privateKey: string, maxLedgerZg: number): ComputeBackendLike {
  const load = () => {
    if (!g.__reinZg) {
      g.__reinZg = import('@rein/zg-compute').then((m) => m.createZgCompute({ privateKey, maxLedgerZg }));
      g.__reinZg.catch(() => (g.__reinZg = undefined));
    }
    return g.__reinZg;
  };
  const opOf = async (s: ComputeService) => {
    const meta = SERVICE_TABLE[s];
    if (meta.route !== 'wallet' || !meta.op) throw new Error(`${s} does not run on the 0G wallet route`);
    const m = await import('@rein/zg-compute');
    const op = m.operationById(meta.op);
    if (!op || op.model !== meta.model) throw new Error(`no 0G operation for ${s}`);
    return op;
  };
  return {
    route: 'wallet',
    model: (s) => SERVICE_TABLE[s].model,
    priceOf: async (s) => {
      const [zg, op] = await Promise.all([load(), opOf(s)]);
      const p = await zg.priceOf(op);
      if (!p.ok) return { ok: false, reason: p.reason };
      if (!('maxCostNeuron' in p)) return { ok: false, reason: 'unexpected price shape' };
      return { ok: true, maxCostNeuron: p.maxCostNeuron, usdPerZg: p.usdPerZg, revision: p.revision };
    },
    ledgerNeuron: async () => {
      const zg = await load();
      return (await zg.status()).ledgerNeuron;
    },
    run: async (s, input, o) => {
      const [zg, op] = await Promise.all([load(), opOf(s)]);
      const runInput =
        'prompt' in input
          ? { prompt: input.prompt }
          : { audio: { base64: Buffer.from(input.audio.bytes).toString('base64'), mimeType: input.audio.mime, seconds: input.audio.seconds } };
      const r = await zg.run(op, runInput, { purchaseId: o.purchaseId, signal: o.signal });
      if (!r.ok) return { ok: false, code: r.code, message: r.message };
      const out = r.output;
      const output =
        out.kind === 'text'
          ? { kind: 'text' as const, text: out.text }
          : out.kind === 'image'
            ? { kind: 'image' as const, mime: out.mimeType, bytes: out.bytes }
            : null;
      if (!output) return { ok: false, code: 'unexpected_output', message: `the provider answered with ${out.kind}` };
      return { ok: true, output, fake: false, verified: r.proof.verified, covers: r.proof.covers ?? null, provider: r.proof.provider, costNeuron: r.costNeuron };
    },
  };
}

export type BackendEnv = { routerKey: string | null; zgKey: string | null; maxLedgerZg: number };

export function backendEnv(env: Record<string, string | undefined> = process.env): BackendEnv {
  const maxLedger = Number(env.ZG_MAX_LEDGER_ZG ?? '10');
  return {
    routerKey: env.ZG_ROUTER_API_KEY?.trim() || null,
    zgKey: env.ZG_PRIVATE_KEY?.trim() || null,
    maxLedgerZg: Number.isFinite(maxLedger) && maxLedger > 0 ? maxLedger : 10,
  };
}

export const ROUTER_KEY_MISSING = 'needs a 0G Private Computer key (ZG_ROUTER_API_KEY), which is not set';
export const WALLET_KEY_MISSING = 'no 0G wallet key (ZG_PRIVATE_KEY) on this server';

export type BackendMakers = {
  router: (apiKey: string | null) => ComputeBackendLike;
  wallet: (privateKey: string, maxLedgerZg: number) => ComputeBackendLike;
};
const REAL: BackendMakers = { router: (k) => routerBackend(k), wallet: zgBackend };

/**
 * The backend for one service. A Router service (Claude, GPT) runs only on the Router: without its
 * key it is not configured, and only its public price can be read (the pricer runs nothing). A
 * wallet service runs on the 0G Compute SDK; chat may use the Router instead when its key is set,
 * always in private (TEE-only) mode. Voice and image stay on the wallet, where their TEE
 * signatures are checked. Never a fallback that changes what is sold.
 */
export function chooseBackend(service: ComputeService, be: BackendEnv, make: BackendMakers = REAL): ComputeBackendLike | BackendMissing {
  const meta = SERVICE_TABLE[service];
  if (meta.route === 'router') {
    if (be.routerKey) return make.router(be.routerKey);
    return { error: ROUTER_KEY_MISSING, notConfigured: true, pricer: make.router(null) };
  }
  if (meta.routerModel && meta.routerTrust === 'private' && be.routerKey) return make.router(be.routerKey);
  if (be.zgKey) return make.wallet(be.zgKey, be.maxLedgerZg);
  return { error: WALLET_KEY_MISSING, notConfigured: true };
}
