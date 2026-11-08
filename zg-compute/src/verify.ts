import {createHash} from "node:crypto";
import {recoverMessageAddress, type Hex} from "viem";
import {ZgFailure, describe} from "./failure";
import {readCapped, sleep, type Fetch} from "./http";
import type {ResolvedProvider} from "./providers";

/*
 * Checking a response's TEE signature, fail closed.
 *
 * `true` is the only result that delivers. `false` is definitive (the signature recovers to some
 * other address: forged or tampered) and is never retried. `null` or a throw means the check could
 * not be completed; the usual cause is timing, because a provider publishes the signature a moment
 * after the response, so only that case is retried, and if it never resolves the result is withheld.
 */

export const VERIFY_ATTEMPTS = 4;
export const VERIFY_BACKOFF_MS = 1_000;

export type Check = () => Promise<boolean | null>;

export interface Verified {
  attempts: number;
}

export async function verifyWithRetries(check: Check, opts: {attempts?: number; backoffMs?: number; signal?: AbortSignal} = {}): Promise<Verified> {
  const attempts = opts.attempts ?? VERIFY_ATTEMPTS;
  const backoff = opts.backoffMs ?? VERIFY_BACKOFF_MS;
  let lastDetail = "signature could not be checked";
  for (let i = 1; i <= attempts; i++) {
    let result: boolean | null = null;
    try {
      result = await check();
    } catch (err) {
      result = null;
      lastDetail = describe(err);
    }
    if (result === true) return {attempts: i};
    if (result === false) throw new ZgFailure("verification_rejected", `signature did not recover to the provider's signer (attempt ${i})`);
    if (i < attempts) {
      if (opts.signal?.aborted) break;
      await sleep(backoff * i, opts.signal);
    }
  }
  throw new ZgFailure("verification_unavailable", `after ${attempts} attempts: ${lastDetail}`);
}

export interface StoredSignature {
  text: string;
  signature: Hex;
}

/** GET {url}/v1/proxy/signature/{chatId}?model={model}, as the SDK's verifier does. Null when absent. */
export async function fetchStoredSignature(f: Fetch, p: Pick<ResolvedProvider, "url" | "model">, chatId: string, signal?: AbortSignal): Promise<StoredSignature | null> {
  const url = `${p.url}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(p.model)}`;
  const res = await f(url, {headers: {"content-type": "application/json"}, signal});
  if (!res.ok) return null;
  const body = JSON.parse(new TextDecoder().decode(await readCapped(res, 1024 * 1024))) as {text?: unknown; signature?: unknown};
  if (typeof body.text !== "string" || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) return null;
  return {text: body.text, signature: body.signature as Hex};
}

/**
 * The SDK's check, for services its processResponse cannot handle (0.9.0 has no extractor for
 * video-generation and throws before checking): EIP-191 over the stored text must recover to the
 * provider's signing address. True, false, or null when no signature is stored yet. A provider with
 * no signing address (a relayed one, which signs nothing) is never checked: null, nothing fetched.
 */
export async function checkStoredSignature(f: Fetch, p: Pick<ResolvedProvider, "url" | "model" | "signingAddress">, chatId: string, signal?: AbortSignal): Promise<{result: boolean | null; signed: StoredSignature | null}> {
  if (p.signingAddress === null) return {result: null, signed: null};
  const signed = await fetchStoredSignature(f, p, chatId, signal);
  if (!signed) return {result: null, signed: null};
  const recovered = await recoverMessageAddress({message: signed.text, signature: signed.signature});
  return {result: recovered.toLowerCase() === p.signingAddress.toLowerCase(), signed};
}

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Whether the provider's stored signed text commits to the request sent and the bytes delivered. */
export interface BindingCheck {
  /** True when the text contains the request's hash; null when there was nothing to compare. */
  request: boolean | null;
  response: boolean | null;
  /** The signed text (hashes, and for a routed provider its type, vendor and TLS fingerprint). */
  text: string | null;
}

export async function checkBinding(
  f: Fetch,
  p: Pick<ResolvedProvider, "url" | "model" | "signingAddress">,
  chatId: string | null,
  want: {request: string | null; response: string | null},
  signal?: AbortSignal,
): Promise<BindingCheck> {
  if (!chatId) return {request: null, response: null, text: null};
  let r: Awaited<ReturnType<typeof checkStoredSignature>>;
  try {
    r = await checkStoredSignature(f, p, chatId, signal);
  } catch {
    return {request: null, response: null, text: null};
  }
  // The text only counts if its signature is the provider's: a forged text proves nothing.
  if (r.result !== true || !r.signed) return {request: null, response: null, text: r.signed?.text ?? null};
  const text = r.signed.text.toLowerCase();
  return {
    request: want.request ? text.includes(want.request) : null,
    response: want.response ? text.includes(want.response) : null,
    text: r.signed.text,
  };
}

/** Whether the signed text commits to these exact bytes (its hash appears in it). */
export const textCommitsTo = (text: string, bytes: Uint8Array | string): boolean => text.toLowerCase().includes(sha256Hex(bytes));
