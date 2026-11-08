import {closedModel, type RunOutput} from "./commerce/index";
import {randomBytes} from "node:crypto";
import {ZgFailure, describe} from "./failure";
import {call, ensureOk, headerSummary, readCapped, readText, resKey, sleep, stopped, type Fetch} from "./http";
import {fromAnthropicMessage} from "./anthropic";
import {VIDEO_SECONDS, VIDEO_SIZE, type Usage} from "./pricing";
import type {ResolvedProvider} from "./providers";
import type {ZgPort} from "./port";
import {checkStoredSignature, fetchStoredSignature, sha256Hex} from "./verify";

/*
 * The four requests, in the shapes the providers serve (OpenAI-compatible, under {url}/v1/proxy):
 *
 *   chat   POST /chat/completions        JSON, thinking off so max_tokens all goes to the answer
 *   voice  POST /audio/transcriptions    multipart: file, model, response_format=json
 *   image  POST /images/generations      JSON, n=1, response_format=b64_json (a 202 job is polled)
 *   video  POST /videos                  multipart: model, prompt, seconds, size; then poll
 *          GET /videos/{id} until terminal, then GET /videos/{id}/content for the MP4
 *
 * Each returns the output, the usage the provider reported, a `check` that verifies the response's
 * signature once (the caller retries it and fails closed), and the hashes the signed text must
 * contain: the exact request bytes sent and the exact bytes delivered. Multipart bodies are built
 * here rather than by FormData so their bytes are known.
 */

export interface RunState {
  signal: AbortSignal;
  timedOut: () => boolean;
}

export interface OpContext {
  fetch: Fetch;
  port: ZgPort;
  provider: ResolvedProvider;
  run: RunState;
  emit: (e: ZgEvent) => void;
  pollMs: number;
}

export type ZgEvent = {type: string; [k: string]: unknown};

/** SHA-256 hex digests the provider's signed text must contain; null when not checkable. */
export interface Binding {
  request: string | null;
  response: string | null;
}

export interface OpResult {
  output: RunOutput;
  chatId: string | null;
  usage: Usage;
  check: () => Promise<boolean | null>;
  binding: Binding;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

async function headers(ctx: OpContext, contentType: string | null): Promise<Record<string, string>> {
  let auth: Record<string, string>;
  try {
    auth = await ctx.port.authHeaders(ctx.provider.provider);
  } catch (err) {
    throw new ZgFailure("acknowledge_failed", `auth headers: ${describe(err)}`);
  }
  return contentType ? {"content-type": contentType, ...auth} : {...auth};
}

const processCheck = (ctx: OpContext, chatId: string | null, usage?: string) => async () => {
  if (!chatId) return null;
  return ctx.port.processResponse(ctx.provider.provider, chatId, usage);
};

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

function parse<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ZgFailure("output_unreadable", `${what}: body is not JSON: ${text.slice(0, 200)}`);
  }
}

type Part = {name: string; value: string} | {name: string; filename: string; type: string; bytes: Uint8Array};

