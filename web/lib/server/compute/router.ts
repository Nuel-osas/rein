// The 0G Router backend (0G Private Computer): one OpenAI-compatible endpoint and one `sk-` key,
// funded at pc.0g.ai, instead of driving the 0G Compute SDK with a wallet and a ledger.
//   POST https://router-api.0g.ai/v1/chat/completions, Authorization: Bearer sk-…
// Each service names its Router model and trust mode. "private" (ai-chat) sends
// `X-0G-Provider-Trust-Mode: private`, so only TeeML providers serve it; the Router answers 503
// rather than fall back to an unattested provider. `verify_tee: true` asks the Router to check the
// enclave's signature, and the run reports `verified` only when the Router says `tee_verified`.
// "standard" (ai-claude, ai-gpt) is relayed to the vendor with no TEE: `verified` is always false
// and `covers` is "none", whatever the Router says. Without a key the backend only prices (the
// model list is public) and every run answers not_configured: nothing is ever made up.
// Prices come from the Router's public model list (neuron and USD per token), cached for 10 minutes,
// so a quote is the worst case of one run right now. The key is read by the caller and passed in;
// it is never logged or returned.

import type { BackendPrice, BackendRun, ComputeBackendLike } from './core';
import { SERVICE_TABLE, type ComputeService, type ServiceMeta } from './catalog';

export const ROUTER_BASE = 'https://router-api.0g.ai/v1';
const MODELS_TTL_MS = 10 * 60_000;
const RUN_TIMEOUT_MS = 45_000;
const SYSTEM = 'You are a concise assistant answering one request for a team. Answer directly in plain text.';

type RouterModel = { id: string; pricing?: { prompt?: string; completion?: string }; pricing_usd?: { prompt?: string; completion?: string } };
const g = globalThis as unknown as { __reinRouterModels?: { at: number; byId: Map<string, RouterModel> } };

async function models(fetchFn: typeof fetch): Promise<Map<string, RouterModel>> {
  const c = g.__reinRouterModels;
  if (c && Date.now() - c.at < MODELS_TTL_MS) return c.byId;
  const r = await fetchFn(`${ROUTER_BASE}/models`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`model list ${r.status}`);
  const j = (await r.json()) as { data?: RouterModel[] };
  const byId = new Map((j.data ?? []).map((m) => [m.id, m]));
  g.__reinRouterModels = { at: Date.now(), byId };
  return byId;
}

/** Neuron per token as a bigint, or null when missing or malformed. */
function neuron(v: string | undefined): bigint | null {
  return v && /^\d{1,30}$/.test(v) ? BigInt(v) : null;
}

/** Worst case of one run in neuron, and the USD per 0G implied by the Router's own two price lists. */
export function routerWorstCase(m: RouterModel, maxPromptChars: number, maxOutputTokens: number): BackendPrice {
  const pIn = neuron(m.pricing?.prompt);
  const pOut = neuron(m.pricing?.completion);
  const usdIn = Number(m.pricing_usd?.prompt);
  if (pIn === null || pOut === null || pIn <= 0n || !(usdIn > 0)) return { ok: false, reason: `no price listed for ${m.id}` };
  // Every byte of a prompt can be a token (4 bytes per character at most), plus the system prompt.
  const promptTokens = BigInt(maxPromptChars * 4 + Buffer.byteLength(SYSTEM) + 64);
  const maxCostNeuron = promptTokens * pIn + BigInt(maxOutputTokens) * pOut;
  const usdPerZg = usdIn / (Number(pIn) / 1e18);
  if (!Number.isFinite(usdPerZg) || usdPerZg <= 0) return { ok: false, reason: `bad price for ${m.id}` };
  return { ok: true, maxCostNeuron, usdPerZg, revision: `router;${m.id};${m.pricing?.prompt};${m.pricing?.completion}` };
}

/** The Router model a service runs: its own model for a Router service, else its Router alternative. */
export function routerModelOf(m: ServiceMeta): string | null {
  return m.route === 'router' ? m.model : (m.routerModel ?? null);
}

