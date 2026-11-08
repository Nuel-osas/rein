import {operationById, type Operation} from "./commerce/index";
import {describe, expect, it} from "vitest";
import {createZgComputeWith} from "./backend";
import {catalogAt, fakeFetch, fakePort, json, liveCatalogs, liveServices, PROVIDERS, service, ZG} from "./test-helpers";

/*
 * The AI keys pass-through (api.ts): what the catalog lists, and how a chat call is funded, sent
 * and handed back. Funding shares the backend's wallet lock and holds.
 */

const OTHER_CHAT = "0x0000000000000000000000000000000000000c77" as const;

const routes = {
  router: ["router-api.0g.ai", () => json(catalogAt(0.25))] as [string, () => Response],
  unsettled: ["/unsettledfee", () => json({userAddress: "x", unsettledFee: "0"})] as [string, () => Response],
};

/** Claude's providers answer Anthropic's Messages API (anthropic.ts). */
const anthropicAnswer = {id: "msg-1", type: "message", role: "assistant", model: "claude-fable-5", content: [{type: "text", text: "hi"}], stop_reason: "end_turn", usage: {input_tokens: 3, output_tokens: 1}};

async function setup(
  over: {
    now?: () => number;
    services?: ReturnType<typeof liveServices>;
    catalogs?: Map<string, unknown>;
    chat?: (url: string, init: RequestInit) => Response | Promise<Response>;
    messages?: (url: string, init: RequestInit) => Response | Promise<Response>;
  } = {},
) {
  const catalogs = (over.catalogs as Map<string, never>) ?? liveCatalogs();
  const port = fakePort({services: over.services ?? liveServices(), catalogs});
  let ledgerReads = 0;
  const getSub = port.getSubAccount;
  port.getSubAccount = async (p) => {
    ledgerReads += 1;
    return getSub(p);
  };
  const f = fakeFetch([
    ["/chat/completions", over.chat ?? (() => json({id: "cmpl-1", choices: [{message: {content: "hi"}}], usage: {prompt_tokens: 3, completion_tokens: 1}}, {headers: {"ZG-Res-Key": "res-1"}}))],
    ["/v1/proxy/messages", over.messages ?? (() => json(anthropicAnswer))],
    routes.router,
    routes.unsettled,
  ]);
  const compute = await createZgComputeWith(port, {fetch: f, pollMs: 0, ...(over.now ? {now: over.now} : {})});
  return {port, f, compute, reads: () => ledgerReads};
}

const signal = () => new AbortController().signal;

