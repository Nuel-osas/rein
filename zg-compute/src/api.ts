import {operationById, type Operation} from "./commerce/index";
import type {Address} from "viem";
import {openAiResponseFrom, toAnthropicBody} from "./anthropic";
import {describe, fail, ZgFailure, type FailureCode} from "./failure";
import {headerSummary, httpFailure, readCapped, resKey, type Fetch} from "./http";
import type {ZgEvent} from "./ops";
import type {ZgPort, ZgProviderModel, ZgService} from "./port";
import {unitPrices, type UnitPrices} from "./pricing";
import {resolveProviders, type ResolvedProvider, type Trust} from "./providers";
import type {RateSource} from "./rate";

/*
 * The 0G side of OpenAI-compatible AI keys: what an OpenAI-compatible key can
 * call, and a pass-through chat call.
 *
 * - catalog: every model a usable provider serves directly (TeeML, signer acknowledged, https, the
 *   same rule as every compute run: `resolveProviders`, which also admits the closed models commerce
 *   lists as "relayed", from a provider with no TEE), with the provider's quote-safe unit prices
 *   (the higher of on-chain and published, tiers applied: `unitPrices`) and 0G's dollar rate. Chat
 *   models are the ones 0G's service list names for a `chatbot` service, cheapest provider each;
 *   plus speech to text and text to image, the gateway's own two models. A provider whose
 *   published prices cannot be read is left out: its on-chain price alone can sit below the bill.
 *   Each model says its `trust` and `vendor`. Which of these the gateway sells is the gateway's
 *   decision, not this package's.
 * - chat: funds the provider for the request's worst case (under the same wallet lock and holds as
 *   every compute run, so the two never double-count the locked balance), sends the caller's body
 *   to `{endpoint}/chat/completions`, and hands back the provider's response to read or stream.
 *   Claude's providers take Anthropic's Messages API only: for them the body is translated
 *   (anthropic.ts), sent to `{endpoint}/messages`, and the answer handed back translated to OpenAI's
 *   shape, streamed or not, so the caller reads every model the same way.
 *   The caller verifies (processResponse with the chat id and usage) and calls `finish` when done.
 *   A relayed provider signs nothing: its `verify` answers null ("not checked") without asking the
 *   SDK, whose processResponse would answer false for it, and the caller must not read that as a
 *   failed check (`trust` says which it is).
 *
 * Images and transcriptions are not here: they go through `run` with the image and voice
 * operations, which already fund, run, verify and bind the output.
 */

export type ZgApiKind = "chat" | "transcription" | "image";

export interface ZgApiModel {
  /** The model id as 0G names it, and as a client sends it. */
  id: string;
  kind: ZgApiKind;
  /** The cheapest usable provider serving it now. */
  provider: Address;
  trust: Trust;
  vendor: string | null;
  /**
   * Neuron per unit, quote-safe: chat `input`/`output` per token; transcription `input` per second
   * of audio; image `perImage`.
   */
  prices: UnitPrices;
  /** When the provider last updated its listing (unix seconds). */
  listedAt: bigint;
}

export interface ZgApiCatalog {
  models: ZgApiModel[];
  /** US dollars per 0G from 0G's own price list; null when it could not be read. */
  usdPerZg: number | null;
  /** Why nothing can be priced right now, in a person's words; null when the catalog is usable. */
  reason: string | null;
}

export interface ZgChatRequest {
  model: string;
  /** The provider the request was priced for (from the catalog). Refused if it no longer serves the model. */
  provider: Address;
  /** The OpenAI-shaped body to send; `model` is set to the provider's own id. */
  body: Record<string, unknown>;
  /** The request's worst-case 0G cost, neuron: the provider is funded for this before it is called. */
  worstNeuron: bigint;
  signal: AbortSignal;
}

