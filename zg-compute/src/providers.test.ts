import {OPERATIONS, operationById, type Operation} from "./commerce/index";
import {describe, expect, it} from "vitest";
import {relayedAllowed, resolveProviders, signingAddressOf, trustOf} from "./providers";
import {closedServices, liveServices, PROVIDERS, service, STANDARD, UNPINNED} from "./test-helpers";

const op = (id: string) => operationById(id) as Operation;

describe("resolveProviders", () => {
  it("finds the one live provider for each operation", () => {
    const list = liveServices();
    for (const o of OPERATIONS) {
      if (o.id === "monad") continue;
      const r = resolveProviders(o, list);
      expect(r.usable.map((p) => p.provider)).toEqual([PROVIDERS[o.id]]);
      expect(r.usable[0]!.endpoint).toMatch(/^https:\/\/.+\/v1\/proxy$/);
    }
  });

  it("uses only TeeML services", () => {
    const list = [service({verifiability: "TeeTLS"}), service({provider: "0x0000000000000000000000000000000000000001", verifiability: ""}), service({provider: "0x0000000000000000000000000000000000000002", verifiability: "teeml"})];
    const r = resolveProviders(op("chat"), list);
    expect(r.usable.map((p) => p.provider)).toEqual(["0x0000000000000000000000000000000000000002"]);
    expect(r.refused.map((x) => x.reason)).toEqual([expect.stringContaining("TeeTLS"), expect.stringContaining("none")]);
  });

  it("uses only services whose TEE signer is acknowledged", () => {
    const r = resolveProviders(op("chat"), [service({teeSignerAcknowledged: false})]);
    expect(r.usable).toEqual([]);
    expect(r.refused[0]!.reason).toMatch(/not acknowledged/);
  });

  it("refuses a zero signer, unreadable additionalInfo and plain http", () => {
    const zero = service({teeSignerAddress: "0x0000000000000000000000000000000000000000"});
    const badInfo = service({additionalInfo: "{not json"});
    const http = service({url: "http://chat.example"});
    for (const s of [zero, badInfo, http]) expect(resolveProviders(op("chat"), [s]).usable).toEqual([]);
  });

  it("matches the model exactly and checks the service type", () => {
    expect(resolveProviders(op("chat"), [service({model: "0gm-1.0-35b-a3b"})]).usable).toEqual([]);
    const wrongType = resolveProviders(op("chat"), [service({serviceType: "text-to-image"})]);
    expect(wrongType.usable).toEqual([]);
    expect(wrongType.refused[0]!.reason).toMatch(/service type/);
  });
});

