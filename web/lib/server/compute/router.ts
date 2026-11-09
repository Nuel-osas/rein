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

import type { BackendPrice, BackendRun, ComputeBackendLike, JobPoll } from './core';
import { SERVICE_TABLE, VIDEO_CLIP, type ComputeService, type ServiceMeta } from './catalog';

export const ROUTER_BASE = 'https://router-api.0g.ai/v1';
const MODELS_TTL_MS = 10 * 60_000;
const RUN_TIMEOUT_MS = 45_000;
const SYSTEM = 'You are a concise assistant answering one request for a team. Answer directly in plain text.';

type Variant = { dimensions?: Record<string, string>; unit?: string; unit_price?: string };
type RouterModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string; variants?: Variant[] };
  pricing_usd?: { prompt?: string; completion?: string; variants?: Variant[] };
};
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

// ------------------------------------------------------------------------------ video ---

/**
 * Billable video tokens Seedance reports for one clip: width x height x frames / 1024, frames = 24
 * per second + 1. The area is the largest 480p frame Seedance 2.0 renders (864 x 496): the adapter's
 * paid probe of a 4 s 480p clip was billed 40,594 tokens, which is 864 x 496 x 97 / 1024 rounded down
 * (zg-compute/PROBE.md; this rounds up to 40,595). The clip's ratio is fixed (16:9) and its audio is off, so nothing larger is
 * asked for; the worst case adds 25% on top in case the vendor counts a few more.
 */
export const VIDEO_MAX_AREA = 864 * 496;
export const VIDEO_SAFETY_BPS = 12_500n;
export function videoTokens(seconds: number = VIDEO_CLIP.seconds): bigint {
  return (BigInt(VIDEO_MAX_AREA) * BigInt(24 * seconds + 1) + 1023n) / 1024n;
}

/** The 480p, text-only (no reference video) per-token price row, in neuron and USD. */
function videoRow(list: Variant[] | undefined): Variant | null {
  return list?.find((v) => v.dimensions?.resolution === VIDEO_CLIP.resolution && v.dimensions?.has_video_input === 'false' && v.unit === 'video_token') ?? null;
}

/** Worst case of one clip in neuron, and the USD per 0G implied by the Router's two price lists. */
export function routerVideoWorstCase(m: RouterModel): BackendPrice {
  const n = neuron(videoRow(m.pricing?.variants)?.unit_price);
  const usd = Number(videoRow(m.pricing_usd?.variants)?.unit_price);
  if (n === null || n <= 0n || !(usd > 0)) return { ok: false, reason: `no ${VIDEO_CLIP.resolution} video price listed for ${m.id}` };
  const tokens = videoTokens();
  const maxCostNeuron = (tokens * n * VIDEO_SAFETY_BPS + 9_999n) / 10_000n;
  const usdPerZg = usd / (Number(n) / 1e18);
  if (!Number.isFinite(usdPerZg) || usdPerZg <= 0) return { ok: false, reason: `bad price for ${m.id}` };
  return { ok: true, maxCostNeuron, usdPerZg, revision: `router;${m.id};video=${VIDEO_CLIP.seconds}s/${VIDEO_CLIP.resolution}/${VIDEO_CLIP.ratio};tokens=${tokens}@${n};x1.25` };
}

const JOB_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const DONE = new Set(['completed', 'succeeded', 'success', 'done']);
const FAILED = new Set(['failed', 'cancelled', 'canceled', 'expired', 'error', 'rejected']);
/** A clip larger than this is not downloaded (the gateway serves at most 4 MB). */
const CLIP_MAX_BYTES = 4 * 1024 * 1024;