export function routerBackend(apiKey: string | null, fetchFn: typeof fetch = fetch): ComputeBackendLike {
  const meta = (s: ComputeService) => {
    const m = SERVICE_TABLE[s];
    const model = routerModelOf(m);
    if (!model || m.input !== 'prompt' || m.output !== 'text') throw new Error(`${s} does not run on the 0G Router here`);
    return { ...m, routerModel: model };
  };
  return {
    route: 'router',
    model: (s) => meta(s).routerModel,
    // The Router balance needs a separate management key; without it the floor check is skipped and
    // an empty balance surfaces as a failed run, which is refunded. The daily budget still applies.
    ledgerOptional: true,
    ledgerNeuron: async () => null,
    priceOf: async (s) => {
      try {
        const m = meta(s);
        const listed = (await models(fetchFn)).get(m.routerModel!);
        if (!listed) return { ok: false, reason: `${m.routerModel} is not listed by the 0G Router` };
        return routerWorstCase(listed, m.maxPromptChars, m.maxOutputTokens ?? 1_024);
      } catch (e) {
        return { ok: false, reason: `could not read 0G Router prices: ${(e as Error).message}`.slice(0, 160) };
      }
    },
    run: async (s, input, o): Promise<BackendRun> => {
      if (!apiKey) return { ok: false, code: 'not_configured', message: 'no 0G Private Computer key (ZG_ROUTER_API_KEY) on this server' };
      let m: ReturnType<typeof meta>;
      try {
        m = meta(s);
      } catch (e) {
        return { ok: false, code: 'unsupported', message: (e as Error).message };
      }
      if (!('prompt' in input)) return { ok: false, code: 'unsupported', message: `${s} takes a prompt on the 0G Router` };
      const prompt = input.prompt;
      const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
      if (m.routerTrust) headers['x-0g-provider-trust-mode'] = m.routerTrust;
      const body: Record<string, unknown> = {
        model: m.routerModel,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
        max_tokens: m.maxOutputTokens,
        stream: false,
      };
      if (m.routerTrust === 'private') body.verify_tee = true;
      if (m.lowReasoning === 'template') body.chat_template_kwargs = { reasoning_effort: 'low' };
      if (m.lowReasoning === 'effort') body.reasoning_effort = 'low';
      let r: Response;
      try {
        r = await fetchFn(`${ROUTER_BASE}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.any([o.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]),
        });
      } catch (e) {
        return { ok: false, code: 'upstream_unreachable', message: `the 0G Router did not answer: ${(e as Error).name}` };
      }
      let j: {
        choices?: { message?: { content?: unknown } }[];
        error?: { code?: string; message?: string };
        x_0g_trace?: { provider?: string; tee_verified?: boolean; billing?: { total_cost?: string } };
      };
      try {
        j = await r.json();
      } catch {
        return { ok: false, code: `http_${r.status}`, message: 'the 0G Router answered without JSON' };
      }
      if (!r.ok || j.error) {
        // The provider's words are not passed on beyond a short, bounded message.
        return { ok: false, code: j.error?.code ?? `http_${r.status}`, message: (j.error?.message ?? `HTTP ${r.status}`).slice(0, 200) };
      }
      const text = j.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'empty', message: 'the model returned no text' };
      const cost = j.x_0g_trace?.billing?.total_cost;
      // Only a private (TEE-only) run can be verified; a relayed one is never, whatever the trace says.
      const verified = m.routerTrust === 'private' && j.x_0g_trace?.tee_verified === true;
      return {
        ok: true,
        output: { kind: 'text', text },
        fake: false,
        verified,
        covers: verified ? 'response' : m.routerTrust === 'private' ? null : 'none',
        provider: j.x_0g_trace?.provider ?? null,
        costNeuron: cost && /^\d{1,40}$/.test(cost) ? BigInt(cost) : null,
      };
    },
  };
}
