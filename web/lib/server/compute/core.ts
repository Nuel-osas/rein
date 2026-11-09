// The compute gateway's logic, with every outside effect injected (store, chain reads, the 0G
// backend, the refund) so it can be tested without a validator, a 0G wallet or a model. Route
// handlers wire the real ones in `./wire.ts`. Money is bigint base units of test USDC (6 decimals,
// 1 test USDC = $1) throughout.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { audioLength } from '@rein/zg-compute/audio';
import { COMING_SOON, SERVICE_TABLE, TRUST_LABEL, type ComputeService } from './catalog';
import type { Store } from '../store';

export { SERVICE_TABLE, type ComputeService };
export const isComputeService = (s: unknown): s is ComputeService => typeof s === 'string' && Object.hasOwn(SERVICE_TABLE, s);

export const PROMPT_MAX_CHARS = 4_000;
export const MAX_TOKENS_CAP = 1_024;
export const QUOTE_TTL_SEC = 25 * 60 * 60;
export const RESULT_TTL_SEC = 7 * 24 * 60 * 60;
export const REFUND_TTL_SEC = 30 * 24 * 60 * 60;
export const RUN_LOCK_SEC = 90;
export const TEAM_LOCK_SEC = 60;
export const TEAM_RUNS_PER_DAY = 20;
/** First runs on a provider include its funding transactions (~20 s live); funded runs take ~5 s. */
export const UPSTREAM_TIMEOUT_MS = 45_000;
export const CENT = 10_000n; // base units
export const INTENT_RE = /^c[A-Za-z0-9_-]{31}$/;


// ------------------------------------------------------------------ pricing and intents ---

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * price = 0G's worst case for one run (maxCostNeuron × USD per 0G) × 1.5, rounded up to the cent,
 * at least $0.01, in test USDC base units (1 test USDC = $1, so a base unit is a micro-dollar).
 * `worst` is the same cost without the markup, rounded up to a base unit: what the daily budget is
 * charged. The rate is rounded up to the micro-dollar so a float never under-prices.
 */
export function priceOf(maxCostNeuron: bigint, usdPerZg: number): { amount: bigint; worst: bigint } {
  if (!(usdPerZg > 0) || !Number.isFinite(usdPerZg) || maxCostNeuron <= 0n) throw new Error('bad price inputs');
  const microPerZg = BigInt(Math.ceil(usdPerZg * 1e6));
  const worst = ceilDiv(maxCostNeuron * microPerZg, NEURON_PER_ZG);
  const cents = ceilDiv(worst * 3n, 2n * CENT);
  return { amount: (cents < 1n ? 1n : cents) * CENT, worst };
}

export const NEURON_PER_ZG = 10n ** 18n;

/** Neuron at a USD rate, in base units (micro-dollars), rounded down: a balance is never overstated. */
export function neuronToMicroUsd(neuron: bigint, usdPerZg: number): bigint {
  return (neuron * BigInt(Math.floor(usdPerZg * 1e6))) / NEURON_PER_ZG;
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const sha256Bytes = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------------------ inputs ---

/** The container a voice upload is, told by its first bytes (never by the declared type), as its MIME type. */
const AUDIO_MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', mp4: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm' } as const;
/** Declared types a client may send for each container (browsers name the same file differently). */
const DECLARED_OK: Record<keyof typeof AUDIO_MIME, readonly string[]> = {
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  mp4: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac'],
  ogg: ['audio/ogg', 'application/ogg'],
  webm: ['audio/webm', 'video/webm'],
};
/** How far past the limit a measured length may read (the adapter refuses beyond the same 0.25 s). */
export const AUDIO_LIMIT_TOLERANCE = 0.25;

export type QuoteAudio = { bytes: Uint8Array; mime?: string };
export type CheckedInput =
  | { kind: 'prompt'; prompt: string; sha: string }
  | { kind: 'audio'; bytes: Uint8Array; mime: string; seconds: number; sha: string };

/**
 * The input of one run, checked against its service before anything is quoted: a prompt within the
 * service's limit, or (ai-voice) an audio file whose container is told by its bytes, within the size
 * cap, whose declared type (when given) matches that container, and that plays at most the limit as
 * measured from its frames. `sha` is what the quote's intent binds.
 */
export function checkInput(service: ComputeService, input: { prompt?: unknown; audio?: QuoteAudio | null }): CheckedInput | { error: string } {
  const meta = SERVICE_TABLE[service];
  if (meta.input === 'prompt') {
    if (input.audio) return { error: `${service} takes a prompt, not audio` };
    const p = input.prompt;
    if (typeof p !== 'string' || !p.trim()) return { error: 'prompt is required' };
    // The adapter checks the trimmed prompt against the same limit; the quote binds it as sent.
    if (p.length > meta.maxPromptChars) return { error: `prompt is at most ${meta.maxPromptChars} characters` };
    return { kind: 'prompt', prompt: p, sha: sha256Hex(p) };
  }
  if (input.prompt !== undefined && input.prompt !== '') return { error: `${service} takes an audio file, not a prompt` };
  const a = input.audio;
  if (!a || !(a.bytes instanceof Uint8Array) || a.bytes.length === 0) return { error: `${service} takes an audio file: send audio.base64 (and audio.mime)` };
  const maxBytes = meta.maxAudioBytes ?? 0;
  if (a.bytes.length > maxBytes) return { error: `audio is at most ${Math.floor(maxBytes / (1024 * 1024))} MB` };
  const len = audioLength(a.bytes);
  if (!len) return { error: 'could not read that audio: use an MP3, WAV, M4A, WebM or Ogg file' };
  const declared = a.mime?.split(';')[0]?.trim().toLowerCase();
  if (declared && !DECLARED_OK[len.format].includes(declared)) return { error: `the file is ${len.format} but was sent as ${declared}` };
  const maxS = meta.maxAudioSeconds ?? 0;
  if (len.seconds > maxS + AUDIO_LIMIT_TOLERANCE) return { error: `audio is at most ${maxS} seconds (this plays ${Math.ceil(len.seconds)})` };
  // Stated to the adapter as measured here, rounded up to the hundredth; it re-measures before it spends.
  return { kind: 'audio', bytes: a.bytes, mime: AUDIO_MIME[len.format], seconds: Math.ceil(len.seconds * 100) / 100, sha: sha256Bytes(a.bytes) };
}