/** multipart/form-data with known bytes. */
export function multipart(parts: Part[]): {body: Uint8Array; contentType: string} {
  const boundary = `----rein${randomBytes(12).toString("hex")}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    if ("bytes" in p) {
      chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.type}\r\n\r\n`), p.bytes, enc.encode("\r\n"));
    } else {
      chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`));
    }
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  return {body, contentType: `multipart/form-data; boundary=${boundary}`};
}

const asBody = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

// --- chat --------------------------------------------------------------------------------------

/** An Anthropic Messages answer as OpenAI chat JSON text; a body that is not one is "output_unreadable". */
function toOpenAiText(raw: string, model: string): string {
  try {
    return JSON.stringify(fromAnthropicMessage(JSON.parse(raw), model));
  } catch (err) {
    throw new ZgFailure("output_unreadable", `chat answered something that is not an Anthropic message: ${describe(err)}`);
  }
}

/**
 * The chat request body. A model that runs in the provider's enclave (0GM) gets thinking turned off
 * (`chat_template_kwargs` is its server's template switch). A closed model relayed or routed to its
 * vendor (Claude, GPT) gets a plain OpenAI chat body: no template switch, which a vendor API does not
 * know, and never `cache_control`, so its prompt is billed as plain input, never as a cache write.
 */
export function chatRequestBody(provider: Pick<ResolvedProvider, "model" | "trust"> & {format?: ResolvedProvider["format"]}, prompt: string, maxTokens: number): string {
  // Claude's providers take Anthropic's Messages API only (anthropic.ts).
  if (provider.format === "anthropic") {
    return JSON.stringify({model: provider.model, max_tokens: maxTokens, messages: [{role: "user", content: prompt}], ...(closedModel(provider.model)?.thinkingOff ? {thinking: {type: "disabled"}} : {})});
  }
  const base = {model: provider.model, messages: [{role: "user", content: prompt}], max_tokens: maxTokens, stream: false};
  return JSON.stringify(provider.trust === "model-in-enclave" ? {...base, chat_template_kwargs: {enable_thinking: false}} : base);
}

export async function runChat(ctx: OpContext, prompt: string, maxTokens: number): Promise<OpResult> {
  const body = chatRequestBody(ctx.provider, prompt, maxTokens);
  const anthropic = ctx.provider.format === "anthropic";
  const path = anthropic ? "messages" : "chat/completions";
  const res = await call(ctx.fetch, `${ctx.provider.endpoint}/${path}`, {method: "POST", headers: await headers(ctx, "application/json"), body}, ctx.run, "chat");
  ctx.emit({type: "http", what: "chat", status: res.status, headers: headerSummary(res)});
  await ensureOk(res, "chat");
  const raw = await readText(res, "chat", ctx.run);
  const answer = anthropic ? toOpenAiText(raw, ctx.provider.model) : raw;
  const json = parse<{
    id?: unknown;
    usage?: {prompt_tokens?: unknown; completion_tokens?: unknown; input_tokens?: unknown; output_tokens?: unknown};
    choices?: {message?: {content?: unknown; reasoning_content?: unknown}; finish_reason?: unknown}[];
  }>(answer, "chat");
  const chatId = resKey(res) ?? (typeof json.id === "string" && json.id ? json.id : null);
  const msg = json.choices?.[0]?.message;
  const content = (typeof msg?.content === "string" ? msg.content : "").trim();
  // 0GM-1.0-35B-A3B puts its answer in reasoning_content (content null) when thinking is on. A closed
  // model's reasoning_content is its thinking, not its answer: no content there is an empty answer.
  const enclave = ctx.provider.trust === "model-in-enclave";
  const text = content || (enclave && typeof msg?.reasoning_content === "string" ? msg.reasoning_content : "").trim();
  if (!text) throw new ZgFailure("empty_output", `chat returned no content (chat id ${chatId ?? "none"})`);
  ctx.emit({type: "chat.response", chatId, finish: json.choices?.[0]?.finish_reason, usage: json.usage, chars: text.length});
  const usage = json.usage ? JSON.stringify(json.usage) : undefined;
  return {
    output: {kind: "text", text},
    chatId,
    // OpenAI's names, or Anthropic's when a relay passes its vendor's usage through unchanged.
    usage: {promptTokens: num(json.usage?.prompt_tokens) ?? num(json.usage?.input_tokens), completionTokens: num(json.usage?.completion_tokens) ?? num(json.usage?.output_tokens)},
    // A relayed provider signs nothing: there is no check to make (the SDK would answer false).
    check: ctx.provider.trust === "relayed" ? async () => null : processCheck(ctx, chatId, usage),
    binding: {request: sha256Hex(body), response: sha256Hex(raw)},
  };
}

// --- voice -------------------------------------------------------------------------------------

const AUDIO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
};

export function decodeBase64(b64: string): Uint8Array | null {
  const clean = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/** Seconds billed from a transcription's usage ({"type":"duration","seconds":N}), if reported. */
export function audioSecondsFromUsage(usage: unknown): number | undefined {
  const u = usage as {type?: unknown; seconds?: unknown; duration?: unknown} | undefined;
  if (!u || typeof u !== "object") return undefined;
  return num(u.seconds) ?? num(u.duration);
}

export async function runVoice(ctx: OpContext, audio: {bytes: Uint8Array; mimeType: string}): Promise<OpResult> {
  const ext = AUDIO_EXT[audio.mimeType] ?? "bin";
  const form = multipart([
    {name: "file", filename: `audio.${ext}`, type: audio.mimeType, bytes: audio.bytes},
    {name: "model", value: ctx.provider.model},
    {name: "response_format", value: "json"},
  ]);
  const res = await call(ctx.fetch, `${ctx.provider.endpoint}/audio/transcriptions`, {method: "POST", headers: await headers(ctx, form.contentType), body: asBody(form.body)}, ctx.run, "voice");
  ctx.emit({type: "http", what: "voice", status: res.status, headers: headerSummary(res)});
  await ensureOk(res, "voice");
  const raw = await readText(res, "voice", ctx.run);
  const json = parse<{text?: unknown; usage?: unknown; duration?: unknown}>(raw, "voice");
  const chatId = resKey(res);
  const text = typeof json.text === "string" ? json.text.trim() : "";
  if (!text) throw new ZgFailure("empty_output", `transcription returned no text (chat id ${chatId ?? "none"})`);
  ctx.emit({type: "voice.response", chatId, usage: json.usage ?? null, keys: Object.keys(json)});
  const usage = json.usage ? JSON.stringify(json.usage) : undefined;
  return {
    output: {kind: "text", text},
    chatId,
    usage: {audioSeconds: audioSecondsFromUsage(json.usage) ?? num(json.duration)},
    check: processCheck(ctx, chatId, usage),
    binding: {request: sha256Hex(form.body), response: sha256Hex(raw)},
  };
}

// --- image -------------------------------------------------------------------------------------

/** The image type from its first bytes; null when it is not an image we know. */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function download(ctx: OpContext, url: string, what: string, max: number, auth: boolean): Promise<{bytes: Uint8Array; contentType: string | null}> {
  if (!/^https:\/\//.test(url)) throw new ZgFailure("output_unreadable", `${what}: refused a non-https URL`);
  let last: ZgFailure | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await call(ctx.fetch, url, {headers: auth ? await headers(ctx, null) : {}}, ctx.run, what);
      ctx.emit({type: "http", what, status: res.status, headers: headerSummary(res)});
      await ensureOk(res, what);
      // Read up to the cap and no further: a body that runs on past it is cut off, not buffered.
      const bytes = await readCapped(res, max);
      return {bytes, contentType: res.headers.get("content-type")};
    } catch (err) {
      if (ctx.run.signal.aborted) throw stopped(ctx.run, what);
      last = err instanceof ZgFailure ? new ZgFailure("download_failed", err.failure.detail ?? err.message) : new ZgFailure("download_failed", `${what}: ${describe(err)}`);
      if (attempt < 3) await sleep(1_000 * attempt, ctx.run.signal);
    }
  }
  throw last ?? new ZgFailure("download_failed", what);
}

type ImageData = {data?: {b64_json?: unknown; url?: unknown}[]};

async function imageFrom(ctx: OpContext, json: ImageData): Promise<{bytes: Uint8Array; mimeType: string}> {
  const first = json.data?.[0];
  let bytes: Uint8Array | null = null;
  if (typeof first?.b64_json === "string") bytes = decodeBase64(first.b64_json);
  else if (typeof first?.url === "string") bytes = (await download(ctx, first.url, "image download", MAX_IMAGE_BYTES, false)).bytes;
  if (!bytes || bytes.length === 0) throw new ZgFailure("empty_output", "image response had no image");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ZgFailure("output_unreadable", `image is ${bytes.length} bytes`);
  const mimeType = sniffImage(bytes);
  if (!mimeType) throw new ZgFailure("output_unreadable", "image bytes are not PNG, JPEG or WebP");
  return {bytes, mimeType};
}

const PENDING = new Set(["pending", "queued", "processing", "in_progress", "running", "submitted"]);

export async function runImage(ctx: OpContext, prompt: string): Promise<OpResult> {
  const body = JSON.stringify({model: ctx.provider.model, prompt, n: 1, size: "1024x1024", response_format: "b64_json"});
  const res = await call(ctx.fetch, `${ctx.provider.endpoint}/images/generations`, {method: "POST", headers: await headers(ctx, "application/json"), body}, ctx.run, "image");
  ctx.emit({type: "http", what: "image", status: res.status, headers: headerSummary(res)});
  await ensureOk(res, "image");
  let chatId = resKey(res);
  let json = parse<ImageData & {jobId?: unknown}>(await readText(res, "image", ctx.run), "image");

  // An async provider answers 202 with a job; poll it (0G SDK README, "async request").
  if (typeof json.jobId === "string" && !json.data) {
    const jobUrl = `${ctx.provider.url}/v1/async/jobs/${encodeURIComponent(json.jobId)}`;
    for (;;) {
      await sleep(ctx.pollMs, ctx.run.signal);
      if (ctx.run.signal.aborted) throw stopped(ctx.run, "image job");
      const poll = await call(ctx.fetch, jobUrl, {headers: await headers(ctx, null)}, ctx.run, "image job");
      ctx.emit({type: "http", what: "image job", status: poll.status, headers: headerSummary(poll)});
      await ensureOk(poll, "image job");
      chatId = resKey(poll) ?? chatId;
      const job = parse<{status?: unknown; data?: ImageData; errorMessage?: unknown}>(await readText(poll, "image job", ctx.run), "image job");
      const status = typeof job.status === "string" ? job.status.toLowerCase() : "";
      if (PENDING.has(status)) continue;
      if (status !== "completed" && status !== "succeeded") throw new ZgFailure("output_unreadable", `image job ended ${status || "without a status"}: ${String(job.errorMessage ?? "").slice(0, 200)}`);
      json = job.data ?? {};
      break;
    }
  }
  const image = await imageFrom(ctx, json);
  ctx.emit({type: "image.response", chatId, mimeType: image.mimeType, bytes: image.bytes.length, sha256: sha256Hex(image.bytes)});
  return {
    output: {kind: "image", mimeType: image.mimeType, bytes: image.bytes},
    chatId,
    usage: {images: 1},
    check: processCheck(ctx, chatId),
    // A decentralized image provider signs sha256(request):sha256(image), so the proof covers the
    // exact image delivered (seen live: PROBE.md).
    binding: {request: sha256Hex(body), response: sha256Hex(image.bytes)},
  };
}

// --- video -------------------------------------------------------------------------------------

const DONE = new Set(["completed", "succeeded", "success"]);
const FAILED = new Set(["failed", "cancelled", "canceled", "expired", "error"]);
const REFUSAL = /polic|sensitive|moderat|safety|inappropriate|prohibit|violat|risk/i;

interface VideoJob {
  id?: unknown;
  status?: unknown;
  error?: unknown;
  usage?: {completion_tokens?: unknown};
}

export async function runVideo(ctx: OpContext, prompt: string): Promise<OpResult> {
  const form = multipart([
    {name: "model", value: ctx.provider.model},
    {name: "prompt", value: prompt},
    {name: "seconds", value: String(VIDEO_SECONDS)},
    {name: "size", value: VIDEO_SIZE},
  ]);
  const res = await call(ctx.fetch, `${ctx.provider.endpoint}/videos`, {method: "POST", headers: await headers(ctx, form.contentType), body: asBody(form.body)}, ctx.run, "video");
  ctx.emit({type: "http", what: "video", status: res.status, headers: headerSummary(res)});
  await ensureOk(res, "video");
  let chatId = resKey(res);
  const createText = await readText(res, "video", ctx.run);
  let job = parse<VideoJob>(createText, "video");
  const id = typeof job.id === "string" ? job.id : null;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ZgFailure("output_unreadable", "video create returned no usable job id");
  ctx.emit({type: "video.created", id, status: job.status, chatId, createSha256: sha256Hex(createText), requestSha256: sha256Hex(form.body)});
  // The proof stored for the create response, so the final check can tell it from the final one.
  let createProof: string | null = null;
  if (chatId) {
    try {
      createProof = (await fetchStoredSignature(ctx.fetch, ctx.provider, chatId, ctx.run.signal))?.text ?? null;
    } catch {
      createProof = null;
    }
    ctx.emit({type: "video.createProof", text: createProof?.slice(0, 400) ?? null, commitsToCreate: createProof ? createProof.toLowerCase().includes(sha256Hex(createText)) : null});
  }

  let status = typeof job.status === "string" ? job.status.toLowerCase() : "";
  let finalText = createText;
  while (!DONE.has(status) && !FAILED.has(status)) {
    await sleep(ctx.pollMs, ctx.run.signal);
    if (ctx.run.signal.aborted) throw stopped(ctx.run, "video job");
    const poll = await call(ctx.fetch, `${ctx.provider.endpoint}/videos/${id}`, {headers: await headers(ctx, null)}, ctx.run, "video job");
    if (poll.status === 429 || poll.status >= 500) {
      ctx.emit({type: "http", what: "video job", status: poll.status});
      continue; // the job keeps running; a busy status read is not a failed clip
    }
    await ensureOk(poll, "video job");
    chatId = resKey(poll) ?? chatId;
    finalText = await readText(poll, "video job", ctx.run);
    job = parse<VideoJob>(finalText, "video job");
    status = typeof job.status === "string" ? job.status.toLowerCase() : "";
    ctx.emit({type: "video.status", status, progress: (job as {progress?: unknown}).progress});
  }
  if (FAILED.has(status)) {
    const why = JSON.stringify(job.error ?? "").slice(0, 300);
    throw new ZgFailure(REFUSAL.test(why) ? "video_refused" : "video_failed", `video job ${status}: ${why}`);
  }
  const tokens = num(job.usage?.completion_tokens);
  ctx.emit({type: "video.done", usage: job.usage ?? null, finalSha256: sha256Hex(finalText), finalKeys: Object.keys(job), chatId});

  const {bytes, contentType} = await download(ctx, `${ctx.provider.endpoint}/videos/${id}/content`, "video content", MAX_VIDEO_BYTES, true);
  if (bytes.length < 12) throw new ZgFailure("empty_output", "video content is empty");
  const mimeType = contentType && /^video\//.test(contentType) ? contentType.split(";")[0]!.trim() : "video/mp4";
  const key = chatId;
  const createHash = sha256Hex(createText);
  return {
    output: {kind: "video", mimeType, bytes},
    chatId: key,
    usage: {videoTokens: tokens},
    // processResponse cannot check video in SDK 0.9.0 (no extractor), so the same check is made
    // directly. The provider re-signs under the same key once its own poll sees the final status;
    // until then the stored text is the create-time proof, so that one is not accepted.
    check: async () => {
      if (!key) return null;
      const r = await checkStoredSignature(ctx.fetch, ctx.provider, key, ctx.run.signal);
      const text = r.signed?.text.toLowerCase() ?? "";
      ctx.emit({type: "video.signature", result: r.result, text: r.signed?.text.slice(0, 400) ?? null, commitsToCreate: text.includes(createHash), commitsToFinal: text.includes(sha256Hex(finalText))});
      const stillCreate = (createProof !== null && r.signed?.text === createProof) || (text.includes(createHash) && createHash !== sha256Hex(finalText));
      if (r.result === true && stillCreate) return null;
      return r.result;
    },
    // The final proof commits to the final status JSON (with the billed token count), not the MP4.
    binding: {request: sha256Hex(form.body), response: sha256Hex(finalText)},
  };
}