describe("closed models (commerce CLOSED_MODELS)", () => {
  const standard = (over: Parameters<typeof service>[0] = {}) => service({verifiability: "standard", additionalInfo: STANDARD, ...over});

  it("accepts a provider with no TEE only for a closed model the list names as relayed, and says it is relayed", () => {
    for (const [model, provider] of [["claude-fable-5", PROVIDERS.claude], ["claude-opus-5", PROVIDERS.claudeOpus]] as const) {
      const r = resolveProviders({model, zgServiceType: "chatbot"}, [standard({model, provider})]);
      expect(r.usable).toHaveLength(1);
      expect(r.usable[0]).toMatchObject({trust: "relayed", vendor: "Anthropic", signingAddress: null, format: "anthropic"});
    }
    expect(relayedAllowed({model: "claude-fable-5", provider: PROVIDERS.claude})).toBe(true);
    expect(relayedAllowed({model: "openai/gpt-5.4-mini", provider: PROVIDERS.gpt})).toBe(false);
    expect(relayedAllowed({model: "0GM-1.0-35B-A3B", provider: PROVIDERS.chat})).toBe(false);
  });

  it("relays a model only from the provider the list pins: another standard listing of it is refused", () => {
    expect(relayedAllowed({model: "claude-fable-5", provider: UNPINNED})).toBe(false);
    // Each Claude model has its own pinned provider: one model's provider does not serve the other.
    expect(relayedAllowed({model: "claude-fable-5", provider: PROVIDERS.claudeOpus})).toBe(false);
    const r = resolveProviders({model: "claude-fable-5", zgServiceType: "chatbot"}, [standard({model: "claude-fable-5", provider: UNPINNED}), standard({model: "claude-fable-5", provider: PROVIDERS.claude})]);
    expect(r.usable.map((p) => p.provider)).toEqual([PROVIDERS.claude]);
    expect(r.refused).toEqual([{provider: UNPINNED, reason: expect.stringMatching(/not a provider this gateway relays claude-fable-5 from/)}]);
  });

  it("sends Claude in Anthropic's format and every other model in OpenAI's", () => {
    const list = closedServices();
    expect(resolveProviders(op("claude"), list).usable[0]!.format).toBe("anthropic");
    expect(resolveProviders(op("gpt"), list).usable[0]!.format).toBe("openai");
    expect(resolveProviders(op("chat"), liveServices()).usable[0]!.format).toBe("openai");
  });

  it("refuses a provider with no TEE for every other model: open, closed but unlisted, or listed as routed", () => {
    for (const model of ["0GM-1.0-35B-A3B", "glm-5.3", "claude-opus-5.5", "claude-fable-5.1", "gpt-6.1-sol", "gemini-3-pro", "deepseek-v4", "openai/gpt-5.4-mini"]) {
      const r = resolveProviders({model, zgServiceType: "chatbot"}, [standard({model})]);
      expect(r.usable, model).toEqual([]);
      expect(r.refused[0]!.reason, model).toMatch(/not TeeML/);
    }
  });

  it("admits a provider with no TEE only under the exact listed id: another case or spacing is refused", () => {
    for (const model of ["Claude-Fable-5", "CLAUDE-OPUS-5", "claude-fable-5 ", " claude-opus-5"]) {
      expect(relayedAllowed({model, provider: PROVIDERS.claude}), JSON.stringify(model)).toBe(false);
      const r = resolveProviders({model, zgServiceType: "chatbot"}, [standard({model})]);
      expect(r.usable, JSON.stringify(model)).toEqual([]);
      expect(r.refused[0]!.reason, JSON.stringify(model)).toMatch(/not TeeML/);
    }
    // A TEE listing of a variant gets no closed model's label: its trust is read from 0G's listing.
    const variant = {...closedServices()[1]!, model: "OpenAI/GPT-5.4-mini"};
    expect(trustOf(variant)).toEqual({trust: "model-in-enclave", vendor: null});
  });

  it("still needs a relayed provider to be listed by 0G and served over https", () => {
    expect(resolveProviders({model: "claude-fable-5", zgServiceType: "chatbot"}, [standard({model: "claude-fable-5", provider: PROVIDERS.claude, teeSignerAcknowledged: false})]).refused[0]!.reason).toMatch(/not acknowledged by 0G/);
    expect(resolveProviders({model: "claude-fable-5", zgServiceType: "chatbot"}, [standard({model: "claude-fable-5", provider: PROVIDERS.claude, url: "http://claude.example"})]).usable).toEqual([]);
  });

  it("never labels a TEE provider of a relayed model as relayed: it is refused, so the label stays true", () => {
    const r = resolveProviders({model: "claude-fable-5", zgServiceType: "chatbot"}, [service({model: "claude-fable-5", provider: PROVIDERS.claude})]);
    expect(r.usable).toEqual([]);
    expect(r.refused[0]!.reason).toMatch(/sold as relayed/);
  });

  it("takes a closed model's trust from the list, not from 0G's ProviderType", () => {
    // GPT-5.4 mini's broker is TeeML and not marked centralized, yet it relays to OpenAI.
    const gpt = closedServices()[1]!;
    expect(JSON.parse(gpt.additionalInfo).ProviderType).toBeUndefined();
    const r = resolveProviders(op("gpt"), [gpt]);
    expect(r.usable[0]).toMatchObject({trust: "routed-to-vendor", vendor: "OpenAI", signingAddress: gpt.teeSignerAddress});
    expect(trustOf(gpt)).toEqual({trust: "routed-to-vendor", vendor: "OpenAI"});
  });
});

describe("signingAddressOf and trustOf", () => {
  it("uses the TEE signer for a provider whose model runs in its enclave", () => {
    const s = service();
    expect(signingAddressOf(s)).toBe(s.teeSignerAddress);
    expect(trustOf(s)).toEqual({trust: "model-in-enclave", vendor: null});
  });

  it("uses the separated model TEE when a decentralized provider names one", () => {
    const s = service({additionalInfo: JSON.stringify({TargetSeparated: true, TargetTeeAddress: "0x00000000000000000000000000000000000000aa"})});
    expect(signingAddressOf(s)).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("keeps the broker's signer for a centralized provider and says it is routed", () => {
    const v = liveServices()[3]!;
    expect(signingAddressOf(v)).toBe(v.teeSignerAddress);
    expect(trustOf(v)).toEqual({trust: "routed-to-vendor", vendor: "bytedance"});
  });
});
