import {closedModel} from "./commerce/index";
import {getAddress, keccak256, toHex, type Address} from "viem";
import type {ZgLedger, ZgPort, ZgProviderModel, ZgService, ZgSubAccount} from "./port";
import {NEURON_PER_ZG} from "./units";

/* Fakes for the unit tests. Not exported from the package. */

export const ZG = NEURON_PER_ZG;

/**
 * A fake provider address from a label. No literal: the repository's address gate scans this file
 * (it is not a *.test.ts), and a fake is not a party to document in CONSTANTS.md.
 */
const fakeProvider = (label: string): Address => getAddress(keccak256(toHex(`zg-compute-test:${label}`)).slice(0, 42));

/** The provider commerce's CLOSED_MODELS pins for a relayed model (read from the list, not repeated here). */
const pinned = (model: string): Address => getAddress(closedModel(model)!.providers![0]!);

/** A provider no closed model pins, for the tests that it is refused. */
export const UNPINNED = fakeProvider("unpinned-relay");

export const PROVIDERS = {
  chat: "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9" as Address,
  voice: "0x36aCffCEa3CCe07cAdd1740Ad992dB16Ab324517" as Address,
  image: "0xE29a72c7629815Eb480aE5b1F2dfA06f06cdF974" as Address,
  video: "0xE1C4A978C51B81c0E2BD2515AFEF5F63C4378309" as Address,
  /** claude-fable-5's "standard" provider (no TEE, relaying to Anthropic): the one CLOSED_MODELS pins. */
  claude: pinned("claude-fable-5"),
  /** Stands for openai/gpt-5.4-mini's TeeML dstack broker relaying to OpenAI. */
  gpt: fakeProvider("gpt-5.4-mini"),
  /** claude-opus-5's provider, pinned like claude-fable-5's; no operation, sold through AI keys only. */
  claudeOpus: pinned("claude-opus-5"),
};

const DECENTRAL = JSON.stringify({TEEVerifier: "dstack", TargetSeparated: false, TargetTeeAddress: ""});
const CENTRAL = JSON.stringify({ProviderType: "centralized", ProviderIdentity: "bytedance", TargetSeparated: true, TargetTeeAddress: "", MultiModel: true});
/** A "standard" provider's additionalInfo as the Claude providers list it (no TEE, prompt-cache pricing). */
export const STANDARD = JSON.stringify({
  ImageDigest: "",
  ImageName: "",
  MultiModel: true,
  ProviderType: "standard",
  TEEVerifier: "",
  TargetSeparated: true,
  TargetTeeAddress: "",
  VerifierURL: "",
  cacheTokenBilling: {divisor: 10, write1hMultiplierDenominator: 1, write1hMultiplierNumerator: 2, writeMultiplierDenominator: 4, writeMultiplierNumerator: 5},
  priceDenomination: "USD",
});

export function service(over: Partial<ZgService> = {}): ZgService {
  return {
    provider: PROVIDERS.chat,
    serviceType: "chatbot",
    url: "https://chat.example",
    model: "0GM-1.0-35B-A3B",
    inputPrice: 320_000_000_000n,
    outputPrice: 1_920_000_000_000n,
    updatedAt: 1n,
    verifiability: "TeeML",
    additionalInfo: DECENTRAL,
    teeSignerAddress: "0x00000000000000000000000000000000000000c1",
    teeSignerAcknowledged: true,
    ...over,
  };
}

/** The four live services as observed on 15 October, then the three closed models' as on 30 October (prices in neuron). */
export function liveServices(signers: Partial<Record<keyof typeof PROVIDERS, string>> = {}): ZgService[] {
  return [
    service({teeSignerAddress: signers.chat ?? "0x00000000000000000000000000000000000000c1"}),
    service({provider: PROVIDERS.voice, serviceType: "speech-to-text", url: "https://voice.example", model: "openai/whisper-large-v3", inputPrice: 524_770_000_000_000n, outputPrice: 0n, teeSignerAddress: signers.voice ?? "0x00000000000000000000000000000000000000c2"}),
    service({provider: PROVIDERS.image, serviceType: "text-to-image", url: "https://image.example", model: "z-image-turbo", inputPrice: 0n, outputPrice: 35_946_970_000_000_000n, teeSignerAddress: signers.image ?? "0x00000000000000000000000000000000000000c2"}),
    service({provider: PROVIDERS.video, serviceType: "video-generation", url: "https://video.example", model: "dreamina-seedance-2-0-260128", inputPrice: 0n, outputPrice: 30_380_000_000_000n, additionalInfo: CENTRAL, teeSignerAddress: signers.video ?? "0x00000000000000000000000000000000000000c3"}),
    ...closedServices(signers),
  ];
}

