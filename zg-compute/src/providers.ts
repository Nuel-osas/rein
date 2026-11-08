import {closedModel, closedProviderAllowed, type ModelTrust, type Operation} from "./commerce/index";
import {zeroAddress, type Address} from "viem";
import type {ZgService} from "./port";

/*
 * Which 0G provider serves an operation, decided from the live service list every time.
 *
 * A provider is usable only when it lists exactly the operation's model and service type, declares
 * TeeML and has its TEE signer acknowledged on chain. Anything else (TeeTLS, none, an unacknowledged
 * signer) can never produce a response `processResponse` accepts, so it would be paid and then
 * discarded; it is refused before any money moves. Addresses are never configured: a provider that
 * moves or stops serving needs no code change.
 *
 * One exception, by name only: a closed model whose entry in commerce's CLOSED_MODELS says
 * "relayed" (models.ts) may be served by a provider 0G lists as "standard" (no TEE). Nothing about
 * such an answer can be checked, so it is labelled "relayed" and delivered unchecked; the provider
 * must be one the entry pins (`providers`), still be listed by 0G (owner-acknowledged) and serve
 * https. Every other model, closed or not,
 * keeps the TeeML rule. A closed model's trust always comes from that list, never from 0G's
 * `ProviderType`: GPT-5.4 mini's broker is TeeML and not marked centralized, yet it relays to OpenAI.
 */

/**
 * How much of an answer can be checked: commerce's ModelTrust.
 * - "model-in-enclave": the model runs inside the provider's enclave, which signs the response.
 * - "routed-to-vendor": the enclave relays to a named vendor's API and signs that route, not the model.
 * - "relayed": no TEE at all; the provider relays to the vendor and nothing is signed.
 */
export type Trust = ModelTrust;

export interface ResolvedProvider {
  provider: Address;
  url: string;
  /** `${url}/v1/proxy`, as the SDK's getServiceMetadata builds it. */
  endpoint: string;
  model: string;
  serviceType: string;
  inputPrice: bigint;
  outputPrice: bigint;
  updatedAt: bigint;
  teeSignerAddress: string;
  /** The address response signatures must recover to (see signingAddressOf); null for a relayed provider, which signs nothing. */
  signingAddress: string | null;
  trust: Trust;
  /** Who does the work when the provider routes or relays (e.g. "bytedance", "Anthropic"); null when the model runs in the enclave. */
  vendor: string | null;
  /** The service's additionalInfo as listed on chain (it can carry tiered pricing). */
  additionalInfo: string;
  /** The request format it takes: "anthropic" for Claude's providers (commerce CLOSED_MODELS), else "openai". */
  format: "openai" | "anthropic";
}

const lc = (s: string) => s.trim().toLowerCase();

interface AdditionalInfo {
  ProviderType?: string;
  TargetSeparated?: boolean;
  TargetTeeAddress?: string;
  ProviderIdentity?: string;
}

function parseInfo(raw: string): AdditionalInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as AdditionalInfo) : null;
  } catch {
    return null;
  }
}

/**
 * The address a response signature must recover to, by the same rule as the SDK's
 * processResponse: the service's TEE signer, except a separated decentralized provider whose model
 * runs in its own TEE, which signs with that TEE's address. Null when additionalInfo is unreadable,
 * which the SDK also treats as unverifiable.
 */
export function signingAddressOf(s: Pick<ZgService, "teeSignerAddress" | "additionalInfo">): string | null {
  const info = parseInfo(s.additionalInfo);
  if (!info) return null;
  const centralized = info.ProviderType === "centralized";
  if (info.TargetSeparated === true && !centralized && info.TargetTeeAddress) return info.TargetTeeAddress;
  return s.teeSignerAddress;
}

/**
 * What a provider's answers prove, and who does the work. A closed model's trust and vendor come
 * from commerce's CLOSED_MODELS, whatever 0G's listing says; any other model's from the listing's
 * ProviderType.
 */
