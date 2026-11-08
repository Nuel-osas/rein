import {readCapped} from "./http";

/*
 * US dollars per 0G, read from 0G's own public Router catalog.
 *
 * Each model in GET https://router-api.0g.ai/v1/models carries `pricing` (neuron per unit) and
 * `pricing_usd` (dollars per unit) for the same units, so every priced field is one observation of
 * the rate 0G itself converts at. The median across all of them is used: one mispriced model cannot
 * move it. A rate outside [$0.02, $20] is treated as no rate, because a quote at a wrong rate either
 * sells compute far below cost or charges a person many times the price.
 */

export const ROUTER_CATALOG_URL = "https://router-api.0g.ai/v1/models";
export const RATE_MAX_AGE_MS = 10 * 60 * 1000;
export const RATE_BAND = {min: 0.02, max: 20} as const;
/** Fewer observations than this is not a market, it is a guess. */
export const RATE_MIN_OBSERVATIONS = 5;
const FIELDS = ["prompt", "completion", "image", "video"] as const;

export interface Rate {
  usdPerZg: number;
  observations: number;
  /** Unix ms the catalog was read. */
  at: number;
}

export type RateOutcome = {ok: true; rate: Rate} | {ok: false; reason: string};

type Priced = Partial<Record<(typeof FIELDS)[number], unknown>>;

/** The median rate implied by a catalog body, or null when it has too few priced fields. */
export function rateFromCatalog(body: unknown): {usdPerZg: number; observations: number} | null {
  const list = (body as {data?: unknown})?.data;
  if (!Array.isArray(list)) return null;
  const ratios: number[] = [];
  for (const m of list) {
    const pricing = (m as {pricing?: Priced})?.pricing;
    const usd = (m as {pricing_usd?: Priced})?.pricing_usd;
    if (!pricing || !usd) continue;
    for (const f of FIELDS) {
      const neuron = typeof pricing[f] === "string" && /^\d{1,40}$/.test(pricing[f] as string) ? Number(pricing[f]) : NaN;
      const dollars = typeof usd[f] === "string" ? Number(usd[f]) : NaN;
      if (neuron > 0 && dollars > 0 && Number.isFinite(neuron) && Number.isFinite(dollars)) ratios.push(dollars / (neuron / 1e18));
    }
  }
  if (ratios.length < RATE_MIN_OBSERVATIONS) return null;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const usdPerZg = ratios.length % 2 ? (ratios[mid] as number) : ((ratios[mid - 1] as number) + (ratios[mid] as number)) / 2;
  return {usdPerZg, observations: ratios.length};
}

export interface RateSource {
  get(): Promise<RateOutcome>;
}

export function createRateSource(opts: {fetch: typeof fetch; url?: string; now?: () => number; timeoutMs?: number}): RateSource {
  const now = opts.now ?? Date.now;
  const url = opts.url ?? ROUTER_CATALOG_URL;
  let cached: Rate | null = null;
  let inflight: Promise<RateOutcome> | null = null;

  async function read(): Promise<RateOutcome> {
    let body: unknown;
    try {
      const res = await opts.fetch(url, {headers: {accept: "application/json"}, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)});
      if (!res.ok) return {ok: false, reason: `0G's price list answered ${res.status}`};
      body = JSON.parse(new TextDecoder().decode(await readCapped(res, 16 * 1024 * 1024)));
    } catch {
      return {ok: false, reason: "0G's price list could not be read"};
    }
    const r = rateFromCatalog(body);
    if (!r) return {ok: false, reason: "0G's price list had too few prices to read a rate from"};
    if (!(r.usdPerZg >= RATE_BAND.min && r.usdPerZg <= RATE_BAND.max)) {
      return {ok: false, reason: `0G's price list implies $${r.usdPerZg} a 0G, outside the accepted range`};
    }
    return {ok: true, rate: {...r, at: now()}};
  }

  return {
    async get() {
      if (cached && now() - cached.at <= RATE_MAX_AGE_MS) return {ok: true, rate: cached};
      inflight ??= read().finally(() => {
        inflight = null;
      });
      const out = await inflight;
      // A failed read never keeps serving an old rate past its age: fail closed.
      if (out.ok) cached = out.rate;
      return out;
    },
  };
}