export type ZgChatCall =
  | {
      ok: true;
      provider: Address;
      /** The provider's answer, 2xx, body unread. */
      response: Response;
      /** The response's signature handle from the `ZG-Res-Key` header; null when it sent none (use the completion id). */
      chatId: string | null;
      /** What the provider that answered can prove ("relayed": nothing, so `verify` always answers null). */
      trust: Trust;
      /** Who did the work when the provider routes or relays (e.g. "Anthropic"); null for a model in the enclave. */
      vendor: string | null;
      /**
       * The SDK's processResponse: true signed by the provider's TEE, false a mismatch, null not
       * checked. Always null for a relayed provider, which signs nothing (never asked of the SDK).
       */
      verify: (chatId: string | null, usage?: string) => Promise<boolean | null>;
      /** Releases the funding hold. Call once the response is read (or abandoned). Idempotent. */
      finish: () => void;
    }
  | {
      ok: false;
      /** The provider's HTTP status when it answered with one; null when it was never reached. */
      status: number | null;
      code: FailureCode;
      retryable: boolean;
      /** A person's words; never the provider's. */
      message: string;
    };

export interface ZgApi {
  catalog(): Promise<ZgApiCatalog>;
  chat(req: ZgChatRequest): Promise<ZgChatCall>;
}

export interface ZgApiDeps {
  port: ZgPort;
  fetch: Fetch;
  emit: (e: ZgEvent) => void;
  /** A provider's published prices (the adapter's, which keeps a last good reading); default the port's. */
  published?: (provider: Address) => Promise<ZgProviderModel[]>;
  /** The service list; `fresh` false may answer from a short cache. */
  services: (fresh: boolean) => Promise<ZgService[]>;
  rates: RateSource;
  /** Funds `p` for `worst` neuron (fast when a recent reading covers it) and returns the hold's release. */
  fund: (p: ResolvedProvider, worst: bigint, signal: AbortSignal) => Promise<() => void>;
}

const lc = (s: string) => s.trim().toLowerCase();

/** Cheapest first: for chat the sum of the two token prices, else the one price the kind is billed at. */
function rank(kind: ZgApiKind, p: UnitPrices): bigint {
  if (kind === "chat") return p.input + p.output;
  if (kind === "transcription") return p.input;
  return p.perImage;
}

function priced(kind: ZgApiKind, p: UnitPrices): boolean {
  if (kind === "chat") return p.input > 0n || p.output > 0n;
  if (kind === "transcription") return p.input > 0n;
  return p.perImage > 0n;
}

