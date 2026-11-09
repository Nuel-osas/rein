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
// So chat, voice and image run on the wallet route and are labelled TEE verified; Claude, GPT and
// video run on the Router only and are labelled relayed, no TEE. Chat stays on the wallet even with
// a Router key: the Router's private mode returned no `tee_verified` when tried on 2026-11-09.
// Video is a job (POST /v1/videos, then poll): `run` starts it and the result endpoint finishes it,
// so no request waits for a clip. Add a row here, register it with scripts/compute-setup.ts, and
// it sells.

export type ComputeService = 'ai-chat' | 'ai-voice' | 'ai-image' | 'ai-claude' | 'ai-gpt' | 'ai-video';
export const COMPUTE_SERVICES: readonly ComputeService[] = ['ai-chat', 'ai-image', 'ai-voice', 'ai-claude', 'ai-gpt', 'ai-video'];

export type ServiceKind = 'chat' | 'voice' | 'image' | 'claude' | 'gpt' | 'video';
export type InputKind = 'prompt' | 'audio';
export type OutputKind = 'text' | 'image' | 'video';
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
  /** The Router's id for the same model (ai-chat). Not used to route: chat runs on the wallet only. */
  routerModel?: string;
  /** Router trust mode: private = TeeML providers only (never falls back); standard = relayed. */
  routerTrust?: 'private' | 'standard';
  /** Ask a thinking model for low reasoning effort, so the 1,024-token cap is spent on the answer. */
  lowReasoning?: 'template' | 'effort';
  /** The run is a job: `run` starts it and the result endpoint finishes it (video). */
  async?: true;
};

/** The one clip ai-video makes: fixed so its worst case can be bounded before it is quoted. */
export const VIDEO_CLIP = { seconds: 4, resolution: '480p', ratio: '16:9' } as const;
export const DEFAULT_VIDEO_MODEL = 'bytedance/seedance-2.0-fast';

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
  'bytedance/seedance-2.0-fast': 'Seedance 2.0 Fast',
  'bytedance/seedance-2.0': 'Seedance 2.0',
};
const display = (model: string) => DISPLAY[model] ?? model;

/** Tokens a relayed answer may write (COMPUTE_RELAYED_MAX_TOKENS, 64 to 1,024, default 1,024). */
export function relayedMaxTokens(raw: string | undefined): number {
  const v = raw?.trim();
  if (!v) return 1_024;
  const n = /^\d{1,5}$/.test(v) ? Number(v) : NaN;
  // Fail closed to the smallest cap: a malformed value never raises what a run may cost.
  return n >= 64 && n <= 1_024 ? n : 64;
}

export function buildServiceTable(env: Record<string, string | undefined> = process.env): Record<ComputeService, ServiceMeta> {
  // A malformed model id keeps the service in the table under an id the Router never lists, so it
  // quotes nothing ("not listed") instead of running a model nobody chose.
  const claude = modelFromEnv(env.COMPUTE_CLAUDE_MODEL, DEFAULT_CLAUDE_MODEL) ?? 'invalid-COMPUTE_CLAUDE_MODEL';
  const gpt = modelFromEnv(env.COMPUTE_GPT_MODEL, DEFAULT_GPT_MODEL) ?? 'invalid-COMPUTE_GPT_MODEL';
  const video = modelFromEnv(env.COMPUTE_VIDEO_MODEL, DEFAULT_VIDEO_MODEL) ?? 'invalid-COMPUTE_VIDEO_MODEL';
  const relayedTokens = relayedMaxTokens(env.COMPUTE_RELAYED_MAX_TOKENS);
  const tok = relayedTokens.toLocaleString('en-US');
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
      summary: `One answer of up to ${tok} tokens from ${display(claude)}, relayed to Anthropic through the 0G Router. No TEE: the answer is not checked`,
      input: 'prompt',
      output: 'text',
      trust: 'relayed',
      maxPromptChars: 4_000,
      maxOutputTokens: relayedTokens,
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
      summary: `One answer of up to ${tok} tokens from ${display(gpt)}, relayed to OpenAI through the 0G Router. No TEE: the answer is not checked`,
      input: 'prompt',
      output: 'text',
      trust: 'relayed',
      maxPromptChars: 4_000,
      maxOutputTokens: relayedTokens,
      listPrice: 10_000n,
      routerTrust: 'standard',
      lowReasoning: 'effort',
    },
    'ai-video': {
      kind: 'video',
      route: 'router',
      model: video,
      name: `0G Video (${display(video)}), run by Rein on 0G`,
      label: 'Video via 0G (relayed, no TEE)',
      summary: `One ${VIDEO_CLIP.seconds}-second ${VIDEO_CLIP.resolution} clip from a prompt, made by ${display(video)} (ByteDance) through the 0G Router. No TEE: the clip is not checked`,
      input: 'prompt',
      output: 'video',
      trust: 'relayed',
      maxPromptChars: 1_000,
      maxOutputTokens: null,
      listPrice: 450_000n,
      routerTrust: 'standard',
      async: true,
    },
  };
}

export const SERVICE_TABLE: Record<ComputeService, ServiceMeta> = buildServiceTable();

/** Offerings shown in the catalog as coming soon: not registered, never quoted. None today. */
export const COMING_SOON: { id: string; kind: string; output: string; trust: Trust; model: string; name: string; reason: string }[] = [];
