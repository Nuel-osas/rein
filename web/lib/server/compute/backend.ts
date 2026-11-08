// The 0G backends: the real adapter (`@rein/zg-compute`, loaded lazily so tests and fake runs never
// load the 0G SDK) and a labelled fake for dev and tests. The fake never runs in production
// (readComputeEnv forces it off there), and its text says it is fake.

import { sha256Hex, type ComputeBackendLike } from './core';
import { SERVICE_TABLE, type ComputeService } from './catalog';

export const FAKE_PREFIX = '[FAKE 0G UPSTREAM: no model was called; COMPUTE_FAKE_UPSTREAM=1]';

/** Figures from the adapter's live probe (PROBE.md, chat): worst case 0.00583 0G at $0.2536 per 0G. */
export const FAKE_MAX_COST_NEURON = 5_830_000_000_000_000n;
export const FAKE_USD_PER_ZG = 0.2536;

export function fakeText(service: string, model: string, prompt: string): string {
  return `${FAKE_PREFIX} ${service} would have asked ${model} about a ${Buffer.byteLength(prompt)}-byte prompt, sha256 ${sha256Hex(prompt).slice(0, 16)}.`;
}

export function fakeBackend(opts: { ledgerNeuron?: bigint | null; fail?: boolean } = {}): ComputeBackendLike {
  return {
    model: (s) => SERVICE_TABLE[s].model,
    priceOf: async () => ({ ok: true, maxCostNeuron: FAKE_MAX_COST_NEURON, usdPerZg: FAKE_USD_PER_ZG, revision: 'fake;probe-2026-10-15' }),
    ledgerNeuron: async () => (opts.ledgerNeuron === undefined ? 10n ** 19n : opts.ledgerNeuron),
    run: async (s, prompt) =>
      opts.fail
        ? { ok: false, code: 'fake_failure', message: 'the fake upstream was told to fail' }
        : { ok: true, text: fakeText(s, SERVICE_TABLE[s].model, prompt), fake: true, verified: false, covers: 'none', provider: null, costNeuron: null },
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
    const m = await import('@rein/zg-compute');
    const op = m.operationById(SERVICE_TABLE[s].op);
    if (!op || op.model !== SERVICE_TABLE[s].model) throw new Error(`no 0G operation for ${s}`);
    return op;
  };
  return {
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
    run: async (s, prompt, o) => {
      const [zg, op] = await Promise.all([load(), opOf(s)]);
      const r = await zg.run(op, { prompt }, { purchaseId: o.purchaseId, signal: o.signal });
      if (!r.ok) return { ok: false, code: r.code, message: r.message };
      if (r.output.kind !== 'text') return { ok: false, code: 'not_text', message: 'the provider did not answer with text' };
      return { ok: true, text: r.output.text, fake: false, verified: r.proof.verified, covers: r.proof.covers ?? null, provider: r.proof.provider, costNeuron: r.costNeuron };
    },
  };
}