async function readCapped(r: Response, max: number): Promise<Uint8Array | null> {
  const len = Number(r.headers.get('content-length') ?? '0');
  if (len > max) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  return buf.length > max ? null : buf;
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
    model: (s) => {
      const id = routerModelOf(SERVICE_TABLE[s]);
      if (!id) throw new Error(`${s} does not run on the 0G Router`);
      return id;
    },
    // The Router balance needs a separate management key; without it the floor check is skipped and
    // an empty balance surfaces as a failed run, which is refunded. The daily budget still applies.
    ledgerOptional: true,
    ledgerNeuron: async () => null,
    priceOf: async (s) => {
      try {
        if (SERVICE_TABLE[s].output === 'video') {
          const id = SERVICE_TABLE[s].model;
          const listed = (await models(fetchFn)).get(id);
          if (!listed) return { ok: false, reason: `${id} is not listed by the 0G Router` };
          return routerVideoWorstCase(listed);
        }
        const m = meta(s);
        const listed = (await models(fetchFn)).get(m.routerModel!);
        if (!listed) return { ok: false, reason: `${m.routerModel} is not listed by the 0G Router` };
        return routerWorstCase(listed, m.maxPromptChars, m.maxOutputTokens ?? 1_024);
      } catch (e) {
        return { ok: false, reason: `could not read 0G Router prices: ${(e as Error).message}`.slice(0, 160) };
      }
    },
    startJob: async (s, input, o) => {
      if (!apiKey) return { ok: false, code: 'not_configured', message: 'no 0G Private Computer key (ZG_ROUTER_API_KEY) on this server' };
      const m = SERVICE_TABLE[s];
      if (m.output !== 'video' || !('prompt' in input)) return { ok: false, code: 'unsupported', message: `${s} is not a video job` };
      const body = {
        model: m.model,
        prompt: input.prompt,
        seconds: VIDEO_CLIP.seconds,
        metadata: { resolution: VIDEO_CLIP.resolution, ratio: VIDEO_CLIP.ratio, generate_audio: false, return_last_frame: false, watermark: false },
      };
      let r: Response;
      try {
        r = await fetchFn(`${ROUTER_BASE}/videos`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-0g-provider-trust-mode': 'standard' },
          body: JSON.stringify(body),
          signal: AbortSignal.any([o.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]),
        });
      } catch (e) {
        return { ok: false, code: 'upstream_unreachable', message: `the 0G Router did not answer: ${(e as Error).name}` };
      }
      const j = (await r.json().catch(() => null)) as { id?: unknown; status?: unknown; error?: { code?: string; message?: string } } | null;
      if (!r.ok || !j || j.error) return { ok: false, code: j?.error?.code ?? `http_${r.status}`, message: (j?.error?.message ?? `HTTP ${r.status}`).slice(0, 200) };
      if (typeof j.id !== 'string' || !JOB_ID_RE.test(j.id)) return { ok: false, code: 'no_job_id', message: 'the 0G Router started no usable video job' };
      return { ok: true, jobId: j.id };
    },
    pollJob: async (s, jobId, o): Promise<JobPoll> => {
      if (!apiKey) return { state: 'unknown', message: 'no 0G Private Computer key on this server' };
      if (!JOB_ID_RE.test(jobId)) return { state: 'failed', code: 'bad_job', message: 'not a video job id' };
      const auth = { authorization: `Bearer ${apiKey}` };
      const signal = AbortSignal.any([o.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]);
      let r: Response;
      try {
        r = await fetchFn(`${ROUTER_BASE}/videos/${encodeURIComponent(jobId)}`, { headers: auth, signal });
      } catch (e) {
        return { state: 'unknown', message: `the 0G Router did not answer: ${(e as Error).name}` };
      }
      // A busy or failing status read says nothing about the clip: ask again later.
      if (r.status === 429 || r.status >= 500) return { state: 'unknown', message: `status read ${r.status}` };
      type VideoJob = {
        status?: unknown;
        error?: { code?: string; message?: string } | string | null;
        usage?: { completion_tokens?: unknown; total_tokens?: unknown };
        x_0g_trace?: { provider?: string; billing?: { total_cost?: string } };
      };
      const j = (await r.json().catch(() => null)) as VideoJob | null;
      if (!j) return { state: 'unknown', message: `status read ${r.status} without JSON` };
      if (r.status === 404) return { state: 'failed', code: 'job_not_found', message: 'the 0G Router no longer knows this video job' };
      if (!r.ok) return { state: 'unknown', message: `status read ${r.status}` };
      const status = typeof j.status === 'string' ? j.status.toLowerCase() : '';
      if (FAILED.has(status)) {
        const why = typeof j.error === 'string' ? j.error : (j.error?.message ?? status);
        return { state: 'failed', code: `job_${status}`, message: String(why).slice(0, 200) };
      }
      if (!DONE.has(status)) return { state: 'running' };
      let c: Response;
      try {
        c = await fetchFn(`${ROUTER_BASE}/videos/${encodeURIComponent(jobId)}/content`, { headers: auth, signal });
      } catch (e) {
        return { state: 'unknown', message: `the clip did not download: ${(e as Error).name}` };
      }
      if (!c.ok) return { state: 'unknown', message: `clip download ${c.status}` };
      const bytes = await readCapped(c, CLIP_MAX_BYTES);
      if (!bytes) return { state: 'failed', code: 'clip_too_large', message: 'the clip is larger than this gateway serves' };
      // What it cost: the Router's own billing when it says, else the vendor's tokens at the listed price.
      const billed = j.x_0g_trace?.billing?.total_cost;
      let costNeuron: bigint | null = billed && /^\d{1,40}$/.test(billed) ? BigInt(billed) : null;
      const tokens = Number(j.usage?.completion_tokens ?? j.usage?.total_tokens);
      if (costNeuron === null && Number.isSafeInteger(tokens) && tokens > 0) {
        const listed = (await models(fetchFn).catch(() => null))?.get(SERVICE_TABLE[s].model);
        const n = neuron(videoRow(listed?.pricing?.variants)?.unit_price);
        costNeuron = n === null ? null : BigInt(tokens) * n;
      }
      return { state: 'done', output: { kind: 'video', mime: 'video/mp4', bytes }, fake: false, verified: false, covers: 'none', provider: j.x_0g_trace?.provider ?? null, costNeuron };
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
