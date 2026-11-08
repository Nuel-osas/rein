/**
 * The compute gateway as the agent sees it: quote a run, then (after paying on chain) run it and
 * read its result. The agent never imports web code. The web app injects an in-process gateway
 * through `runAgent({ compute })`; the CLI uses `httpGateway(REIN_GATEWAY_URL)`.
 */

export interface GatewayReply {
  status: number;
  body: Record<string, unknown>;
}

export interface ComputeGateway {
  quote(a: { team: string; authority: string; service: string; prompt: string }): Promise<GatewayReply>;
  /** Runs a paid quote once; idempotent (a done run returns its stored result). */
  run(intent: string): Promise<GatewayReply>;
  result(intent: string): Promise<GatewayReply>;
}

type FetchLike = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** A small HTTP client for the gateway's routes (`/api/compute/*`). */
export function httpGateway(baseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 60_000): ComputeGateway {
  const base = baseUrl.replace(/\/+$/, '');
  const call = async (path: string, init: { method: string; body?: unknown }): Promise<GatewayReply> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ac.signal,
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body: body && typeof body === 'object' ? (body as Record<string, unknown>) : {} };
    } catch (e) {
      // No answer: the state is unknown, never "failed", so nobody pays twice.
      return { status: 0, body: { ok: false, status: 'unknown', error: `the gateway did not answer: ${(e as Error).message}` } };
    } finally {
      clearTimeout(t);
    }
  };
  return {
    quote: (a) => call('/api/compute/quote', { method: 'POST', body: a }),
    run: (intent) => call('/api/compute/run', { method: 'POST', body: { intent } }),
    result: (intent) => call(`/api/compute/result/${encodeURIComponent(intent)}`, { method: 'GET' }),
  };
}

export const COMPUTE_INTENT_RE = /^c[A-Za-z0-9_-]{31}$/;
/** How much model output goes back into the agent's context. */
export const OUTPUT_MAX_CHARS = 1_500;

export function trimOutput(text: string, max = OUTPUT_MAX_CHARS): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
