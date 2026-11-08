import type {Operation} from "./commerce/index";
import type {ResolvedProvider} from "./providers";
import type {ZgProviderModel} from "./port";
import {maxBig, mulDivCeil} from "./units";

/*
 * The most one run of an operation can cost, in neuron, from the provider's live unit prices.
 *
 * Each unit price is the higher of the service's on-chain price and the price the provider
 * publishes on its own /v1/models, because the two drift (the published one follows 0G's USD rate)
 * and a quote must never be below what the run is billed; prompt and completion prices are then
 * raised by the largest tier multiplier the provider publishes. Every bound below is a true upper
 * bound for an input that passed `checkInput`, not an average.
 */

/** Settings the gateway uses for one video: the shortest clip at the cheapest resolution. */
export const VIDEO_SECONDS = 4;
export const VIDEO_SIZE = "480p";

/**
 * Billable tokens Seedance reports for one clip: width x height x frames / 1024, where a clip of
 * N seconds at 24 fps has 24N + 1 frames. The area is the largest 480p frame Seedance 2.0 renders
 * (864 x 496). The live probe's 4 s clip reported 40,594 tokens, which is exactly
 * 864 x 496 x 97 / 1024 (PROBE.md); the safety factor below covers the price moving with 0G.
 */
export const VIDEO_480P_MAX_AREA = 864 * 496;
export const VIDEO_FPS = 24;
export const VIDEO_SAFETY_BPS = 12_500n; // 125%

/** Template and role tokens around a one-message chat. */
export const CHAT_OVERHEAD_TOKENS = 64n;
/**
 * Prompt tokens per prompt character (JavaScript string length). A byte-level tokenizer produces
 * at most one token per UTF-8 byte, and one UTF-16 code unit is at most 3 UTF-8 bytes, so 3 is a
 * hard ceiling whatever the text. The cost of being this safe is about 0.003 0G a run.
 */
export const CHAT_TOKENS_PER_CHAR = 3n;
/** The provider bills speech by the second, rounded to the nearest second with a 1 second floor. */
export const VOICE_ROUNDING_SECONDS = 1;
/**
 * Transcript tokens one run can write: Whisper writes at most 448 tokens per 30 s window, and the
 * limit spans two. Priced only if the provider ever charges for output (today its price is 0).
 */
export const VOICE_MAX_OUTPUT_TOKENS = 896n;

export interface UnitPrices {
  /** Chat: neuron per prompt token. Voice: neuron per second of audio. */
  input: bigint;
  /** Chat: neuron per completion token. */
  output: bigint;
  /** Image: neuron per image. */
  perImage: bigint;
  /** Video: neuron per vendor-reported video token, at VIDEO_SIZE. */
  perVideoToken: bigint;
}

const big = (v: string | undefined): bigint => {
  if (!v || !/^\d{1,40}$/.test(v)) return 0n;
  return BigInt(v);
};

/** The price row for `model` from the provider's catalog, or null. */
export function catalogModel(models: readonly ZgProviderModel[] | null, model: string): ZgProviderModel | null {
  return models?.find((m) => m.id === model) ?? null;
}

/** The 480p, text-only variant's price per video token, or 0 when the catalog does not say. */
function videoVariantPrice(m: ZgProviderModel | null): bigint {
  const variants = m?.pricing?.variants ?? [];
  const row = variants.find((v) => v.dimensions?.resolution === VIDEO_SIZE && v.dimensions?.has_video_input !== "true");
  return big(row?.unit_price);
}

/** A multiplier the broker accepts: numerator over an optional denominator (missing or <= 0 means 1). */
function multiplier(n: unknown, d: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? n / d : n;
}

/** The highest tier multiplier allowed before a provider is treated as unpriceable. */
const MAX_TIER_MULTIPLIER = 1_000;

/**
 * The largest prompt and completion multipliers a provider's tiered pricing can apply (never below
 * 1), from its on-chain additionalInfo and its published catalog. Null when either names a tier the
 * adapter cannot read, so the operation is not priced rather than priced low.
 */
export function tierFactors(additionalInfo: string, m: ZgProviderModel | null): {input: number; output: number} | null {
  const tiers: {input: number | null; output: number | null}[] = [];
  try {
    const onChain = (JSON.parse(additionalInfo) as {tieredPricing?: {tiers?: unknown}})?.tieredPricing?.tiers;
    if (onChain !== undefined && !Array.isArray(onChain)) return null;
    for (const t of (onChain ?? []) as Record<string, unknown>[]) {
      tiers.push({input: multiplier(t?.inputMultiplier, t?.inputMultiplierDenominator), output: multiplier(t?.outputMultiplier, t?.outputMultiplierDenominator)});
    }
  } catch {
    // not JSON: resolveProviders has already refused such a service
  }
  const published = m?.pricing?.tiered_pricing;
  if (published !== undefined && !Array.isArray(published)) return null;
  for (const t of published ?? []) tiers.push({input: multiplier(t?.input_multiplier, t?.input_multiplier_denominator), output: multiplier(t?.output_multiplier, t?.output_multiplier_denominator)});
  let input = 1;
  let output = 1;
  for (const t of tiers) {
    if (t.input === null || t.output === null || t.input > MAX_TIER_MULTIPLIER || t.output > MAX_TIER_MULTIPLIER) return null;
    input = Math.max(input, t.input);
    output = Math.max(output, t.output);
  }
  return {input, output};
}

/** `price` x `factor`, rounded up to the neuron. */
const scaled = (price: bigint, factor: number): bigint => (factor === 1 ? price : mulDivCeil(price, BigInt(Math.ceil(factor * 1_000_000)), 1_000_000n));