/** The three closed models' direct providers as listed on 30 October (docs/hackathon/CLOSED-MODELS-PLAN.md). */
export function closedServices(signers: Partial<Record<keyof typeof PROVIDERS, string>> = {}): ZgService[] {
  return [
    service({provider: PROVIDERS.claude, url: "https://claude.example", model: "claude-fable-5", inputPrice: 100_110_000_000_000n, outputPrice: 375_420_000_000_000n, verifiability: "standard", additionalInfo: STANDARD, teeSignerAddress: "0x00000000000000000000000000000000000000c1"}),
    service({
      provider: PROVIDERS.gpt,
      url: "https://gpt.example",
      model: "openai/gpt-5.4-mini",
      inputPrice: 1_600_000_000_000n,
      outputPrice: 9_000_000_000_000n,
      additionalInfo: DECENTRAL,
      teeSignerAddress: signers.gpt ?? "0x00000000000000000000000000000000000000c2",
    }),
    service({provider: PROVIDERS.claudeOpus, url: "https://opus.example", model: "claude-opus-5", inputPrice: 49_200_000_000_000n, outputPrice: 221_440_000_000_000n, verifiability: "standard", additionalInfo: STANDARD, teeSignerAddress: "0x00000000000000000000000000000000000000c3"}),
  ];
}

export const VIDEO_CATALOG: ZgProviderModel[] = [
  {
    id: "dreamina-seedance-2-0-260128",
    pricing: {
      video: "30350000000000",
      video_unit: "video_token",
      variants: [
        {dimensions: {has_video_input: "false", resolution: "480p"}, unit: "video_token", unit_price: "27590909090909"},
        {dimensions: {has_video_input: "false", resolution: "1080p"}, unit: "video_token", unit_price: "30350000000000"},
      ],
    },
  },
];

/** Each live provider's published /v1/models prices as the Router listed them on 15 October. */
export function liveCatalogs(): Map<string, ZgProviderModel[]> {
  return new Map([
    [PROVIDERS.chat.toLowerCase(), [{id: "0GM-1.0-35B-A3B", pricing: {prompt: "311000000000", completion: "1860000000000"}}]],
    [PROVIDERS.voice.toLowerCase(), [{id: "openai/whisper-large-v3", pricing: {prompt: "510190000000000", completion: "0"}}]],
    [PROVIDERS.image.toLowerCase(), [{id: "z-image-turbo", pricing: {prompt: "0", completion: "0", image: "34604380000000000"}}]],
    [PROVIDERS.video.toLowerCase(), VIDEO_CATALOG],
    // Published below the on-chain prices on 30 October (they follow 0G's USD rate).
    [PROVIDERS.claude.toLowerCase(), [{id: "claude-fable-5", pricing: {prompt: "58250000000000", completion: "291270000000000"}}]],
    [PROVIDERS.gpt.toLowerCase(), [{id: "openai/gpt-5.4-mini", pricing: {prompt: "1600000000000", completion: "9000000000000"}}]],
    [PROVIDERS.claudeOpus.toLowerCase(), [{id: "claude-opus-5", pricing: {prompt: "29100000000000", completion: "145540000000000"}}]],
  ]);
}

export interface FakePortState {
  wallet: bigint;
  ledger: ZgLedger | null;
  subs: Map<string, ZgSubAccount>;
  services: ZgService[];
  catalogs: Map<string, ZgProviderModel[]>;
  writes: string[];
  verify: (provider: Address, chatId: string) => Promise<boolean | null>;
  failRead?: boolean;
  /** How many times the service list was read. */
  listReads: number;
}

