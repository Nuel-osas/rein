/*
 * Closed models sold through 0G's direct providers (decided 30 Oct 2026, "direct now,
 * newest later"; docs/hackathon/CLOSED-MODELS-PLAN.md).
 *
 * 0G's direct providers relay these to the vendor's own API. How much of a run can be checked
 * depends on the provider, never on the model's name, so each entry says what is true for it:
 *
 * - "relayed": the provider runs no TEE (0G lists it as "standard"). Nothing about the answer can
 *   be checked; it is delivered unchecked and every screen, header and post says so.
 * - "routed-to-vendor": a TEE broker relays to the vendor and signs that route; the signature
 *   proves the route, not what the model wrote.
 *
 * Only the ids here are ever sold among closed models: everything else GPT, Claude, Gemini or
 * DeepSeek stays refused (0G's Router catalogue may be resold only through its Partner programme).
 * The newest models (claude-opus-5.5, claude-fable-5.1, gpt-6.1-sol) are Router-only on 30 Oct.
 */

/** How much of a run's answer can be checked. */
export type ModelTrust =
  /** The model runs inside the provider's enclave, which signs the answer. */
  | "model-in-enclave"
  /** A TEE broker relays to the vendor's API and signs the route, not the answer. */
  | "routed-to-vendor"
  /** No TEE: the provider relays to the vendor and nothing can be checked. */
  | "relayed";

export interface ClosedModel {
  /** Exactly as 0G's direct service list names it. */
  id: string;
  /** What people read. Never "latest" or "newest": name the version. */
  name: string;
  vendor: "Anthropic" | "OpenAI";
  /** What the 0G provider for this model can prove (30 Oct: read from its listing). */
  trust: Exclude<ModelTrust, "model-in-enclave">;
  /**
   * The request format the provider takes: "openai" (POST {endpoint}/chat/completions) or
   * "anthropic" (POST {endpoint}/messages, Anthropic's Messages API). Claude's providers refuse the
   * OpenAI format ("supported: [anthropic]", read in the paid probe of 30 Oct).
   */
  format: "openai" | "anthropic";
  /**
   * For a relayed model, the only 0G providers it may come from (checksummed addresses, read 30 Oct).
   * With no TEE nothing shows who answers, so a new "standard" listing for the same id is never
   * used until it is added here. Absent for a TEE route, whose signer 0G acknowledges.
   */
  providers?: readonly string[];
  /**
   * Sent with thinking turned off (Anthropic `thinking: {type: "disabled"}`). Claude Opus 5 thinks
   * before it writes by default, and with a small max_tokens it spent every token thinking and
   * answered nothing (30 Oct). Claude Fable 5 refuses the setting (400) and thinks only briefly.
   */
  thinkingOff?: true;
}

export const CLOSED_MODELS: readonly ClosedModel[] = [
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    vendor: "Anthropic",
    trust: "relayed",
    format: "anthropic",
    providers: ["0x1F444c8A8D0b8e99A50e9f165806d28B01916E04"],
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    vendor: "Anthropic",
    trust: "relayed",
    format: "anthropic",
    providers: ["0xd3f02c1a04160389d98D2192AE2034159f731011"],
    thinkingOff: true,
  },
  {id: "openai/gpt-5.4-mini", name: "GPT-5.4 mini", vendor: "OpenAI", trust: "routed-to-vendor", format: "openai"},
];

/** Whether `provider` may relay this closed model: always for a TEE route, only a pinned one when relayed. */
export function closedProviderAllowed(m: ClosedModel, provider: string): boolean {
  if (m.trust !== "relayed") return true;
  const p = provider.toLowerCase();
  return (m.providers ?? []).some((a) => a.toLowerCase() === p);
}

/**
 * The closed model with exactly this 0G id, or null (not sold, or not closed). Exact, never
 * case-insensitive or trimmed: 0G's service list is open to any provider, so "Claude-Fable-5" or
 * "claude-fable-5 " is another listing, not this one, and must not be admitted without a TEE or
 * sold under this name. A client's own spelling is matched to a catalogue id before this is asked.
 */
export function closedModel(id: string): ClosedModel | null {
  return CLOSED_MODELS.find((m) => m.id === id) ?? null;
}

/** One sentence for a person: what is and is not checked for a model's answers. */
export function trustSentence(trust: ModelTrust, vendor: string | null): string {
  switch (trust) {
    case "model-in-enclave":
      return "Runs in a TEE on 0G, which signs every answer.";
    case "routed-to-vendor":
      return `Sent to ${vendor ?? "the vendor"} through a TEE on 0G, which signs the route. The answer itself is not checked.`;
    case "relayed":
      return `Relayed to ${vendor ?? "the vendor"} through 0G. No TEE, so the answer is not checked.`;
  }
}
