// The compute services Rein sells, each one Solana registry service backed by one real 0G offering,
// run by Rein on 0G. Prices are not here: every quote asks 0G for the worst case of one run right
// now (provider prices x 0G's USD rate) and marks it up 1.5x, at least $0.01.
//
// What 0G serves was read live on 2026-11-09:
//   wallet route (the 0G Compute SDK with the gateway's funded wallet, `@rein/zg-compute`): chat
//     0GM-1.0-35B-A3B, voice openai/whisper-large-v3 and image z-image-turbo, each from a TeeML
//     provider whose signer 0G acknowledges (model in enclave, every answer signed). No verified
//     provider serves video, Claude or GPT there (GPT's provider is refused: its TEE signer is not
//     acknowledged).
//   Router route (0G Private Computer, https://router-api.0g.ai/v1, one `sk-` key): Claude and GPT
//     models and Seedance video, all "standard" trust: relayed to the vendor, no TEE, nothing signed.
// So chat, voice and image run on the wallet route and are labelled TEE verified; Claude and GPT
// run on the Router only and are labelled relayed, no TEE. Video is listed as coming soon and is
// not registered (COMING_SOON says why). Add a row here, register it with scripts/compute-setup.ts,
// and it sells.

export type ComputeService = 'ai-chat' | 'ai-voice' | 'ai-image' | 'ai-claude' | 'ai-gpt';
export const COMPUTE_SERVICES: readonly ComputeService[] = ['ai-chat', 'ai-image', 'ai-voice', 'ai-claude', 'ai-gpt'];

export type ServiceKind = 'chat' | 'voice' | 'image' | 'claude' | 'gpt';
export type InputKind = 'prompt' | 'audio';
export type OutputKind = 'text' | 'image';
/** wallet: the 0G Compute SDK with ZG_PRIVATE_KEY. router: 0G Private Computer with ZG_ROUTER_API_KEY. */
export type Route = 'wallet' | 'router';
/** tee: the model runs in a TEE whose signature is checked. relayed: sent to the vendor, nothing checked. */
export type Trust = 'tee' | 'relayed';

export const TRUST_LABEL: Record<Trust, string> = { tee: 'TEE verified', relayed: 'Relayed, no TEE' };

export type ServiceMeta = {
  kind: ServiceKind;
  /** The `@rein/zg-compute` operation id, for the wallet route. */
  op?: 'chat' | 'voice' | 'image';
  /** Where it runs. A router service never falls back to the wallet, and the reverse. */
  route: Route;
  /** The model as its route lists it: the 0G service list (wallet) or the Router's /v1/models (router). */
  model: string;
  /** What people read: "<offering>, run by Rein on 0G". */
  name: string;
  /** Registry label, at most 32 bytes. Fixed at registration; the program cannot change it. */
  label: string;
  summary: string;
  input: InputKind;
  output: OutputKind;
  trust: Trust;
  maxPromptChars: number;
  maxOutputTokens: number | null;
  maxAudioBytes?: number;
  maxAudioSeconds?: number;
  /** List price shown in the registry, base units. Not a limit and not the quote. */
  listPrice: bigint;
  /** The Router model id chat may also use (wallet services only; private TEE mode, never relayed). */
  routerModel?: string;
  /** Router trust mode: private = TeeML providers only (never falls back); standard = relayed. */
  routerTrust?: 'private' | 'standard';
  /** Ask a thinking model for low reasoning effort, so the 1,024-token cap is spent on the answer. */
  lowReasoning?: 'template' | 'effort';
};

/** Audio the gateway accepts for ai-voice: under Vercel's 4.5 MB request cap once base64'd. */
export const AUDIO_MAX_BYTES = 3 * 1024 * 1024;
export const AUDIO_MAX_SECONDS = 60;

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5.5';
export const DEFAULT_GPT_MODEL = 'gpt-5.6-luna';

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

/** A model id from env, or the default when unset. A malformed value is refused (null), never guessed. */
export function modelFromEnv(raw: string | undefined, dflt: string): string | null {
  const v = raw?.trim();
  if (!v) return dflt;
  return MODEL_ID_RE.test(v) ? v : null;
}

const DISPLAY: Record<string, string> = {
  'claude-haiku-5.5': 'Claude Haiku 5.5',
  'claude-sonnet-5.5': 'Claude Sonnet 5.5',
  'claude-opus-5.5': 'Claude Opus 5.5',
  'claude-fable-5': 'Claude Fable 5',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
};
const display = (model: string) => DISPLAY[model] ?? model;