describe("api catalog", () => {
  it("keeps a model whose provider's prices could not be read this time, for ten minutes from its last good reading", async () => {
    let t = 1_000_000;
    const catalogs = liveCatalogs();
    const {compute} = await setup({catalogs, now: () => t});
    const first = await compute.api.catalog();
    expect(first.models.map((m) => m.id)).toContain("claude-fable-5");
    // One slow read: the provider does not answer, and the model stays listed at its last prices.
    const fable = catalogs.get(PROVIDERS.claude.toLowerCase())!;
    catalogs.delete(PROVIDERS.claude.toLowerCase());
    t += 60_000;
    const second = await compute.api.catalog();
    expect(second.models.find((m) => m.id === "claude-fable-5")?.prices).toEqual(first.models.find((m) => m.id === "claude-fable-5")?.prices);
    // Past ten minutes with no good read, it is dropped rather than priced from old numbers.
    t += 600_000;
    expect((await compute.api.catalog()).models.map((m) => m.id)).not.toContain("claude-fable-5");
    // A provider never read at all is never listed from nothing.
    catalogs.set(PROVIDERS.claude.toLowerCase(), fable);
    expect((await compute.api.catalog()).models.map((m) => m.id)).toContain("claude-fable-5");
  });

  it("lists each chat model 0G's service list names, plus speech to text and images, priced from the cheapest usable provider", async () => {
    const services = [
      ...liveServices(),
      service({provider: OTHER_CHAT, model: "glm-5.3", url: "https://glm.example", inputPrice: 7_000_000_000_000n, outputPrice: 22_000_000_000_000n}),
      // The same model, dearer: never chosen.
      service({provider: "0x0000000000000000000000000000000000000c78", model: "glm-5.3", url: "https://glm2.example", inputPrice: 10_000_000_000_000n, outputPrice: 33_000_000_000_000n}),
      // Not TeeML: never listed.
      service({provider: "0x0000000000000000000000000000000000000c79", model: "closed-model", verifiability: "standard"}),
    ];
    const catalogs = liveCatalogs();
    catalogs.set(OTHER_CHAT.toLowerCase(), [{id: "glm-5.3", pricing: {prompt: "6980000000000", completion: "21940000000000"}}]);
    catalogs.set("0x0000000000000000000000000000000000000c78", [{id: "glm-5.3", pricing: {prompt: "10340000000000", completion: "32510000000000"}}]);
    const {compute} = await setup({services, catalogs});
    const c = await compute.api.catalog();
    expect(c.usdPerZg).toBeCloseTo(0.25, 6);
    expect(c.reason).toBeNull();
    // Every model says what it can prove; the closed models' trust and vendor come from commerce's list.
    expect(c.models.map((m) => [m.id, m.kind, m.provider, m.trust, m.vendor])).toEqual([
      ["0GM-1.0-35B-A3B", "chat", PROVIDERS.chat, "model-in-enclave", null],
      ["claude-fable-5", "chat", PROVIDERS.claude, "relayed", "Anthropic"],
      ["claude-opus-5", "chat", PROVIDERS.claudeOpus, "relayed", "Anthropic"],
      ["glm-5.3", "chat", OTHER_CHAT, "model-in-enclave", null],
      ["openai/gpt-5.4-mini", "chat", PROVIDERS.gpt, "routed-to-vendor", "OpenAI"],
      ["openai/whisper-large-v3", "transcription", PROVIDERS.voice, "model-in-enclave", null],
      ["z-image-turbo", "image", PROVIDERS.image, "model-in-enclave", null],
    ]);
    // Quote-safe: the higher of the on-chain and published prices.
    const chat = c.models[0]!;
    expect(chat.prices.input).toBe(320_000_000_000n);
    expect(chat.prices.output).toBe(1_920_000_000_000n);
    expect(c.models.find((m) => m.id === "glm-5.3")!.prices).toMatchObject({input: 7_000_000_000_000n, output: 22_000_000_000_000n});
    expect(c.models.find((m) => m.id === "claude-fable-5")!.prices).toMatchObject({input: 100_110_000_000_000n, output: 375_420_000_000_000n});
    expect(c.models.find((m) => m.kind === "transcription")!.prices.input).toBe(524_770_000_000_000n);
    expect(c.models.find((m) => m.kind === "image")!.prices.perImage).toBe(35_946_970_000_000_000n);
  });

  it("never lists a provider without a TEE for a model the closed list does not name as relayed", async () => {
    const services = [
      service({provider: PROVIDERS.chat}),
      // Closed, but not on the list (0G Router only): refused like any other provider without a TEE.
      service({provider: "0x0000000000000000000000000000000000000c80", model: "claude-opus-5.5", url: "https://opus55.example", verifiability: "standard"}),
      service({provider: "0x0000000000000000000000000000000000000c81", model: "gpt-6.1-sol", url: "https://gpt61.example", verifiability: "standard"}),
      // On the list as routed through a TEE: a provider without one is refused.
      service({provider: "0x0000000000000000000000000000000000000c82", model: "openai/gpt-5.4-mini", url: "https://gpt-standard.example", verifiability: "standard"}),
      // An open model served without a TEE.
      service({provider: "0x0000000000000000000000000000000000000c83", model: "glm-5.3", url: "https://glm-standard.example", verifiability: "standard"}),
    ];
    const catalogs = liveCatalogs();
    for (const p of ["c80", "c81", "c82", "c83"]) catalogs.set(`0x0000000000000000000000000000000000000${p}`, [{id: "x", pricing: {prompt: "1", completion: "1"}}]);
    const {compute} = await setup({services, catalogs});
    const c = await compute.api.catalog();
    expect(c.models.filter((m) => m.kind === "chat").map((m) => m.id)).toEqual(["0GM-1.0-35B-A3B"]);
  });

  it("leaves out a model whose provider's published prices cannot be read", async () => {
    const catalogs = liveCatalogs();
    catalogs.delete(PROVIDERS.chat.toLowerCase());
    catalogs.delete(PROVIDERS.claude.toLowerCase());
    const {compute} = await setup({catalogs});
    const c = await compute.api.catalog();
    expect(c.models.map((m) => m.id)).toEqual(["claude-opus-5", "openai/gpt-5.4-mini", "openai/whisper-large-v3", "z-image-turbo"]);
  });

  it("says why when 0G's dollar rate cannot be read", async () => {
    const port = fakePort({catalogs: liveCatalogs()});
    const f = fakeFetch([["router-api.0g.ai", () => new Response("down", {status: 503})]]);
    const compute = await createZgComputeWith(port, {fetch: f});
    const c = await compute.api.catalog();
    expect(c.usdPerZg).toBeNull();
    expect(c.reason).toMatch(/price in dollars/);
  });
});