export function createZgApi(d: ZgApiDeps): ZgApi {
  async function best(kind: ZgApiKind, target: Pick<Operation, "model" | "zgServiceType">, list: readonly ZgService[], published: (p: Address) => Promise<ZgProviderModel[] | null>): Promise<ZgApiModel | null> {
    let out: ZgApiModel | null = null;
    for (const p of resolveProviders(target, list).usable) {
      const models = await published(p.provider);
      if (models === null) continue;
      const prices = unitPrices(p, models);
      if (!priced(kind, prices)) continue;
      if (!out || rank(kind, prices) < rank(kind, out.prices)) {
        out = {id: p.model, kind, provider: p.provider, trust: p.trust, vendor: p.vendor, prices, listedAt: p.updatedAt};
      }
    }
    return out;
  }

  return {
    async catalog(): Promise<ZgApiCatalog> {
      let list: ZgService[];
      try {
        list = await d.services(false);
      } catch (err) {
        d.emit({type: "api.catalog.fail", detail: describe(err)});
        return {models: [], usdPerZg: null, reason: "We could not read 0G's list of models right now."};
      }
      // Each provider's published prices, read once per catalog and in parallel.
      const reads = new Map<string, Promise<ZgProviderModel[] | null>>();
      const published = (p: Address) => {
        const k = lc(p);
        if (!reads.has(k)) reads.set(k, (d.published ? d.published(p) : d.port.providerModels(p)).catch(() => null));
        return reads.get(k)!;
      };
      const chatModels = [...new Set(list.filter((s) => lc(s.serviceType) === "chatbot" && s.model).map((s) => s.model))].sort();
      const voice = operationById("voice")!;
      const image = operationById("image")!;
      const found = await Promise.all([
        ...chatModels.map((model) => best("chat", {model, zgServiceType: "chatbot"}, list, published)),
        best("transcription", voice, list, published),
        best("image", image, list, published),
      ]);
      const rate = await d.rates.get();
      return {
        models: found.filter((m): m is ZgApiModel => m !== null),
        usdPerZg: rate.ok ? rate.rate.usdPerZg : null,
        reason: rate.ok ? null : "We could not read 0G's price in dollars right now.",
      };
    },

    async chat(req: ZgChatRequest): Promise<ZgChatCall> {
      const refused = (code: FailureCode, detail?: string, status: number | null = null): ZgChatCall => {
        const f = fail(code, detail);
        d.emit({type: "api.fail", what: "chat", model: req.model, code, retryable: f.retryable, status, detail: f.detail ?? null});
        return {ok: false, status, code, retryable: f.retryable, message: f.message};
      };
      let list: ZgService[];
      try {
        list = await d.services(false);
      } catch (err) {
        return refused("provider_unavailable", `service list: ${describe(err)}`);
      }
      const p = resolveProviders({model: req.model, zgServiceType: "chatbot"}, list).usable.find((u) => lc(u.provider) === lc(req.provider)) ?? null;
      if (!p) return refused("no_provider", `${req.model} at ${req.provider} is not usable now`);

      let release: () => void;
      try {
        release = await d.fund(p, req.worstNeuron, req.signal);
      } catch (err) {
        if (err instanceof ZgFailure) return refused(err.failure.code, err.failure.detail);
        return refused("ledger_unreadable", describe(err));
      }
      let auth: Record<string, string>;
      try {
        auth = await d.port.authHeaders(p.provider);
      } catch (err) {
        release();
        return refused("acknowledge_failed", `auth headers: ${describe(err)}`);
      }
      const anthropic = p.format === "anthropic";
      let payload: Record<string, unknown> = {...req.body, model: p.model};
      if (anthropic) {
        const t = toAnthropicBody(req.body, p.model);
        if ("problem" in t) {
          release();
          return refused("provider_rejected", `not sent: ${t.problem}`);
        }
        payload = t.body;
      }
      let res: Response;
      try {
        res = await d.fetch(`${p.endpoint}/${anthropic ? "messages" : "chat/completions"}`, {
          method: "POST",
          headers: {"content-type": "application/json", accept: req.body.stream === true ? "text/event-stream" : "application/json", ...auth},
          body: JSON.stringify(payload),
          signal: req.signal,
        });
      } catch (err) {
        release();
        return refused(req.signal.aborted ? "aborted" : "provider_unavailable", `chat: ${describe(err)}`);
      }
      d.emit({type: "http", what: "api chat", status: res.status, headers: headerSummary(res)});
      if (!res.ok) {
        const body = await readCapped(res, 64 * 1024)
          .then((b) => new TextDecoder().decode(b))
          .catch(() => "");
        release();
        const f = httpFailure(res.status, body, "chat").failure;
        return refused(f.code as FailureCode, f.detail, res.status);
      }
      let response = res;
      if (anthropic) {
        try {
          response = openAiResponseFrom(res, p.model, req.body.stream === true);
        } catch (err) {
          release();
          return refused("output_unreadable", `chat: ${describe(err)}`, res.status);
        }
      }
      let done = false;
      return {
        ok: true,
        provider: p.provider,
        response,
        chatId: resKey(res),
        trust: p.trust,
        vendor: p.vendor,
        // A relayed provider signs nothing; the SDK would answer false for it whatever it sent.
        verify: async (chatId, usage) => (chatId && p.trust !== "relayed" ? d.port.processResponse(p.provider, chatId, usage) : null),
        finish: () => {
          if (done) return;
          done = true;
          release();
        },
      };
    },
  };
}