export function fakePort(over: Partial<FakePortState> = {}): ZgPort & {state: FakePortState} {
  const state: FakePortState = {
    wallet: 20n * ZG,
    ledger: null,
    subs: new Map(),
    services: liveServices(),
    catalogs: new Map(),
    writes: [],
    verify: async () => true,
    listReads: 0,
    ...over,
  };
  const key = (p: string) => p.toLowerCase();
  const port: ZgPort & {state: FakePortState} = {
    state,
    address: "0x4049Fcfa417D380e19d6543dA5e811278f3d712E",
    chainId: async () => 16661,
    walletBalance: async () => state.wallet,
    listServices: async () => {
      state.listReads++;
      if (state.failRead) throw new Error("rpc down");
      return state.services;
    },
    providerModels: async (p) => {
      const c = state.catalogs.get(key(p));
      if (!c) throw new Error("unreachable");
      return c;
    },
    ledgerLimits: async () => ({minAccountBalance: 3n * ZG, minTransferAmount: ZG}),
    getLedger: async () => {
      if (state.failRead) throw new Error("rpc down");
      return state.ledger ? {...state.ledger} : null;
    },
    addLedger: async (z) => {
      state.writes.push(`addLedger ${z}`);
      state.wallet -= z * ZG;
      state.ledger = {availableBalance: z * ZG, totalBalance: z * ZG};
    },
    depositFund: async (z) => {
      state.writes.push(`depositFund ${z}`);
      state.wallet -= z * ZG;
      state.ledger = {availableBalance: state.ledger!.availableBalance + z * ZG, totalBalance: state.ledger!.totalBalance + z * ZG};
    },
    getSubAccount: async (p) => {
      if (state.failRead) throw new Error("rpc down");
      const s = state.subs.get(key(p));
      return s ? {...s} : null;
    },
    transferFund: async (p, n) => {
      state.writes.push(`transferFund ${p} ${n}`);
      if (!state.ledger || state.ledger.availableBalance < n) throw new Error("insufficient ledger");
      state.ledger = {...state.ledger, availableBalance: state.ledger.availableBalance - n};
      const s = state.subs.get(key(p)) ?? {balance: 0n, pendingRefund: 0n, acknowledged: false};
      state.subs.set(key(p), {...s, balance: s.balance + n});
    },
    acknowledge: async (p) => {
      state.writes.push(`acknowledge ${p}`);
      const s = state.subs.get(key(p));
      if (!s) throw new Error("no account");
      state.subs.set(key(p), {...s, acknowledged: true});
    },
    authHeaders: async () => ({Authorization: "Bearer test"}),
    processResponse: async (p, chatId) => state.verify(p, chatId),
  };
  return port;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A fetch that routes by URL substring; records every call. */
export function fakeFetch(routes: [string | RegExp, Handler][]): typeof fetch & {calls: {url: string; init: RequestInit}[]} {
  const calls: {url: string; init: RequestInit}[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({url, init});
    if (init.signal?.aborted) throw Object.assign(new Error("aborted"), {name: "AbortError"});
    for (const [m, h] of routes) {
      if (typeof m === "string" ? url.includes(m) : m.test(url)) return h(url, init);
    }
    return new Response("not found", {status: 404});
  }) as typeof fetch & {calls: typeof calls};
  f.calls = calls;
  return f;
}

export const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {status: 200, ...init, headers: {"content-type": "application/json", ...(init.headers as Record<string, string>)}});

/** A Router catalog body whose fields imply `usdPerZg`. */
export function catalogAt(usdPerZg: number, models = 6) {
  return {
    object: "list",
    data: Array.from({length: models}, (_, i) => {
      const neuron = 1_000_000_000_000n * BigInt(i + 1);
      return {id: `m${i}`, pricing: {prompt: neuron.toString()}, pricing_usd: {prompt: String((Number(neuron) / 1e18) * usdPerZg)}};
    }),
  };
}