describe("api chat", () => {
  const body = {messages: [{role: "user", content: "hi"}], max_tokens: 16, stream: false};

  it("funds the provider, sends the body with the provider's model id, and hands back the response", async () => {
    const {port, f, compute} = await setup();
    const call = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 10n ** 15n, signal: signal()});
    expect(call.ok).toBe(true);
    if (!call.ok) return;
    expect(call.chatId).toBe("res-1");
    expect(await call.response.json()).toMatchObject({id: "cmpl-1"});
    const sent = f.calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(sent.url).toBe("https://chat.example/v1/proxy/chat/completions");
    expect(JSON.parse(String(sent.init.body))).toEqual({...body, model: "0GM-1.0-35B-A3B"});
    expect((sent.init.headers as Record<string, string>).Authorization).toBe("Bearer test");
    expect(port.state.writes[0]).toBe("addLedger 3");
    call.finish();
    call.finish(); // idempotent
  });

  it("asks the provider's TEE about the response with its chat id and usage", async () => {
    const {port, compute} = await setup();
    const seen: string[] = [];
    port.state.verify = async (_p, chatId) => {
      seen.push(chatId);
      return true;
    };
    const call = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 10n ** 15n, signal: signal()});
    if (!call.ok) throw new Error("expected a call");
    expect(await call.verify("res-1", JSON.stringify({prompt_tokens: 3}))).toBe(true);
    expect(await call.verify(null)).toBeNull();
    expect(seen).toEqual(["res-1"]);
    call.finish();
  });

  it("says a TEE provider's call is checked through the SDK, with its trust", async () => {
    const {compute} = await setup();
    const call = await compute.api.chat({model: "openai/gpt-5.4-mini", provider: PROVIDERS.gpt, body, worstNeuron: 10n ** 15n, signal: signal()});
    if (!call.ok) throw new Error("expected a call");
    expect({trust: call.trust, vendor: call.vendor}).toEqual({trust: "routed-to-vendor", vendor: "OpenAI"});
    expect(await call.verify("res-1")).toBe(true);
    call.finish();
  });

  it("a relayed provider's call is funded and sent like any other, and never asks the SDK to check it", async () => {
    const {port, f, compute} = await setup();
    let asked = 0;
    // The SDK's processResponse answers false for a service that is not verifiable, whatever it sent.
    port.state.verify = async () => {
      asked += 1;
      return false;
    };
    const call = await compute.api.chat({model: "claude-fable-5", provider: PROVIDERS.claude, body, worstNeuron: 10n ** 15n, signal: signal()});
    if (!call.ok) throw new Error("expected a call");
    expect({trust: call.trust, vendor: call.vendor}).toEqual({trust: "relayed", vendor: "Anthropic"});
    // Claude's provider takes Anthropic's Messages API only: sent there, in that shape.
    const sent = f.calls.find((c) => c.url.endsWith("/messages"))!;
    expect(sent.url).toBe("https://claude.example/v1/proxy/messages");
    expect(JSON.parse(String(sent.init.body))).toEqual({model: "claude-fable-5", max_tokens: 16, messages: [{role: "user", content: [{type: "text", text: "hi"}]}]});
    expect(f.calls.some((c) => c.url.endsWith("/chat/completions"))).toBe(false);
    expect(port.state.writes).toContain(`transferFund ${PROVIDERS.claude} ${ZG + 10n ** 15n + ZG / 20n}`);
    // The same acknowledgement as a TEE provider: the SDK's auth header needs it for any provider.
    expect(port.state.writes).toContain(`acknowledge ${PROVIDERS.claude}`);
    expect(await call.verify("res-1", JSON.stringify({prompt_tokens: 3}))).toBeNull();
    expect(asked).toBe(0);
    // Read back in OpenAI's shape, like every other model.
    expect(await call.response.json()).toMatchObject({object: "chat.completion", choices: [{message: {role: "assistant", content: "hi"}, finish_reason: "stop"}], usage: {prompt_tokens: 3, completion_tokens: 1}});
    call.finish();
  });

  it("streams Claude's answer as OpenAI chunks ending with a usage chunk", async () => {
    const events = [
      {type: "message_start", message: {id: "msg-2", usage: {input_tokens: 5, output_tokens: 1}}},
      {type: "content_block_start", index: 0, content_block: {type: "text", text: ""}},
      {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "Hello"}},
      {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: " there"}},
      {type: "content_block_stop", index: 0},
      {type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 2}},
      {type: "message_stop"},
    ];
    const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const {compute} = await setup({messages: () => new Response(sse, {status: 200, headers: {"content-type": "text/event-stream"}})});
    const call = await compute.api.chat({model: "claude-fable-5", provider: PROVIDERS.claude, body: {...body, stream: true}, worstNeuron: 10n ** 15n, signal: signal()});
    if (!call.ok) throw new Error("expected a call");
    const text = await call.response.text();
    const datas = text.split("\n\n").filter(Boolean).map((e) => e.slice("data: ".length));
    expect(datas[datas.length - 1]).toBe("[DONE]");
    const chunks = datas.slice(0, -1).map((d) => JSON.parse(d));
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe("Hello there");
    expect(chunks.at(-2).choices[0].finish_reason).toBe("stop");
    expect(chunks.at(-1)).toMatchObject({choices: [], usage: {prompt_tokens: 5, completion_tokens: 2}});
    call.finish();
  });

  it("refuses, before sending, a request Claude cannot take as asked", async () => {
    const {f, compute} = await setup();
    const call = await compute.api.chat({model: "claude-fable-5", provider: PROVIDERS.claude, body: {...body, response_format: {type: "json_object"}}, worstNeuron: 10n ** 15n, signal: signal()});
    expect(call).toMatchObject({ok: false, code: "provider_rejected"});
    expect(f.calls.some((c) => c.url.endsWith("/messages"))).toBe(false);
  });

  it("does not re-read the balances while a recent reading still covers the request (the fast path)", async () => {
    const {port, compute, reads} = await setup();
    // A provider already holding more than the minimum (a top-up moves at least the contract's
    // minimum transfer, 1 0G on mainnet, so this is the usual state after the first few runs).
    port.state.ledger = {availableBalance: ZG, totalBalance: 4n * ZG};
    port.state.subs.set(PROVIDERS.chat.toLowerCase(), {balance: 3n * ZG, pendingRefund: 0n, acknowledged: true});
    const warm = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 10n ** 15n, signal: signal()});
    if (!warm.ok) throw new Error("expected a call");
    warm.finish();
    const afterFirst = reads();
    expect(afterFirst).toBe(1);
    port.state.writes.length = 0;
    for (let i = 0; i < 5; i++) {
      const c = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 10n ** 15n, signal: signal()});
      if (!c.ok) throw new Error("expected a call");
      c.finish();
    }
    expect(reads()).toBe(afterFirst);
    expect(port.state.writes).toEqual([]);
  });

  it("reads afresh once runs ended since the reading could have used up what was locked", async () => {
    const {compute, reads} = await setup();
    const first = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 10n ** 15n, signal: signal()});
    if (!first.ok) throw new Error("expected a call");
    first.finish();
    const before = reads();
    // A worst case near the whole headroom: once it ended, the next one cannot be covered from the reading.
    const big = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: ZG / 2n, signal: signal()});
    if (!big.ok) throw new Error("expected a call");
    big.finish();
    const again = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: ZG / 2n, signal: signal()});
    if (!again.ok) throw new Error("expected a call");
    again.finish();
    expect(reads()).toBeGreaterThan(before);
  });

  it("refuses before funding when the provider no longer serves the model", async () => {
    const {port, f, compute} = await setup();
    const call = await compute.api.chat({model: "glm-5.3", provider: PROVIDERS.chat, body, worstNeuron: 1n, signal: signal()});
    expect(call).toMatchObject({ok: false, code: "no_provider", retryable: false, status: null});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("turns a provider's refusal into a code and a person's words, never the provider's text", async () => {
    const {compute} = await setup({chat: () => new Response(JSON.stringify({error: "max_tokens too large: secret detail"}), {status: 400})});
    const call = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 1n, signal: signal()});
    expect(call).toMatchObject({ok: false, status: 400, code: "provider_rejected", retryable: false});
    if (!call.ok) expect(call.message).not.toContain("secret");
  });

  it("an aborted request is reported as aborted, and its hold released", async () => {
    const ctl = new AbortController();
    const {compute} = await setup({
      chat: (_u, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {name: "AbortError"})));
          ctl.abort();
        }),
    });
    const call = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 1n, signal: ctl.signal});
    expect(call).toMatchObject({ok: false, code: "aborted"});
  });

  it("compute runs still read afresh every time, whatever the API's reading", async () => {
    const {compute, reads} = await setup();
    const first = await compute.api.chat({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat, body, worstNeuron: 10n ** 15n, signal: signal()});
    if (!first.ok) throw new Error("expected a call");
    first.finish();
    const before = reads();
    // The chat operation's signature check needs a signed provider; only the funding read matters here.
    await compute.run(operationById("chat") as Operation, {prompt: "hi"}, {purchaseId: "q1"});
    expect(reads()).toBeGreaterThan(before);
  });
});
