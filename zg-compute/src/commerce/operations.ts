import {keccak256, toBytes, type Hex} from "viem";
/** The networks an operation is listed on. */
export type NetworkName = "mainnet" | "testnet";

/*
 * Commerce operations: four 0G services and one opt-in fixed x402 Monad data service.
 *
 * Each is one registered service in `ServiceRegistry` on Monad, paid in AUSD. `networks` says
 * where it is sold: the 0G operations on mainnet and testnet (same slugs on both), the x402
 * operation on mainnet only (its upstream is paid in real USDC; it is registered on mainnet only).
 * 0G operations use the 0G Compute Network; x402 uses gateway-owned USDC upstream payment.
 * The model is named here; the 0G provider is not. The gateway resolves the provider from 0G's own
 * service list every time, so a provider that changes address or stops serving never needs a code
 * change, and an unverifiable provider (anything but TeeML) is never used.
 *
 * Limits are what one run may contain. A request over a limit is refused before it is quoted, so
 * a price never covers less work than the run does.
 */

export type OperationId = "chat" | "voice" | "image" | "video" | "monad" | "claude" | "gpt";

export const OPERATION_IDS: readonly OperationId[] = ["chat", "voice", "image", "video", "monad", "claude", "gpt"];

/** What the person sends, per operation. */
export type OperationInputKind = "prompt" | "audio";

/** What the person gets back. */
export type OperationOutputKind = "text" | "image" | "video";

export interface OperationLimits {
  /** Prompt length in characters, for prompt operations. */
  maxPromptChars?: number;
  /** Tokens the model may write, for chat. */
  maxOutputTokens?: number;
  /** Audio length in seconds, for voice. */
  maxAudioSeconds?: number;
  /** Audio file size in bytes, for voice. */
  maxAudioBytes?: number;
  /** Accepted audio types, for voice. */
  audioTypes?: readonly string[];
}

export interface Operation {
  id: OperationId;
  /** Hashed into the service id. Exactly as registered; never retype it. */
  slug: string;
  /** keccak256(slug), as `ServiceRegistry` computes it. */
  serviceId: Hex;
  /** The name it is registered under. */
  name: string;
  /**
   * The Monad networks it is registered and sold on. Read this, never `fulfillment`, to decide
   * whether a network offers it: a quote, a registration or a catalogue entry on any other network
   * is refused. Not part of the metadata hash.
   */
  networks: readonly NetworkName[];
  /** The 0G model, exactly as 0G's service list names it. */
  model: string;
  /** 0G's service type for the model. */
  zgServiceType: "chatbot" | "speech-to-text" | "text-to-image" | "video-generation" | "rpc";
  fulfillment?: "x402";
  /**
   * What the service's metadata names as its upstream. Absent: the 0G Compute Network. Every x402
   * operation names its own (it is part of the metadata hash: never retype a registered one).
   */
  upstream?: string;
  input: OperationInputKind;
  output: OperationOutputKind;
  /** One line for a card: what one run gets. */
  summary: string;
  limits: OperationLimits;
}

export const MONAD_BLOCK_PROMPT = "Latest Monad block";

const serviceIdFor = (slug: string): Hex => keccak256(toBytes(slug));

const op = (o: Omit<Operation, "serviceId">): Operation => ({...o, serviceId: serviceIdFor(o.slug)});

const BOTH: readonly NetworkName[] = ["mainnet", "testnet"];

export const OPERATIONS: readonly Operation[] = [
  op({
    id: "chat",
    slug: "zg-chat",
    networks: BOTH,
    name: "0G Chat (run by Rein)",
    model: "0GM-1.0-35B-A3B",
    zgServiceType: "chatbot",
    input: "prompt",
    output: "text",
    summary: "One answer, up to 1,024 tokens",
    limits: {maxPromptChars: 4000, maxOutputTokens: 1024},
  }),
  op({
    id: "voice",
    slug: "zg-voice",
    networks: BOTH,
    name: "0G Voice (run by Rein)",
    model: "openai/whisper-large-v3",
    zgServiceType: "speech-to-text",
    input: "audio",
    output: "text",
    summary: "A transcript of up to 60 seconds of audio",
    limits: {maxAudioSeconds: 60, maxAudioBytes: 4 * 1024 * 1024, audioTypes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/m4a"]},
  }),
  op({
    id: "image",
    slug: "zg-image",
    networks: BOTH,
    name: "0G Image (run by Rein)",
    model: "z-image-turbo",
    zgServiceType: "text-to-image",
    input: "prompt",
    output: "image",
    summary: "One image from a prompt",
    limits: {maxPromptChars: 1000},
  }),
  op({
    id: "video",
    slug: "zg-video",
    networks: BOTH,
    name: "0G Video (run by Rein)",
    model: "dreamina-seedance-2-0-260128",
    zgServiceType: "video-generation",
    input: "prompt",
    output: "video",
    summary: "One short clip from a prompt",
    limits: {maxPromptChars: 1000},
  }),
  // Closed models through 0G's direct providers (models.ts says what each provider can prove).
  // Slugs name the family, not the version, so a newer model is a metadata change, not a new service.
  op({
    id: "claude",
    slug: "zg-claude",
    networks: BOTH,
    name: "Claude Fable 5 (through 0G, run by Rein)",
    model: "claude-fable-5",
    zgServiceType: "chatbot",
    upstream: "0G Compute Network: claude-fable-5, relayed to Anthropic (no TEE)",
    input: "prompt",
    output: "text",
    summary: "One answer from Claude Fable 5, up to 1,024 tokens",
    limits: {maxPromptChars: 4000, maxOutputTokens: 1024},
  }),
  op({
    id: "gpt",
    slug: "zg-gpt",
    networks: BOTH,
    name: "GPT-5.4 mini (through 0G, run by Rein)",
    model: "openai/gpt-5.4-mini",
    zgServiceType: "chatbot",
    upstream: "0G Compute Network: openai/gpt-5.4-mini, routed to OpenAI through a TEE",
    input: "prompt",
    output: "text",
    summary: "One answer from GPT-5.4 mini, up to 1,024 tokens",
    limits: {maxPromptChars: 4000, maxOutputTokens: 1024},
  }),
];

export function operationById(id: string): Operation | null {
  return OPERATIONS.find((o) => o.id === id) ?? null;
}

export function operationByServiceId(serviceId: string): Operation | null {
  const s = serviceId.toLowerCase();
  return OPERATIONS.find((o) => o.serviceId.toLowerCase() === s) ?? null;
}

/** Whether `op` is registered and sold on `network`. */
export function isOfferedOn(op: Operation, network: NetworkName): boolean {
  return op.networks.includes(network);
}

/** The operations sold on `network`, in catalogue order. */
export function operationsOn(network: NetworkName): readonly Operation[] {
  return OPERATIONS.filter((o) => isOfferedOn(o, network));
}

export function isOperationId(v: unknown): v is OperationId {
  return typeof v === "string" && (OPERATION_IDS as readonly string[]).includes(v);
}
