import {describe, expect, it} from "vitest";
import {createRateSource, RATE_MAX_AGE_MS, rateFromCatalog} from "./rate";
import {catalogAt, fakeFetch, json} from "./test-helpers";

describe("rateFromCatalog", () => {
  it("takes the median of USD over 0G across every priced field", () => {
    const r = rateFromCatalog(catalogAt(0.25));
    expect(r?.usdPerZg).toBeCloseTo(0.25, 9);
    expect(r?.observations).toBe(6);
  });

  it("is not moved by one mispriced model", () => {
    const body = catalogAt(0.25);
    body.data.push({id: "odd", pricing: {prompt: "1000000000000"}, pricing_usd: {prompt: "1"}});
    expect(rateFromCatalog(body)?.usdPerZg).toBeCloseTo(0.25, 9);
  });

  it("ignores zero, missing and non-numeric prices, and needs enough of them", () => {
    expect(rateFromCatalog({data: [{pricing: {prompt: "0"}, pricing_usd: {prompt: "0"}}]})).toBeNull();
    expect(rateFromCatalog(catalogAt(0.25, 3))).toBeNull();
    expect(rateFromCatalog({nope: true})).toBeNull();
    expect(rateFromCatalog({data: [{pricing: {prompt: "1e12"}, pricing_usd: {prompt: "0.1"}}]})).toBeNull();
  });
});

describe("createRateSource", () => {
  it("caches a good rate for at most ten minutes", async () => {
    let t = 0;
    const f = fakeFetch([["router", () => json(catalogAt(0.25))]]);
    const src = createRateSource({fetch: f, now: () => t});
    expect((await src.get()).ok).toBe(true);
    t = RATE_MAX_AGE_MS;
    await src.get();
    expect(f.calls.length).toBe(1);
    t = RATE_MAX_AGE_MS + 1;
    await src.get();
    expect(f.calls.length).toBe(2);
  });

  it("fails closed when the catalog is unreachable, and never serves a stale rate", async () => {
    let t = 0;
    let up = true;
    const f = fakeFetch([["router", () => (up ? json(catalogAt(0.25)) : new Response("down", {status: 503}))]]);
    const src = createRateSource({fetch: f, now: () => t});
    expect((await src.get()).ok).toBe(true);
    up = false;
    t = RATE_MAX_AGE_MS + 1;
    expect(await src.get()).toEqual({ok: false, reason: expect.stringContaining("503")});
  });

  it("refuses a rate outside $0.02 to $20", async () => {
    for (const usd of [0.01, 25]) {
      const src = createRateSource({fetch: fakeFetch([["router", () => json(catalogAt(usd))]])});
      expect(await src.get()).toEqual({ok: false, reason: expect.stringContaining("outside the accepted range")});
    }
  });

  it("fails closed on a body that is not JSON", async () => {
    const src = createRateSource({fetch: fakeFetch([["router", () => new Response("<html>")]])});
    expect((await src.get()).ok).toBe(false);
  });
});