/** Decodes standard base64 (no data: prefix), or null when it is not base64 or decodes past `maxBytes`. */
export function decodeBase64(s: unknown, maxBytes: number): Uint8Array | null {
  if (typeof s !== 'string' || !s) return null;
  if (s.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 === 1) return null;
  const b = Buffer.from(s, 'base64');
  return b.length > 0 && b.length <= maxBytes ? new Uint8Array(b) : null;
}

/** Image types a result may be served as, told by the bytes. Anything else is never stored or served. */
export function sniffImage(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** An MP4 told by its `ftyp` box. Under 4 MB so a function can serve it (Vercel's response cap is 4.5 MB). */
export function sniffVideo(b: Uint8Array): 'video/mp4' | null {
  return b.length >= 12 && Buffer.from(b.subarray(4, 8)).toString('latin1') === 'ftyp' ? 'video/mp4' : null;
}
export const VIDEO_MAX_BYTES = 4 * 1024 * 1024;
/** A video job not finished after this long is refunded (the Router's own clips took about a minute). */
export const JOB_DEADLINE_MS = 30 * 60_000;
export const JOB_POLL_LOCK_SEC = 50;

/** The stored media of a result, by its own bytes: an image, an MP4, or null (never served). */
export function sniffMedia(b: Uint8Array): string | null {
  return sniffImage(b) ?? sniffVideo(b);
}

/** "c" + base64url(HMAC(secret, team|spender|service|amount|sha256(prompt)|maxTokens|nonce)), 32 chars. */
export function intentFor(secret: string, f: { team: string; spender: string; service: string; amount: bigint; promptSha: string; maxTokens: number; nonce: string }): string {
  const msg = [f.team, f.spender, f.service, f.amount.toString(), f.promptSha, String(f.maxTokens), f.nonce].join('|');
  const mac = createHmac('sha256', secret).update(msg, 'utf8').digest('base64url');
  return ('c' + mac).slice(0, 32);
}

export const utcDay = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

// ------------------------------------------------------------------------------ config ---

export type ComputeEnv = {
  production: boolean;
  enabled: boolean;
  /** The labelled fake 0G backend. Never in production, whatever the flag says. */
  fake: boolean;
  dailyBudget: bigint; // base units
  ledgerFloor: bigint; // base units
  gatewaySecret: string | null;
  zgKeyPresent: boolean;
};

const usd = (raw: string | undefined, dflt: string): bigint => {
  // Fail closed: a malformed amount is zero (a budget of zero refuses everything).
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(raw?.trim() || dflt);
  return m ? BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0')) : 0n;
};

export function readComputeEnv(env: Record<string, string | undefined> = process.env): ComputeEnv {
  const production = env.NODE_ENV === 'production';
  const secret = env.GATEWAY_SECRET?.trim();
  const floorRaw = env.ZG_LEDGER_FLOOR_USD?.trim();
  return {
    production,
    enabled: (env.COMPUTE_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    fake: !production && env.COMPUTE_FAKE_UPSTREAM === '1',
    dailyBudget: usd(env.COMPUTE_DAILY_BUDGET_USD, '5'),
    // A malformed floor is treated as huge, so quotes stop rather than run the ledger dry.
    ledgerFloor: floorRaw && !/^\d{1,6}(?:\.\d{1,6})?$/.test(floorRaw) ? 10n ** 15n : usd(floorRaw, '0.25'),
    gatewaySecret: secret && secret.length >= 32 ? secret : null,
    zgKeyPresent: !!(env.ZG_ROUTER_API_KEY?.trim() || env.ZG_PRIVATE_KEY?.trim()),
  };
}

// ------------------------------------------------------------------------------ deps ---

export type Quote = {
  v: 1;
  intent: string;
  team: string;
  authority: string;
  spender: string;
  service: ComputeService;
  servicePda: string;
  payeeToken: string;
  model: string;
  amount: string;
  worst: string;
  maxTokens: number;
  /** sha256 of the prompt, or of the audio bytes for ai-voice: what the intent binds. */
  promptSha: string;
  /** The prompt as sent; '' for an audio input (its bytes are in the blob store under the intent). */
  prompt: string;
  input?: 'prompt' | 'audio';
  /** ai-voice: the audio's container type, measured length and size, as quoted. */
  audio?: { mime: string; seconds: number; bytes: number };
  nonce: string;
  /** 0G's price revision the quote was made from (provider, unit prices, rate, time). */
  revision: string;
  createdAt: number;
};

export type ComputeResult = {
  intent: string;
  service: ComputeService;
  model: string;
  /** What was delivered: text (chat, Claude, GPT, a voice transcript), an image or a clip. */
  output?: 'text' | 'image' | 'video';
  /** The answer or transcript; '' for an image. */
  text: string;
  /** Image and video results: the type, size and where to fetch the bytes (the intent is the capability). */
  mime?: string;
  bytes?: number;
  url?: string;
  /** tee: run in a TEE whose signature was checked. relayed: no TEE, nothing checked. */
  trust?: 'tee' | 'relayed';
  /** True when no model was called (COMPUTE_FAKE_UPSTREAM=1, never in production). The text says so too. */
  fake: boolean;
  /** True only when the provider's TEE signature over the answer checked out. */
  verified: boolean;
  /** What the signature covers: "output", "route" or "none" (a relayed model: unchecked). */
  covers: string | null;
  provider: string | null;
  /** What the run cost on 0G, neuron, as the provider reported it; null when it reported none. */
  costNeuron: string | null;
  resultHash: string;
  createdAt: number;
};

export type PaymentView = {
  owner: string;
  team: string;
  spender: string;
  service: string;
  payeeToken: string;
  amount: bigint;
  status: string;
  deadline: number;
};

export type RefundOutcome =
  | { state: 'confirmed' | 'pending' | 'failed' | 'signed'; signature: string; reason: string }
  /** Nothing was signed or recorded (a key or a read was missing). Safe to try again. */
  | { state: 'unavailable'; error: string };

export type BackendPrice = { ok: true; maxCostNeuron: bigint; usdPerZg: number; revision: string } | { ok: false; reason: string };
export type BackendInput = { prompt: string } | { audio: { bytes: Uint8Array; mime: string; seconds: number } };
export type BackendOutput = { kind: 'text'; text: string } | { kind: 'image'; mime: string; bytes: Uint8Array } | { kind: 'video'; mime: string; bytes: Uint8Array };
/** A job's state when asked: still working, unreadable right now (asked again later), finished, or failed. */
export type JobPoll =
  | { state: 'running' }
  | { state: 'unknown'; message: string }
  | { state: 'failed'; code: string; message: string }
  | { state: 'done'; output: BackendOutput; fake: boolean; verified: boolean; covers: string | null; provider: string | null; costNeuron: bigint | null };
export type BackendRun =
  | { ok: true; output: BackendOutput; fake: boolean; verified: boolean; covers: string | null; provider: string | null; costNeuron: bigint | null }
  | { ok: false; code: string; message: string };

/** What the gateway needs from 0G: the adapter (`@rein/zg-compute`), the 0G Router, or the labelled fake. */
export interface ComputeBackendLike {
  /** Which route this is, for the result and the logs. */
  route?: 'wallet' | 'router' | 'fake';
  model(service: ComputeService): string;
  priceOf(service: ComputeService): Promise<BackendPrice>;
  /** The ledger's available balance, neuron; null when unread. */
  ledgerNeuron(): Promise<bigint | null>;
  /** True when the backend cannot read its balance by design (the 0G Router without a management key):
   *  the floor check is skipped, an empty balance fails the run, and the run is refunded. */
  ledgerOptional?: boolean;
  run(service: ComputeService, input: BackendInput, o: { purchaseId: string; signal: AbortSignal }): Promise<BackendRun>;
  /** Async services (video): start the job and return its id, without waiting for the output. */
  startJob?(service: ComputeService, input: BackendInput, o: { purchaseId: string; signal: AbortSignal }): Promise<{ ok: true; jobId: string } | { ok: false; code: string; message: string }>;
  /** Async services: the job's state now. Never throws for a busy or unreadable status: that is 'unknown'. */
  pollJob?(service: ComputeService, jobId: string, o: { signal: AbortSignal }): Promise<JobPoll>;
}

/**
 * No backend for a service, and why. `notConfigured`: its key is missing on this server (a Router
 * service without ZG_ROUTER_API_KEY). `pricer` still reads the public price, so a quote can be made
 * and a Pending payment filed for the owner; a run that finds no backend is refunded, never faked.
 */
export type BackendMissing = { error: string; notConfigured?: true; pricer?: Pick<ComputeBackendLike, 'model' | 'priceOf' | 'ledgerNeuron' | 'ledgerOptional'> };

/** Binary inputs and outputs of runs (ai-voice audio, ai-image images), keyed by intent. */
export interface BlobStore {
  put(intent: string, role: 'input' | 'output', mime: string, bytes: Uint8Array): Promise<void>;
  /** null when absent; throws when the read failed (the caller answers "unknown", never "missing"). */
  get(intent: string, role: 'input' | 'output'): Promise<{ mime: string; bytes: Uint8Array } | null>;
}

export interface Deps {
  store: Store;
  env: ComputeEnv;
  programId: string;
  now: () => number;
  /** The Service account for an id: its PDA, payee token, whether it is active; null if absent; 'error' if unread. */
  readService: (id: ComputeService) => Promise<{ address: string; payeeToken: string; active: boolean } | null | 'error'>;
  /** The gateway's own token account: the only payee a compute quote accepts. null: no gateway key; 'error': unread. */
  gatewayToken: () => Promise<string | null | 'error'>;
  spenderPda: (team: string, authority: string) => string;
  paymentPda: (spender: string, intent: string) => string;
  /** The Payment account and its owner; null when absent; 'error' when the read failed. */
  readPayment: (address: string) => Promise<PaymentView | null | 'error'>;
  /** The backend for one service, or why there is none (its key is missing): see BackendMissing. */
  backend: (service: ComputeService) => Promise<ComputeBackendLike | BackendMissing>;
  /** Audio inputs and image outputs. Absent: those services refuse to quote (503). */
  blobs?: BlobStore;
  refund: (q: Quote, reason: string) => Promise<RefundOutcome>;
  /** Durable record (Postgres). Best effort: never blocks a result. */
  record?: (row: { intent: string; team: string; spender: string; service: string; amount: bigint; status: string; resultHash?: string | null; refundSig?: string | null }) => Promise<void>;
}

export type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body: { ok: status < 400, ...body } });

async function halted(d: Deps): Promise<boolean> {
  if (!d.env.enabled) return true;
  return (await d.store.get('compute:halt')) !== null;
}

const fmt = (units: bigint) => {
  const w = units / 1_000_000n;
  const f = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${w}.${f}`;
};

// ------------------------------------------------------------------------------ quote ---

async function backendOf(d: Deps, service: ComputeService): Promise<ComputeBackendLike | BackendMissing> {
  try {
    return await d.backend(service);
  } catch {
    return { error: 'Could not reach the 0G compute network.' };
  }
}

const NOT_CONFIGURED_NOTE = (service: string) =>
  `${service} needs a 0G Private Computer key (ZG_ROUTER_API_KEY) on this server, which is not set. The price is real; if the key is still missing when the run starts, the run is refunded in full and nothing is made up.`;

/** A live price for one service: its registry entry, 0G's worst case now, and the ledger floor. */
async function livePrice(d: Deps, service: ComputeService) {
  const [svc, gatewayToken] = await Promise.all([d.readService(service), d.gatewayToken()]);
  if (gatewayToken === null) return { ok: false as const, status: 503, error: 'Compute is not configured on this server (no gateway key).' };
  if (svc === 'error' || gatewayToken === 'error') return { ok: false as const, status: 503, error: 'Could not read the service registry. Try again.' };
  if (!svc) return { ok: false as const, status: 503, error: `${service} is not registered on chain.` };
  if (!svc.active) return { ok: false as const, status: 503, error: `${service} is suspended in the registry.` };
  if (svc.payeeToken !== gatewayToken) return { ok: false as const, status: 503, error: `${service} pays an account this gateway does not hold; refusing to quote.` };
  const got = await backendOf(d, service);
  let b: Pick<ComputeBackendLike, 'model' | 'priceOf' | 'ledgerNeuron' | 'ledgerOptional'>;
  let configured = true;
  if ('error' in got) {
    if (!got.notConfigured || !got.pricer) return { ok: false as const, status: 503, error: `${service} is not configured: ${got.error}`, notConfigured: !!got.notConfigured };
    b = got.pricer;
    configured = false;
  } else b = got;
  const [price, ledger] = await Promise.all([b.priceOf(service), b.ledgerNeuron()]);
  if (!price.ok) return { ok: false as const, status: 503, error: price.reason };
  // Hard cap: the 0G ledger, with a floor so the last runs never fail for want of funds.
  if (ledger === null && !b.ledgerOptional) return { ok: false as const, status: 503, error: 'Could not read the 0G compute balance. Try again.' };
  if (ledger !== null && neuronToMicroUsd(ledger, price.usdPerZg) < d.env.ledgerFloor) return { ok: false as const, status: 503, error: 'The compute balance is below its floor; no new runs until it is topped up.' };
  const { amount, worst } = priceOf(price.maxCostNeuron, price.usdPerZg);
  return { ok: true as const, svc, model: b.model(service), amount, worst, revision: price.revision, configured };
}

export type QuoteRequest = { team: string; authority: string; service: ComputeService; prompt?: string; audio?: QuoteAudio | null };

export async function quote(d: Deps, input: QuoteRequest): Promise<Reply> {
  const checked = checkInput(input.service, input);
  if ('error' in checked) return reply(400, { error: checked.error });
  if (await halted(d)) return reply(503, { error: 'Compute is switched off on this server.' });
  if (!d.env.gatewaySecret) return reply(503, { error: 'Compute is not configured on this server (no gateway secret).' });
  const meta = SERVICE_TABLE[input.service];
  if ((checked.kind === 'audio' || meta.output !== 'text') && !d.blobs) return reply(503, { error: `${input.service} needs a result store (DATABASE_URL) on this server.` });
  const maxTokens = meta.maxOutputTokens ?? 0;

  const live = await livePrice(d, input.service);
  if (!live.ok) return reply(live.status, { error: live.error, ...(live.notConfigured ? { code: 'not_configured' } : {}) });
  const { svc, amount, worst } = live;
  const nowMs = d.now();
  const day = utcDay(nowMs);
  const [spentRaw, runsRaw] = await Promise.all([d.store.get(`spend:${day}`), d.store.get(`runs:${input.team}:${day}`)]);
  const spent = spentRaw === null ? 0n : BigInt(spentRaw);
  if (spent + worst > d.env.dailyBudget) return reply(429, { error: "Today's compute budget for this server is used up. Try again tomorrow (UTC)." });
  const runs = runsRaw === null ? 0 : Number(runsRaw);
  if (runs >= TEAM_RUNS_PER_DAY) return reply(429, { error: `This team has used its ${TEAM_RUNS_PER_DAY} compute runs for today (UTC).` });

  const spender = d.spenderPda(input.team, input.authority);
  const nonce = randomBytes(16).toString('hex');
  const intent = intentFor(d.env.gatewaySecret, { team: input.team, spender, service: input.service, amount, promptSha: checked.sha, maxTokens, nonce });
  const q: Quote = {
    v: 1,
    intent,
    team: input.team,
    authority: input.authority,
    spender,
    service: input.service,
    servicePda: svc.address,
    payeeToken: svc.payeeToken,
    model: live.model,
    amount: amount.toString(),
    worst: worst.toString(),
    maxTokens,
    promptSha: checked.sha,
    prompt: checked.kind === 'prompt' ? checked.prompt : '',
    input: checked.kind,
    ...(checked.kind === 'audio' ? { audio: { mime: checked.mime, seconds: checked.seconds, bytes: checked.bytes.length } } : {}),
    nonce,
    revision: live.revision,
    createdAt: nowMs,
  };
  // The audio is stored before the quote exists, so a quote never points at an input that is not there.
  if (checked.kind === 'audio') {
    try {
      await d.blobs!.put(intent, 'input', checked.mime, checked.bytes);
    } catch {
      return reply(503, { error: 'Could not store the audio. Nothing was quoted; try again.' });
    }
  }
  if (!(await d.store.setNX(`quote:${intent}`, JSON.stringify(q), QUOTE_TTL_SEC))) return reply(409, { error: 'Quote collision; ask again.' });
  return reply(200, {
    intent,
    service: input.service,
    model: live.model,
    input: checked.kind,
    output: meta.output,
    trust: meta.trust,
    configured: live.configured,
    ...(live.configured ? {} : { code: 'not_configured', note: NOT_CONFIGURED_NOTE(input.service) }),
    ...(checked.kind === 'audio' ? { audio: { mime: checked.mime, seconds: checked.seconds, bytes: checked.bytes.length, sha256: checked.sha } } : {}),
    amount: amount.toString(),
    amount_usdc: fmt(amount),
    max_tokens: meta.maxOutputTokens,
    spender,
    authority: input.authority,
    payee_token: svc.payeeToken,
    fake_upstream: d.env.fake,
    expires_at: new Date(nowMs + QUOTE_TTL_SEC * 1000).toISOString(),
    pay_with: { service_id: input.service, amount_base_units: amount.toString(), intent },
  });
}

/**
 * Every compute service with its state and live price (or why it has none), and what is coming
 * soon. Services not registered or suspended are listed as unavailable so a screen can say why;
 * only registered, active services can be granted or bought.
 */
export async function catalog(d: Deps): Promise<Reply> {
  const off = await halted(d);
  const entries = Object.entries(SERVICE_TABLE) as [ComputeService, (typeof SERVICE_TABLE)[ComputeService]][];
  // Read in parallel: each live price asks 0G (or the Router) for its worst case now.
  const rows = await Promise.all(entries.map(async ([id, meta]) => {
    const svc = await d.readService(id);
    if (svc === 'error') return null;
    const got = await backendOf(d, id);
    const configured = !('error' in got);
    const live = off || !svc || !svc.active ? null : await livePrice(d, id);
    const reason = off
      ? 'Compute is switched off on this server.'
      : !svc
        ? `${id} is not registered on chain yet.`
        : !svc.active
          ? `${id} is suspended in the registry.`
          : !configured
            ? 'error' in got && got.notConfigured && meta.route === 'router'
              ? 'Needs a 0G Private Computer key on this server.'
              : `Not configured: ${'error' in got ? got.error : ''}`
            : live && !live.ok
              ? live.error
              : null;
    return {
      id,
      name: meta.name,
      label: meta.label,
      model: meta.model,
      summary: meta.summary,
      kind: meta.kind,
      input: meta.input,
      output: meta.output,
      trust: meta.trust,
      trust_label: TRUST_LABEL[meta.trust],
      route: meta.route,
      configured,
      registered: !!svc,
      active: !!svc?.active,
      max_prompt_chars: meta.maxPromptChars,
      max_tokens: meta.maxOutputTokens,
      max_audio_bytes: meta.maxAudioBytes ?? null,
      max_audio_seconds: meta.maxAudioSeconds ?? null,
      audio_types: meta.input === 'audio' ? Object.values(AUDIO_MIME) : null,
      available: configured && !!live?.ok,
      price: live?.ok ? live.amount.toString() : null,
      price_usdc: live?.ok ? fmt(live.amount) : null,
      reason,
    };
  }));
  if (rows.some((r) => r === null)) return reply(503, { error: 'Could not read the service registry. Try again.' });
  const comingSoon = COMING_SOON.map((c) => ({ ...c, trust_label: TRUST_LABEL[c.trust] }));
  return reply(200, { services: rows, coming_soon: comingSoon, fake_upstream: d.env.fake });
}

// -------------------------------------------------------------------------------- run ---

async function loadQuote(d: Deps, intent: string): Promise<Quote | null> {
  const raw = await d.store.get(`quote:${intent}`);
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as Quote;
    return q && q.v === 1 && q.intent === intent ? q : null;
  } catch {
    return null;
  }
}

async function loadJson<T>(d: Deps, key: string): Promise<T | null> {
  const raw = await d.store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function refundReply(q: Quote, r: RefundOutcome): Reply {
  if (r.state === 'unavailable') return reply(503, { status: 'refund_due', intent: q.intent, error: `The run did not happen and the refund could not be sent yet: ${r.error}. Call run again to retry the refund.` });
  // An unconfirmed refund is pending, never failed, so nobody refunds twice.
  return reply(200, {
    status: 'refunded',
    intent: q.intent,
    refund: { state: r.state, signature: r.signature, amount: q.amount, amount_usdc: fmt(BigInt(q.amount)) },
    reason: r.reason,
  });
}

async function doRefund(d: Deps, q: Quote, reason: string): Promise<Reply> {
  await d.store.set(`due:${q.intent}`, reason, REFUND_TTL_SEC);
  const r = await d.refund(q, reason);
  if (r.state !== 'unavailable') {
    await d.record?.({ intent: q.intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: `refund_${r.state}`, refundSig: r.signature }).catch(() => {});
  }
  return refundReply(q, r);
}

export async function run(d: Deps, intent: string): Promise<Reply> {
  if (!INTENT_RE.test(intent)) return reply(400, { error: 'intent must be a compute intent from /api/compute/quote' });
  const q = await loadQuote(d, intent);
  if (!q) return reply(404, { error: 'No quote with that intent (it may have expired after 25 hours).' });

  const done = await loadJson<ComputeResult>(d, `result:${intent}`);
  if (done) return reply(200, { status: 'done', result: done });
  const refunded = await loadJson<{ signature: string; state: string; reason: string }>(d, `refund:${intent}`);
  if (refunded) {
    return reply(200, { status: 'refunded', intent, refund: { state: refunded.state, signature: refunded.signature, amount: q.amount, amount_usdc: fmt(BigInt(q.amount)) }, reason: refunded.reason });
  }
  const due = await d.store.get(`due:${intent}`);
  if (due) return doRefund(d, q, due);
  // A job already started for this paid intent (video): only finish it, never start another.
  const job = await loadJson<Job>(d, `job:${intent}`);
  if (job) return finishJob(d, q, job);

  // The payment record, derived here from the quoted spender and the intent. Never from the client.
  const address = d.paymentPda(q.spender, intent);
  const p = await d.readPayment(address);
  if (p === 'error') return reply(503, { status: 'unknown', error: 'Could not read the payment on chain. Try again.' });
  if (!p) return reply(402, { status: 'unpaid', payment: address, error: 'No payment for this intent yet. Pay it with the quoted service, amount and intent, then call run.' });
  if (p.owner !== d.programId) return reply(409, { status: 'invalid', error: 'The payment account is not owned by the Rein program.' });
  if (p.status === 'pending') {
    return reply(402, { status: 'pending_approval', payment: address, approve_by: p.deadline ? new Date(p.deadline * 1000).toISOString() : null, error: 'The payment is waiting for the team owner to approve it.' });
  }
  if (p.status !== 'paid' && p.status !== 'settled') return reply(409, { status: 'not_paid', payment: address, payment_status: p.status, error: `The payment was ${p.status}; nothing will run.` });
  const mismatch = [
    p.team !== q.team && 'team',
    p.spender !== q.spender && 'spender',
    p.service !== q.servicePda && 'service',
    p.payeeToken !== q.payeeToken && 'payee',
    p.amount !== BigInt(q.amount) && 'amount',
  ].filter(Boolean);
  if (mismatch.length) return reply(409, { status: 'mismatch', payment: address, error: `The payment does not match the quote (${mismatch.join(', ')}); nothing will run.` });

  // Paid for exactly this quote. From here on, anything that stops the run refunds it.
  if (await halted(d)) return doRefund(d, q, 'compute was switched off before the run');
  const backend = await backendOf(d, q.service);
  if ('error' in backend) {
    const r = await doRefund(d, q, `${q.service} is not configured on this server: ${backend.error}. Nothing ran and nothing was made up`);
    // Said as 503 not configured, with the refund in the body.
    return backend.notConfigured && r.body.status === 'refunded' ? { status: 503, body: { ...r.body, ok: false, code: 'not_configured' } } : r;
  }
  if (backend.model(q.service) !== q.model) return doRefund(d, q, 'the model changed since the quote');

  // The input the quote bound: the prompt as sent, or the stored audio whose sha256 must match.
  let input: BackendInput;
  if (q.input === 'audio') {
    let blob: { mime: string; bytes: Uint8Array } | null;
    try {
      blob = d.blobs ? await d.blobs.get(intent, 'input') : null;
    } catch {
      return reply(503, { status: 'unknown', error: 'Could not read the stored audio. Try again.' });
    }
    if (!blob || !q.audio) return doRefund(d, q, 'the audio for this quote is no longer stored');
    if (sha256Bytes(blob.bytes) !== q.promptSha) return doRefund(d, q, 'the stored audio does not match the quote');
    input = { audio: { bytes: blob.bytes, mime: q.audio.mime, seconds: q.audio.seconds } };
  } else input = { prompt: q.prompt };

  if (!(await d.store.setNX(`run:${intent}`, '1', RUN_LOCK_SEC))) return reply(409, { status: 'running', error: 'This run is already in progress. Ask for the result in a moment.' });
  const teamLock = `teamrun:${q.team}`;
  if (!(await d.store.setNX(teamLock, intent, TEAM_LOCK_SEC))) {
    await d.store.del(`run:${intent}`);
    return reply(409, { status: 'busy', error: 'This team already has a run in progress. Call run again in a few seconds.' });
  }

  try {
    const day = utcDay(d.now());
    const runsKey = `runs:${q.team}:${day}`;
    const runs = await d.store.incrBy(runsKey, 1n, 2 * 24 * 60 * 60);
    if (runs > BigInt(TEAM_RUNS_PER_DAY)) {
      await d.store.incrBy(runsKey, -1n);
      return await doRefund(d, q, `the team used its ${TEAM_RUNS_PER_DAY} runs for today`);
    }
    const worst = BigInt(q.worst);
    const spendKey = `spend:${day}`;
    const spent = await d.store.incrBy(spendKey, worst, 2 * 24 * 60 * 60);
    if (spent > d.env.dailyBudget) {
      await d.store.incrBy(spendKey, -worst);
      await d.store.incrBy(runsKey, -1n);
      return await doRefund(d, q, "the server's daily compute budget is used up");
    }

    await d.record?.({ intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: 'running' }).catch(() => {});
    if (SERVICE_TABLE[q.service].async) return await startJob(d, q, backend, input);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    let out: BackendRun;
    try {
      out = await backend.run(q.service, input, { purchaseId: intent, signal: ac.signal });
    } catch (e) {
      out = { ok: false, code: 'threw', message: String((e as Error)?.message ?? e).slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
    // A failed run keeps its spend counted: 0G may have billed part of it.
    if (!out.ok) return await doRefund(d, q, ac.signal.aborted ? 'the model did not answer in time' : `the run failed: ${out.message}`);
    const meta = SERVICE_TABLE[q.service];
    const o = out.output;
    if (o.kind !== meta.output) return await doRefund(d, q, `the model answered with ${o.kind}, not ${meta.output}`);
    let delivered: Pick<ComputeResult, 'output' | 'text' | 'mime' | 'bytes' | 'url' | 'resultHash'>;
    if (o.kind === 'text') {
      if (!o.text.trim()) return await doRefund(d, q, 'the model returned no text');
      delivered = { output: 'text', text: o.text, resultHash: sha256Hex(o.text) };
    } else if (o.kind === 'video') {
      return await doRefund(d, q, 'a clip came back from a run that is not a job');
    } else {
      // Only bytes that are an image by their own header, and not too large, are kept and served.
      const mime = sniffImage(o.bytes);
      if (!mime || o.bytes.length > IMAGE_MAX_BYTES) return await doRefund(d, q, 'the provider did not return a usable image');
      try {
        await d.blobs!.put(intent, 'output', mime, o.bytes);
      } catch {
        return await doRefund(d, q, 'the image was made but could not be stored, so it could not be delivered');
      }
      delivered = { output: 'image', text: '', mime, bytes: o.bytes.length, url: blobUrl(intent), resultHash: sha256Bytes(o.bytes) };
    }

    const result: ComputeResult = {
      intent,
      service: q.service,
      model: q.model,
      ...delivered,
      trust: meta.trust,
      fake: out.fake,
      verified: out.verified,
      covers: out.covers,
      provider: out.provider,
      costNeuron: out.costNeuron === null ? null : out.costNeuron.toString(),
      createdAt: d.now(),
    };
    await d.store.set(`result:${intent}`, JSON.stringify(result), RESULT_TTL_SEC);
    await d.record?.({ intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: 'done', resultHash: result.resultHash }).catch(() => {});
    return reply(200, { status: 'done', result });
  } finally {
    await d.store.del(teamLock).catch(() => {});
    await d.store.del(`run:${intent}`).catch(() => {});
  }
}

// -------------------------------------------------------------------------------- jobs ---

type Job = { jobId: string; startedAt: number };

/** Starts the job of a paid async run (video) and returns at once; the result endpoint finishes it. */
async function startJob(d: Deps, q: Quote, backend: ComputeBackendLike, input: BackendInput): Promise<Reply> {
  if (!backend.startJob || !backend.pollJob) return doRefund(d, q, `${q.service} has no job runner on this server`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  let started: Awaited<ReturnType<NonNullable<ComputeBackendLike['startJob']>>>;
  try {
    started = await backend.startJob(q.service, input, { purchaseId: q.intent, signal: ac.signal });
  } catch (e) {
    started = { ok: false, code: 'threw', message: String((e as Error)?.message ?? e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
  // Refused before a job existed: nothing was made, so the full price goes back.
  if (!started.ok) return doRefund(d, q, ac.signal.aborted ? 'the video job did not start in time' : `the video job did not start: ${started.message}`);
  const job: Job = { jobId: started.jobId, startedAt: d.now() };
  await d.store.set(`job:${q.intent}`, JSON.stringify(job), RESULT_TTL_SEC);
  await d.record?.({ intent: q.intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: 'job_started' }).catch(() => {});
  return reply(202, { status: 'running', intent: q.intent, note: 'The clip is being made. Ask for the result until it is done; it usually takes a minute or two.' });
}

/**
 * One look at a started job: still running (202), finished (the clip is stored and the result kept),
 * or failed (refunded). An unreadable status is never a failure: the job may still finish and be
 * billed, so it stays running until JOB_DEADLINE_MS, and only then is the price refunded.
 */
async function finishJob(d: Deps, q: Quote, job: Job): Promise<Reply> {
  const running = (note?: string) => reply(202, { status: 'running', intent: q.intent, ...(note ? { note } : {}) });
  if (!(await d.store.setNX(`jobpoll:${q.intent}`, '1', JOB_POLL_LOCK_SEC))) return running();
  try {
    const done = await loadJson<ComputeResult>(d, `result:${q.intent}`);
    if (done) return reply(200, { status: 'done', result: done });
    if (await d.store.get(`refund:${q.intent}`)) return result(d, q.intent);
    const late = d.now() - job.startedAt > JOB_DEADLINE_MS;
    const backend = await backendOf(d, q.service);
    if ('error' in backend || !backend.pollJob) {
      return late ? doRefund(d, q, 'the clip could not be collected in time') : running(`The job cannot be checked right now: ${'error' in backend ? backend.error : 'no job runner'}.`);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    let p: JobPoll;
    try {
      p = await backend.pollJob(q.service, job.jobId, { signal: ac.signal });
    } catch (e) {
      p = { state: 'unknown', message: String((e as Error)?.message ?? e).slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
    if (p.state === 'running' || p.state === 'unknown') return late ? doRefund(d, q, 'the clip did not arrive within 30 minutes') : running();
    if (p.state === 'failed') return doRefund(d, q, `the video job failed: ${p.message}`);
    const o = p.output;
    if (o.kind !== 'video') return doRefund(d, q, `the job answered with ${o.kind}, not a clip`);
    const mime = sniffVideo(o.bytes);
    if (!mime || o.bytes.length > VIDEO_MAX_BYTES) return doRefund(d, q, mime ? 'the clip is too large to deliver' : 'the job did not return a usable clip');
    try {
      await d.blobs!.put(q.intent, 'output', mime, o.bytes);
    } catch {
      return running('The clip is ready but could not be stored yet.');
    }
    const meta = SERVICE_TABLE[q.service];
    const res: ComputeResult = {
      intent: q.intent,
      service: q.service,
      model: q.model,
      output: 'video',
      text: '',
      mime,
      bytes: o.bytes.length,
      url: blobUrl(q.intent),
      trust: meta.trust,
      fake: p.fake,
      verified: p.verified,
      covers: p.covers,
      provider: p.provider,
      costNeuron: p.costNeuron === null ? null : p.costNeuron.toString(),
      resultHash: sha256Bytes(o.bytes),
      createdAt: d.now(),
    };
    await d.store.set(`result:${q.intent}`, JSON.stringify(res), RESULT_TTL_SEC);
    await d.record?.({ intent: q.intent, team: q.team, spender: q.spender, service: q.service, amount: BigInt(q.amount), status: 'done', resultHash: res.resultHash }).catch(() => {});
    return reply(200, { status: 'done', result: res });
  } finally {
    await d.store.del(`jobpoll:${q.intent}`).catch(() => {});
  }
}

// ----------------------------------------------------------------------------- result ---

/** Where an image result is served. The intent is the capability (an unguessable HMAC). */
export const blobUrl = (intent: string) => `/api/compute/result/${intent}/blob`;

/** The bytes of an image result, or why not. Served only as an image type told by the bytes themselves. */
export async function resultBlob(d: Deps, intent: string): Promise<{ ok: true; mime: string; bytes: Uint8Array } | Reply> {
  if (!INTENT_RE.test(intent)) return reply(400, { error: 'not a compute intent' });
  if (!d.blobs) return reply(503, { error: 'Results are not stored on this server (no DATABASE_URL).' });
  let blob: { mime: string; bytes: Uint8Array } | null;
  try {
    blob = await d.blobs.get(intent, 'output');
  } catch {
    return reply(503, { error: 'The result could not be read. Try again.' });
  }
  if (!blob) return reply(404, { error: 'No image or clip for that intent.' });
  const mime = sniffMedia(blob.bytes);
  if (!mime || mime !== blob.mime) return reply(404, { error: 'No image or clip for that intent.' });
  return { ok: true, mime, bytes: blob.bytes };
}

export async function result(d: Deps, intent: string): Promise<Reply> {
  if (!INTENT_RE.test(intent)) return reply(400, { error: 'not a compute intent' });
  const done = await loadJson<ComputeResult>(d, `result:${intent}`);
  if (done) return reply(200, { status: 'done', result: done });
  const refunded = await loadJson<{ signature: string; state: string; reason: string }>(d, `refund:${intent}`);
  if (refunded) return reply(200, { status: 'refunded', intent, refund: { state: refunded.state, signature: refunded.signature }, reason: refunded.reason });
  // A started job (video) is finished by whoever asks for its result: one status read per call.
  const job = await loadJson<Job>(d, `job:${intent}`);
  if (job) {
    const q = await loadQuote(d, intent);
    if (q) return finishJob(d, q, job);
  }
  if (await d.store.get(`run:${intent}`)) return reply(202, { status: 'running' });
  if (await d.store.get(`quote:${intent}`)) return reply(404, { status: 'not_run', error: 'Quoted but not run yet. Pay it, then call run.' });
  return reply(404, { status: 'unknown', error: 'No result for that intent.' });
}