export function trustOf(s: Pick<ZgService, "additionalInfo" | "model">): {trust: Trust; vendor: string | null} {
  const closed = closedModel(s.model);
  if (closed) return {trust: closed.trust, vendor: closed.vendor};
  const info = parseInfo(s.additionalInfo);
  if (info?.ProviderType === "centralized") return {trust: "routed-to-vendor", vendor: info.ProviderIdentity ?? null};
  return {trust: "model-in-enclave", vendor: null};
}

/** Whether 0G lists this service as TeeML. */
const isTeeMl = (s: Pick<ZgService, "verifiability">) => lc(s.verifiability) === "teeml";

/** Whether this model is sold as relayed (its CLOSED_MODELS entry says so), whoever lists it. */
const isRelayedModel = (s: Pick<ZgService, "model">): boolean => closedModel(s.model)?.trust === "relayed";

/**
 * Whether this service may be used WITHOUT a TEE: only for a closed model whose CLOSED_MODELS entry
 * says "relayed", and only from a provider that entry pins. Never for any other model, and never for
 * a closed model the list says is routed through a TEE.
 */
export const relayedAllowed = (s: Pick<ZgService, "model" | "provider">): boolean => {
  const m = closedModel(s.model);
  return m?.trust === "relayed" && closedProviderAllowed(m, s.provider);
};

/** Why a listed service for the right model is not usable, or null when it is. */
export function unusableReason(s: ZgService): string | null {
  if (!isTeeMl(s)) {
    if (!isRelayedModel(s)) return `verifiability is "${s.verifiability || "none"}", not TeeML`;
    if (!relayedAllowed(s)) return `not a provider this gateway relays ${s.model} from`;
    // A relayed closed model has no signer to check, but 0G must still list it, over https.
    if (!s.teeSignerAcknowledged) return "not acknowledged by 0G";
    if (!/^https:\/\//.test(s.url)) return "endpoint is not https";
    return null;
  }
  // A relayed closed model is never served by a TEE provider: its label says nothing is checked,
  // and a TEE that signs would make that label wrong. Refused, so the two can never be mixed up.
  if (isRelayedModel(s)) return `${s.model} is sold as relayed, but this provider is TeeML`;
  if (!s.teeSignerAcknowledged) return "TEE signer not acknowledged";
  if (!s.teeSignerAddress || lc(s.teeSignerAddress) === zeroAddress) return "no TEE signer address";
  if (!signingAddressOf(s)) return "additionalInfo unreadable, so no signing address";
  if (!/^https:\/\//.test(s.url)) return "endpoint is not https";
  return null;
}

export interface Resolution {
  /** Usable providers for the operation, cheapest worst case first is the caller's choice; listed order here. */
  usable: ResolvedProvider[];
  /** Providers listing the model that were refused, and why. */
  refused: {provider: Address; reason: string}[];
}

/** `op` needs only the model and its 0G service type: an operation, or a model the AI API serves. */
export function resolveProviders(op: Pick<Operation, "model" | "zgServiceType">, services: readonly ZgService[]): Resolution {
  const usable: ResolvedProvider[] = [];
  const refused: Resolution["refused"] = [];
  for (const s of services) {
    if (s.model !== op.model) continue;
    if (lc(s.serviceType) !== op.zgServiceType) {
      refused.push({provider: s.provider, reason: `service type "${s.serviceType}", expected "${op.zgServiceType}"`});
      continue;
    }
    const reason = unusableReason(s);
    if (reason) {
      refused.push({provider: s.provider, reason});
      continue;
    }
    const url = s.url.replace(/\/+$/, "");
    const relayed = !isTeeMl(s);
    usable.push({
      provider: s.provider,
      url,
      endpoint: `${url}/v1/proxy`,
      model: s.model,
      serviceType: lc(s.serviceType),
      inputPrice: s.inputPrice,
      outputPrice: s.outputPrice,
      updatedAt: s.updatedAt,
      teeSignerAddress: s.teeSignerAddress,
      signingAddress: relayed ? null : (signingAddressOf(s) as string),
      ...trustOf(s),
      additionalInfo: s.additionalInfo,
      format: closedModel(s.model)?.format ?? "openai",
    });
  }
  return {usable, refused};
}