export function unitPrices(p: ResolvedProvider, models: readonly ZgProviderModel[] | null): UnitPrices {
  const m = catalogModel(models, p.model);
  const pr = m?.pricing;
  // A tier can raise the prompt and completion prices; quote at the highest one. Tiers that cannot
  // be read leave those prices at 0, so the operations priced by them are not quoted.
  const tier = tierFactors(p.additionalInfo, m);
  return {
    input: tier ? scaled(maxBig(p.inputPrice, big(pr?.prompt)), tier.input) : 0n,
    output: tier ? scaled(maxBig(p.outputPrice, big(pr?.completion)), tier.output) : 0n,
    perImage: maxBig(p.inputPrice, p.outputPrice, big(pr?.image)),
    // The on-chain price is the provider's default (the 1080p tier, the dearest but one), so the max
    // is never below the 480p rate even when the catalog is unreachable.
    perVideoToken: maxBig(p.outputPrice, big(pr?.video), videoVariantPrice(m)),
  };
}

/**
 * The prices a run is actually billed at: the provider's published price when it publishes one
 * (seen live: the unsettled fee moved by exactly the published price, not the on-chain one), else
 * the on-chain price. For reporting what a run cost, never for quoting (quotes use unitPrices).
 */
export function billedPrices(p: ResolvedProvider, models: readonly ZgProviderModel[] | null): UnitPrices {
  const m = catalogModel(models, p.model);
  const pr = m?.pricing;
  const or = (published: bigint, onChain: bigint) => (published > 0n ? published : onChain);
  return {
    input: or(big(pr?.prompt), p.inputPrice),
    output: or(big(pr?.completion), p.outputPrice),
    perImage: or(big(pr?.image), maxBig(p.inputPrice, p.outputPrice)),
    perVideoToken: or(videoVariantPrice(m), p.outputPrice),
  };
}

export function videoTokenEstimate(seconds = VIDEO_SECONDS): bigint {
  const frames = BigInt(VIDEO_FPS) * BigInt(seconds) + 1n;
  return (BigInt(VIDEO_480P_MAX_AREA) * frames + 1023n) / 1024n;
}

export interface WorstCase {
  neuron: bigint;
  /** How it was computed, for the revision string. */
  basis: string;
}

/**
 * Null when the provider publishes no usable price for the operation. The closed models (`claude`,
 * `gpt`) are one chat answer each and use the chat formula with their own limits. Their providers
 * also publish prompt-cache prices (cache writes cost more than plain input); a run never asks for a
 * cache (ops.ts sends no `cache_control`), so plain input is what a run is billed.
 */
export function worstCase(op: Operation, prices: UnitPrices): WorstCase | null {
  switch (op.id) {
    case "monad": return null;
    case "chat":
    case "claude":
    case "gpt": {
      const chars = BigInt(op.limits.maxPromptChars ?? 4000);
      const inTokens = chars * CHAT_TOKENS_PER_CHAR + CHAT_OVERHEAD_TOKENS;
      const outTokens = BigInt(op.limits.maxOutputTokens ?? 1024);
      if (prices.input === 0n && prices.output === 0n) return null;
      return {neuron: inTokens * prices.input + outTokens * prices.output, basis: `in=${inTokens}tok@${prices.input};out=${outTokens}tok@${prices.output}`};
    }
    case "voice": {
      const seconds = BigInt((op.limits.maxAudioSeconds ?? 60) + VOICE_ROUNDING_SECONDS);
      if (prices.input === 0n) return null;
      const out = prices.output > 0n ? `;out=${VOICE_MAX_OUTPUT_TOKENS}tok@${prices.output}` : "";
      return {neuron: seconds * prices.input + VOICE_MAX_OUTPUT_TOKENS * prices.output, basis: `audio=${seconds}s@${prices.input}${out}`};
    }
    case "image": {
      if (prices.perImage === 0n) return null;
      return {neuron: prices.perImage, basis: `images=1@${prices.perImage}`};
    }
    case "video": {
      if (prices.perVideoToken === 0n) return null;
      const tokens = videoTokenEstimate();
      return {
        neuron: mulDivCeil(tokens * prices.perVideoToken, VIDEO_SAFETY_BPS, 10_000n),
        basis: `video=${VIDEO_SECONDS}s/${VIDEO_SIZE};tokens=${tokens}@${prices.perVideoToken};x${Number(VIDEO_SAFETY_BPS) / 10_000}`,
      };
    }
  }
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  audioSeconds?: number;
  images?: number;
  videoTokens?: number;
}

/** What a run cost at these prices from the usage the provider reported, or null when it reported none. */
export function costFromUsage(op: Operation, prices: UnitPrices, u: Usage): bigint | null {
  const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? BigInt(Math.ceil(v)) : null);
  switch (op.id) {
    case "monad": return null;
    case "chat":
    case "claude":
    case "gpt": {
      const i = n(u.promptTokens);
      const o = n(u.completionTokens);
      if (i === null && o === null) return null;
      return (i ?? 0n) * prices.input + (o ?? 0n) * prices.output;
    }
    case "voice": {
      if (typeof u.audioSeconds !== "number" || !(u.audioSeconds > 0)) return null;
      return BigInt(Math.max(Math.round(u.audioSeconds), 1)) * prices.input;
    }
    case "image": {
      const k = n(u.images);
      return k === null ? null : k * prices.perImage;
    }
    case "video": {
      const t = n(u.videoTokens);
      return t === null ? null : t * prices.perVideoToken;
    }
  }
}
