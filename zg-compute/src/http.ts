import {ZgFailure, describe} from "./failure";

/*
 * Calling a provider over HTTP. Every call carries the run's signal, which ends at the run's
 * deadline or when the caller aborts, and every failure becomes a ZgFailure with a stable code.
 * The provider's own words go into `detail` (logs), never into the message a person sees.
 */

export type Fetch = typeof fetch;

/** A signal that fires on the caller's abort or after `ms`, and says which. */
export function runSignal(ms: number, outer?: AbortSignal): {signal: AbortSignal; timedOut: () => boolean; dispose: () => void} {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new Error("deadline"));
  }, ms);
  const onAbort = () => ctl.abort(outer?.reason ?? new Error("aborted"));
  if (outer) {
    if (outer.aborted) onAbort();
    else outer.addEventListener("abort", onAbort, {once: true});
  }
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/** The failure for a signal that has fired. */
export function stopped(run: {timedOut: () => boolean}, what: string): ZgFailure {
  return run.timedOut() ? new ZgFailure("timeout", `${what} passed the deadline`) : new ZgFailure("aborted", `${what} aborted by caller`);
}

/** Classifies a non-2xx provider answer. */
export function httpFailure(status: number, body: string, what: string): ZgFailure {
  const detail = `${what} answered ${status}: ${body.replace(/\s+/g, " ").slice(0, 300)}`;
  if (/insufficient balance|insufficient_quota|not enough funds/i.test(body)) return new ZgFailure("provider_balance", detail);
  if (status === 429) return new ZgFailure("provider_busy", detail);
  if (status === 401 || status === 403) return new ZgFailure("provider_unavailable", detail);
  if (status === 408 || status === 425 || status >= 500) return new ZgFailure("provider_unavailable", detail);
  return new ZgFailure("provider_rejected", detail);
}

/** fetch with the run's signal; network errors and aborts become failures. */
export async function call(f: Fetch, url: string, init: RequestInit, run: {signal: AbortSignal; timedOut: () => boolean}, what: string): Promise<Response> {
  if (run.signal.aborted) throw stopped(run, what);
  try {
    return await f(url, {...init, signal: run.signal});
  } catch (err) {
    if (run.signal.aborted) throw stopped(run, what);
    throw new ZgFailure("provider_unavailable", `${what}: ${describe(err)}`);
  }
}

/** The most a provider's JSON answer may hold (an image as base64 is about 1.1 MB). */
export const MAX_JSON_BYTES = 32 * 1024 * 1024;

class TooLarge extends Error {}

/**
 * A body's bytes, stopping (and cancelling the stream) once it passes `max`, so a provider that
 * streams without end cannot fill the gateway's memory. Throws TooLarge past the cap.
 */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLarge(`${declared} bytes declared, over the ${max} cap`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge(`over the ${max} cap`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Reads a body as text (kept raw, so its hash can be checked against a signature), up to `max` bytes. */
export async function readText(res: Response, what: string, run: {signal: AbortSignal; timedOut: () => boolean}, max = MAX_JSON_BYTES): Promise<string> {
  try {
    return new TextDecoder().decode(await readCapped(res, max));
  } catch (err) {
    if (run.signal.aborted) throw stopped(run, what);
    throw new ZgFailure("output_unreadable", `${what}: body unreadable: ${describe(err)}`);
  }
}

export async function ensureOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await readCapped(res, 64 * 1024)
    .then((b) => new TextDecoder().decode(b))
    .catch(() => "");
  throw httpFailure(res.status, body, what);
}

/** The provider's handle for a response's signature (header first, as 0G's docs say). */
export function resKey(res: Response): string | null {
  const h = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");
  return h && h.trim() ? h.trim() : null;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      {once: true},
    );
  });

/** Response headers worth logging: never the request's Authorization, which this never sees. */
export function headerSummary(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (/^(zg-|content-type|content-length|retry-after|x-)/i.test(k)) out[k] = v.slice(0, 120);
  });
  return out;
}
