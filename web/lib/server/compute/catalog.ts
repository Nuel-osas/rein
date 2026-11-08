// The compute services Rein sells, each one Solana registry service backed by one 0G Compute
// operation (`@rein/zg-compute`, ported from Nuntio). Prices are not here: every quote asks 0G for
// the worst case of one run right now (provider prices × 0G's USD rate) and marks it up 1.5×.
//
// What 0G serves was read live on mainnet (chain 16661) on 2026-11-08 with
// `~/.cache/rein/gw/zg-providers.mts` (read only, a throwaway wallet): chat `0GM-1.0-35B-A3B` from
// a TeeML provider whose signer 0G acknowledges (model-in-enclave). No Claude model was listed by
// any provider, and GPT-5.4 mini's provider was refused (TEE signer not acknowledged), so only
// `ai-chat` is registered. Add a row here, register it with scripts/compute-setup.ts, and it sells.

export type ComputeService = 'ai-chat';

export type ServiceMeta = {
  /** The `@rein/zg-compute` operation id. */
  op: 'chat' | 'claude' | 'gpt';
  /** The 0G model, exactly as 0G lists it (checked against the adapter's operation at wiring). */
  model: string;
  /** Registry label, at most 32 bytes. */
  label: string;
  summary: string;
  maxPromptChars: number;
  maxOutputTokens: number;
  /** List price shown in the registry, base units (0.01). Not a limit and not the quote. */
  listPrice: bigint;
  /** The 0G Router (0G Private Computer) model id, as https://router-api.0g.ai/v1/models lists it. */
  routerModel?: string;
  /** Router trust mode: private = TeeML providers only (never falls back). */
  trust?: 'private' | 'verified' | 'standard';
  /** Ask a thinking model for low reasoning effort, so the 1,024-token cap is spent on the answer. */
  lowReasoning?: boolean;
};

export const SERVICE_TABLE: Record<ComputeService, ServiceMeta> = {
  'ai-chat': {
    op: 'chat',
    model: '0GM-1.0-35B-A3B',
    label: '0G Chat (0GM-1.0-35B-A3B)',
    summary: 'One answer of up to 1,024 tokens from 0GM-1.0-35B-A3B, run in a TEE on 0G and signed',
    maxPromptChars: 4_000,
    maxOutputTokens: 1_024,
    listPrice: 10_000n,
    routerModel: '0gm-1.0-35b-a3b',
    trust: 'private',
    lowReasoning: true,
  },
};