export function buildServiceTable(env: Record<string, string | undefined> = process.env): Record<ComputeService, ServiceMeta> {
  // A malformed model id keeps the service in the table under an id the Router never lists, so it
  // quotes nothing ("not listed") instead of running a model nobody chose.
  const claude = modelFromEnv(env.COMPUTE_CLAUDE_MODEL, DEFAULT_CLAUDE_MODEL) ?? 'invalid-COMPUTE_CLAUDE_MODEL';
  const gpt = modelFromEnv(env.COMPUTE_GPT_MODEL, DEFAULT_GPT_MODEL) ?? 'invalid-COMPUTE_GPT_MODEL';
  return {
    'ai-chat': {
      kind: 'chat',
      op: 'chat',
      route: 'wallet',
      model: '0GM-1.0-35B-A3B',
      name: '0G Chat, run by Rein on 0G',
      label: '0G Chat (0GM-1.0-35B-A3B)',
      summary: 'One answer of up to 1,024 tokens from 0GM-1.0-35B-A3B, run in a TEE on 0G and signed',
      input: 'prompt',
      output: 'text',
      trust: 'tee',
      maxPromptChars: 4_000,
      maxOutputTokens: 1_024,
      listPrice: 10_000n,
      routerModel: '0gm-1.0-35b-a3b',
      routerTrust: 'private',
      lowReasoning: 'template',
    },
    'ai-image': {
      kind: 'image',
      op: 'image',
      route: 'wallet',
      model: 'z-image-turbo',
      name: '0G Image, run by Rein on 0G',
      label: '0G Image, Z-Image-Turbo (TEE)',
      summary: 'One image from a prompt, made by z-image-turbo in a TEE on 0G; the signature covers the image bytes',
      input: 'prompt',
      output: 'image',
      trust: 'tee',
      maxPromptChars: 1_000,
      maxOutputTokens: null,
      listPrice: 20_000n,
    },
    'ai-voice': {
      kind: 'voice',
      op: 'voice',
      route: 'wallet',
      model: 'openai/whisper-large-v3',
      name: '0G Voice, run by Rein on 0G',
      label: '0G Voice, Whisper v3 (TEE)',
      summary: 'A transcript of up to 60 seconds of audio from whisper-large-v3, run in a TEE on 0G and signed',
      input: 'audio',
      output: 'text',
      trust: 'tee',
      maxPromptChars: 0,
      maxOutputTokens: null,
      maxAudioBytes: AUDIO_MAX_BYTES,
      maxAudioSeconds: AUDIO_MAX_SECONDS,
      listPrice: 20_000n,
    },
    'ai-claude': {
      kind: 'claude',
      route: 'router',
      model: claude,
      name: `${display(claude)}, run by Rein on 0G`,
      label: 'Claude via 0G (relayed, no TEE)',
      summary: `One answer of up to 1,024 tokens from ${display(claude)}, relayed to Anthropic through the 0G Router. No TEE: the answer is not checked`,
      input: 'prompt',
      output: 'text',
      trust: 'relayed',
      maxPromptChars: 4_000,
      maxOutputTokens: 1_024,
      listPrice: 10_000n,
      routerTrust: 'standard',
      lowReasoning: 'effort',
    },
    'ai-gpt': {
      kind: 'gpt',
      route: 'router',
      model: gpt,
      name: `${display(gpt)}, run by Rein on 0G`,
      label: 'GPT via 0G (relayed, no TEE)',
      summary: `One answer of up to 1,024 tokens from ${display(gpt)}, relayed to OpenAI through the 0G Router. No TEE: the answer is not checked`,
      input: 'prompt',
      output: 'text',
      trust: 'relayed',
      maxPromptChars: 4_000,
      maxOutputTokens: 1_024,
      listPrice: 10_000n,
      routerTrust: 'standard',
      lowReasoning: 'effort',
    },
  };
}

export const SERVICE_TABLE: Record<ComputeService, ServiceMeta> = buildServiceTable();

/**
 * Offerings shown in the catalog as coming soon: not registered, never quoted.
 * Video: the Router prices Seedance 2.0 Fast per vendor-reported video token (480p, no reference
 * video: $0.0000056 a token, read from /v1/models on 2026-11-09; a 4 s 480p clip is about 40,600
 * tokens, so about $0.23 before the markup). Its job flow is asynchronous and can only be exercised
 * with a 0G Private Computer key, which this server does not have yet, and the wallet route has no
 * verified video provider. Selling it before that flow has been run once end to end would be a
 * guess, so it is not sold.
 */
export const COMING_SOON = [
  {
    id: 'ai-video',
    kind: 'video' as const,
    output: 'video' as const,
    trust: 'relayed' as Trust,
    model: 'bytedance/seedance-2.0-fast',
    name: '0G Video (Seedance 2.0 Fast), run by Rein on 0G',
    reason:
      "Coming soon. The 0G Router prices Seedance per video token the vendor reports (about $0.23 for a 4 s 480p clip before the markup), but its asynchronous job flow can't be run or checked without a 0G Private Computer key, and no verified 0G provider serves video on the wallet route. It is not registered and cannot be bought.",
  },
];
