import {operationById, type Operation} from "./commerce/index";
import {describe, expect, it} from "vitest";
import {billedPrices, CHAT_OVERHEAD_TOKENS, CHAT_TOKENS_PER_CHAR, costFromUsage, unitPrices, videoTokenEstimate, worstCase} from "./pricing";
import {resolveProviders} from "./providers";
import {liveServices, VIDEO_CATALOG} from "./test-helpers";

const op = (id: string) => operationById(id) as Operation;
const provider = (id: string) => resolveProviders(op(id), liveServices()).usable[0]!;

describe("worstCase", () => {
  it("chat: every prompt character at 3 tokens plus overhead, and every output token", () => {
    const p = unitPrices(provider("chat"), null);
    const w = worstCase(op("chat"), p)!;
    const inTokens = 4000n * CHAT_TOKENS_PER_CHAR + CHAT_OVERHEAD_TOKENS;
    expect(w.neuron).toBe(inTokens * 320_000_000_000n + 1024n * 1_920_000_000_000n);
    expect(w.neuron).toBe(5_826_560_000_000_000n); // 0.00582656 0G, as the live dry run quoted
  });

  it("voice: the longest allowed clip plus one second of rounding, per second", () => {
    const w = worstCase(op("voice"), unitPrices(provider("voice"), null))!;
    expect(w.neuron).toBe(61n * 524_770_000_000_000n);
  });

  it("image: one image at the higher of the input and output price", () => {
    const w = worstCase(op("image"), unitPrices(provider("image"), null))!;
    expect(w.neuron).toBe(35_946_970_000_000_000n);
  });

  it("video: estimated tokens for 4 s at 480p, at the dearest known per-token price, times 1.25", () => {
    // the live clip reported 40,594 tokens: 864 x 496 x 97 frames / 1024 = 40,594.5
    expect(videoTokenEstimate()).toBe(40_595n);
    const w = worstCase(op("video"), unitPrices(provider("video"), VIDEO_CATALOG))!;
    expect(w.neuron).toBe((40_595n * 30_380_000_000_000n * 12_500n + 9_999n) / 10_000n);
  });

  it("is null when the provider publishes no price", () => {
    const free = {...provider("chat"), inputPrice: 0n, outputPrice: 0n};
    expect(worstCase(op("chat"), unitPrices(free, null))).toBeNull();
  });
});

describe("unitPrices and billedPrices", () => {
  it("quotes at the higher of on-chain and published prices", () => {
    const p = provider("chat");
    const models = [{id: p.model, pricing: {prompt: "400000000000", completion: "1890000000000"}}];
    const u = unitPrices(p, models);
    expect(u.input).toBe(400_000_000_000n);
    expect(u.output).toBe(1_920_000_000_000n);
  });

  it("reports cost at the published price the provider bills at", () => {
    const p = provider("chat");
    const models = [{id: p.model, pricing: {prompt: "315000000000", completion: "1890000000000"}}];
    const b = billedPrices(p, models);
    // The live chat run: 46 prompt + 34 completion tokens moved the unsettled fee by 78,750 Gneuron.
    expect(costFromUsage(op("chat"), b, {promptTokens: 46, completionTokens: 34})).toBe(78_750_000_000_000n);
  });

  it("quotes prompt and completion at the largest tier multiplier the provider publishes", () => {
    const p = provider("chat");
    const models = [
      {
        id: p.model,
        pricing: {
          prompt: "300000000000",
          completion: "1800000000000",
          tiered_pricing: [
            {max_input_tokens: 32_000, input_multiplier: 1, output_multiplier: 1},
            {max_input_tokens: 1_000_000, input_multiplier: 3, input_multiplier_denominator: 2, output_multiplier: 2},
          ],
        },
      },
    ];
    const u = unitPrices(p, models);
    expect(u.input).toBe((320_000_000_000n * 3n) / 2n);
    expect(u.output).toBe(2n * 1_920_000_000_000n);
    // the same from the on-chain additionalInfo
    const onChain = {...p, additionalInfo: JSON.stringify({tieredPricing: {tiers: [{maxInputTokens: 8000, inputMultiplier: 2, outputMultiplier: 3}]}})};
    expect(unitPrices(onChain, null)).toMatchObject({input: 640_000_000_000n, output: 5_760_000_000_000n});
  });

  it("does not price prompts and completions by a tier it cannot read", () => {
    const p = provider("chat");
    const models = [{id: p.model, pricing: {prompt: "1", tiered_pricing: [{max_input_tokens: 10, input_multiplier: "2", output_multiplier: 1}]}}];
    expect(worstCase(op("chat"), unitPrices(p, models))).toBeNull();
    const huge = {...p, additionalInfo: JSON.stringify({tieredPricing: {tiers: [{maxInputTokens: 1, inputMultiplier: 1e9, outputMultiplier: 1}]}})};
    expect(worstCase(op("chat"), unitPrices(huge, null))).toBeNull();
  });

  it("voice: adds the transcript's tokens if the provider starts charging for output", () => {
    const p = {...provider("voice"), outputPrice: 1_000_000_000n};
    expect(worstCase(op("voice"), unitPrices(p, null))!.neuron).toBe(61n * 524_770_000_000_000n + 896n * 1_000_000_000n);
  });

  it("bills video at the 480p variant and falls back to on-chain without a catalog", () => {
    expect(billedPrices(provider("video"), VIDEO_CATALOG).perVideoToken).toBe(27_590_909_090_909n);
    expect(billedPrices(provider("video"), null).perVideoToken).toBe(30_380_000_000_000n);
  });
});

describe("costFromUsage", () => {
  const prices = {input: 10n, output: 100n, perImage: 1_000n, perVideoToken: 7n};
  it("rounds speech to the nearest second with a 1 second floor, as the provider bills", () => {
    expect(costFromUsage(op("voice"), prices, {audioSeconds: 4.885})).toBe(50n);
    expect(costFromUsage(op("voice"), prices, {audioSeconds: 0.2})).toBe(10n);
  });
  it("is null when the provider reported no usage", () => {
    expect(costFromUsage(op("chat"), prices, {})).toBeNull();
    expect(costFromUsage(op("voice"), prices, {})).toBeNull();
    expect(costFromUsage(op("video"), prices, {})).toBeNull();
  });
  it("counts images and video tokens", () => {
    expect(costFromUsage(op("image"), prices, {images: 1})).toBe(1_000n);
    expect(costFromUsage(op("video"), prices, {videoTokens: 40_000})).toBe(280_000n);
  });
});
