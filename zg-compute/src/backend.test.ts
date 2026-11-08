import {readFileSync} from "node:fs";
import {join} from "node:path";
import {OPERATIONS, operationById, type Operation, type RunOutcome} from "./commerce/index";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";
import {describe, expect, it} from "vitest";
import {BINDING, coversOf, createZgComputeWith, DEFAULT_TIMEOUTS_MS, isZgOperation, type ZgComputeOptions} from "./backend";
import {FAILURES} from "./failure";
import {catalogAt, fakeFetch, fakePort, json, liveCatalogs, liveServices, PROVIDERS, service, STANDARD, VIDEO_CATALOG, ZG} from "./test-helpers";
import {sha256Hex} from "./verify";

const op = (id: string) => operationById(id) as Operation;
/** The 4.9 s spoken clip the live probe transcribed. */
const SPEECH = readFileSync(join(__dirname, "..", "fixtures", "audio", "speech-4.9s.mp3"));
const PNG =new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 9, 9]);

const chatBody = (content: string | null = "A policy sets limits.") => ({
  id: "cmpl-1",
  choices: [{message: {content}, finish_reason: "stop"}],
  usage: {prompt_tokens: 46, completion_tokens: 34},
});

/** Never answers until its signal aborts. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {name: "AbortError"})));
  });

/*
 * The fake providers sign like the live ones: the text stored under a response key is
 * sha256(request):sha256(response body), signed EIP-191 by SIGNER, which every default service
 * names as its TEE signer.
 */
const SIGNER = privateKeyToAccount(generatePrivateKey());
const proofs = new Map<string, string>();
const prove = (key: string, request: string | Uint8Array, response: string | Uint8Array) => proofs.set(key, `${sha256Hex(request)}:${sha256Hex(response)}`);

/** A JSON answer whose stored proof covers the request it answers and its own exact bytes. */
function signedJson(key: string, body: unknown, init: RequestInit) {
  const raw = JSON.stringify(body);
  prove(key, (init.body as string | Uint8Array | undefined) ?? "", raw);
  return new Response(raw, {headers: {"content-type": "application/json", "ZG-Res-Key": key}});
}

const routes = {
  router: ["router-api.0g.ai", () => json(catalogAt(0.25))] as [string, () => Response],
  unsettled: ["/unsettledfee", () => json({userAddress: "x", unsettledFee: "0"})] as [string, () => Response],
  chat: ["/chat/completions", (_u: string, init: RequestInit) => signedJson("chat-key", chatBody(), init)] as [string, (u: string, i: RequestInit) => Response],
  signature: [
    /\/v1\/proxy\/signature\//,
    async (url: string) => {
      const key = decodeURIComponent(url.split("/v1/proxy/signature/")[1]!.split("?")[0]!);
      const text = proofs.get(key);
      return text ? json({text, signature: await SIGNER.signMessage({message: text})}) : new Response("", {status: 404});
    },
  ] as [RegExp, (u: string) => Promise<Response>],
};

const signedServices = () => liveServices({chat: SIGNER.address, voice: SIGNER.address, image: SIGNER.address, video: SIGNER.address});

async function setup(over: {port?: Parameters<typeof fakePort>[0]; fetch?: Parameters<typeof fakeFetch>[0]; opts?: ZgComputeOptions} = {}) {
  const port = fakePort({services: signedServices(), ...over.port});
  const f = fakeFetch([...(over.fetch ?? []), routes.router, routes.unsettled, routes.chat, routes.signature]);
  const compute = await createZgComputeWith(port, {fetch: f, pollMs: 0, verify: {backoffMs: 0, videoBackoffMs: 0}, ...over.opts});
  return {port, f, compute};
}

const failed = (o: RunOutcome) => {
  if (o.ok) throw new Error("expected a failure");
  return o;
};

describe("run: chat", () => {
  it("opens the ledger, funds and acknowledges the provider, runs, verifies and reports cost", async () => {
    const {port, f, compute} = await setup();
    const out = await compute.run(op("chat"), {prompt: "What is a spending policy?"}, {purchaseId: "q1"});
    expect(out).toMatchObject({ok: true, output: {kind: "text", text: "A policy sets limits."}, proof: {provider: PROVIDERS.chat, model: "0GM-1.0-35B-A3B", chatId: "chat-key", verified: true, covers: "output", vendor: null}});
    if (out.ok) expect(out.costNeuron).toBe(46n * 320_000_000_000n + 34n * 1_920_000_000_000n);
    expect(port.state.writes).toEqual(["addLedger 3", `transferFund ${PROVIDERS.chat} ${ZG + 5_826_560_000_000_000n + ZG / 20n}`, `acknowledge ${PROVIDERS.chat}`]);
    const call = f.calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(call.url).toBe("https://chat.example/v1/proxy/chat/completions");
    expect(JSON.parse(String(call.init.body))).toMatchObject({model: "0GM-1.0-35B-A3B", max_tokens: 1024, chat_template_kwargs: {enable_thinking: false}});
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer test");
  });

  it("re-reads the balance every run and sends nothing when it still covers the run", async () => {
    const {port, compute} = await setup();
    await compute.run(op("chat"), {prompt: "one"}, {purchaseId: "q1"});
    port.state.writes.length = 0;
    expect((await compute.run(op("chat"), {prompt: "two"}, {purchaseId: "q2"})).ok).toBe(true);
    expect(port.state.writes).toEqual([]);
  });

  it("reads the answer from reasoning_content when content is empty", async () => {
    const body = {...chatBody(null), choices: [{message: {content: null, reasoning_content: "From reasoning."}}]};
    const {compute} = await setup({fetch: [["/chat/completions", (_u, init) => signedJson("k", body, init)]]});
    expect(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"})).toMatchObject({ok: true, output: {text: "From reasoning."}});
  });
});

describe("run: refusals before any money moves", () => {
  it("refuses an invalid input in the person's words", async () => {
    const {port, compute} = await setup();
    expect(failed(await compute.run(op("chat"), {prompt: "  "}, {purchaseId: "q"}))).toMatchObject({code: "input_invalid", retryable: false, message: "Write a prompt first."});
    expect(failed(await compute.run(op("voice"), {audio: {base64: "!!", mimeType: "audio/mpeg", seconds: 3}}, {purchaseId: "q"}))).toMatchObject({code: "input_invalid"});
    expect(port.state.writes).toEqual([]);
  });

  it("refuses when no TeeML, acknowledged provider serves the model", async () => {
    const {port, f, compute} = await setup({port: {services: [service({verifiability: "TeeTLS"})]}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "no_provider", retryable: false});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("never deposits past the ledger cap", async () => {
    const {port, f, compute} = await setup({port: {ledger: {availableBalance: 0n, totalBalance: 9n * ZG + ZG / 2n}}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "ledger_cap", retryable: false});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("honours a lower cap from the config", async () => {
    const {port, compute} = await setup({opts: {maxLedgerZg: 2}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "ledger_cap"});
    expect(port.state.writes).toEqual([]);
  });

  it("says the float is too low when the wallet cannot cover the deposit and gas", async () => {
    const {compute} = await setup({port: {wallet: 2n * ZG}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "ledger_unfunded", retryable: false});
  });

  it("says the balance could not be read when the chain read fails", async () => {
    const port = fakePort({services: signedServices()});
    const compute = await createZgComputeWith({...port, getLedger: () => Promise.reject(new Error("timeout"))}, {fetch: fakeFetch([routes.router])});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "ledger_unreadable", retryable: true});
    expect(port.state.writes).toEqual([]);
  });

  it("stops before anything when the caller has already aborted", async () => {
    const {port, compute} = await setup();
    const ctl = new AbortController();
    ctl.abort();
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q", signal: ctl.signal}))).toMatchObject({code: "aborted", retryable: true});
    expect(port.state.writes).toEqual([]);
  });
});

describe("run: provider failures map to codes, never raw text", () => {
  const cases: [number, string, string, boolean][] = [
    [429, "rate limited", "provider_busy", true],
    [400, "insufficient balance: your locked balance is 1.0 0G", "provider_balance", true],
    [400, "bad request: max_tokens", "provider_rejected", false],
    [503, "upstream down", "provider_unavailable", true],
    [401, "session token has been revoked", "provider_unavailable", true],
  ];
  for (const [status, body, code, retryable] of cases) {
    it(`${status} ${code}`, async () => {
      const {compute} = await setup({fetch: [["/chat/completions", () => new Response(body, {status})]]});
      const out = failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}));
      expect(out).toMatchObject({code, retryable, message: FAILURES[code as keyof typeof FAILURES].message});
      expect(out.message).not.toContain(body.slice(0, 10));
    });
  }

  it("returns only code, retryable and message: the provider's words go to the log", async () => {
    const events: Record<string, unknown>[] = [];
    const {compute} = await setup({
      fetch: [["/chat/completions", () => new Response("upstream exploded: secret-ish detail", {status: 400})]],
      opts: {onEvent: (e) => events.push(e)},
    });
    const out = await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"});
    expect(Object.keys(out).sort()).toEqual(["code", "message", "ok", "retryable"]);
    expect(JSON.stringify(out)).not.toContain("exploded");
    expect(events.find((e) => e.type === "run.fail")?.detail).toContain("upstream exploded");
  });

  it("never puts the auth header or its token into an event or an outcome", async () => {
    const events: unknown[] = [];
    const port = fakePort({services: signedServices(), catalogs: liveCatalogs()});
    port.authHeaders = async () => ({Authorization: "Bearer app-sk-SECRET-SESSION-TOKEN"});
    const routes2: Parameters<typeof fakeFetch>[0] = [
      ["/chat/completions", (_u, init) => (String(init.body).includes("fail") ? new Response("denied for Bearer app-sk-SECRET-SESSION-TOKEN", {status: 401}) : signedJson("k", chatBody(), init))],
      routes.router,
      routes.unsettled,
      routes.signature,
    ];
    const compute = await createZgComputeWith(port, {fetch: fakeFetch(routes2), pollMs: 0, verify: {backoffMs: 0}, onEvent: (e) => events.push(e)});
    const outs = [await compute.run(op("chat"), {prompt: "ok"}, {purchaseId: "a"}), await compute.run(op("chat"), {prompt: "fail"}, {purchaseId: "b"}), await compute.priceOf(op("chat"))];
    expect(outs[0]!.ok && !outs[1]!.ok).toBe(true);
    expect(JSON.stringify(outs, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/SECRET|Authorization|Bearer/);
    // The provider echoed the token in its error body: that text reaches the log as `detail`, with
    // the credential redacted.
    const fail = events.find((e) => (e as {type: string}).type === "run.fail") as {detail: string};
    expect(fail.detail).toContain("denied for Bearer [redacted]");
    expect(JSON.stringify(events)).not.toMatch(/SECRET|Authorization/);
  });

  it("a network error is retryable", async () => {
    const {compute} = await setup({fetch: [["/chat/completions", () => Promise.reject(new TypeError("fetch failed"))]]});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "provider_unavailable", retryable: true});
  });

  it("an empty answer is a failure, not a delivered blank", async () => {
    const {compute} = await setup({fetch: [["/chat/completions", () => json(chatBody(""), {headers: {"ZG-Res-Key": "k"}})]]});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "empty_output"});
  });

  it("times out at the operation's deadline", async () => {
    const {compute} = await setup({fetch: [["/chat/completions", hang]], opts: {timeoutsMs: {chat: 30}}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "timeout", retryable: true});
  });

  it("aborts on the caller's signal mid-request", async () => {
    const {compute} = await setup({fetch: [["/chat/completions", hang]]});
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q", signal: ctl.signal}))).toMatchObject({code: "aborted"});
  });
});

describe("run: verification fails closed", () => {
  it("withholds an answer whose signature recovers to someone else", async () => {
    const {compute} = await setup({port: {verify: async () => false}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "verification_rejected", retryable: false});
  });

  it("withholds an answer whose signature never becomes checkable", async () => {
    let calls = 0;
    const {compute} = await setup({
      port: {
        verify: async () => {
          calls++;
          return null;
        },
      },
    });
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "verification_unavailable", retryable: true});
    expect(calls).toBe(4);
  });

  it("delivers once a late signature appears", async () => {
    const answers = [null, null, true];
    const {compute} = await setup({port: {verify: async () => answers.shift() ?? true}});
    expect((await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"})).ok).toBe(true);
  });

  it("withholds an answer whose signed text covers other bytes", async () => {
    const {compute} = await setup({
      fetch: [
        [
          "/chat/completions",
          () => {
            prove("chat-key", "", JSON.stringify(chatBody("A different answer.")));
            return json(chatBody(), {headers: {"ZG-Res-Key": "chat-key"}});
          },
        ],
      ],
    });
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "verification_rejected", retryable: false});
  });

  it("withholds without a response key to check", async () => {
    const body = {...chatBody(), id: undefined};
    const {compute} = await setup({fetch: [["/chat/completions", () => json(body)]]});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "q"}))).toMatchObject({code: "verification_unavailable"});
  });
});

describe("run: voice and image", () => {
  it("sends the audio as multipart and bills by the second", async () => {
    let sent: Uint8Array | null = null;
    let type = "";
    const {compute} = await setup({
      fetch: [
        [
          "/audio/transcriptions",
          (_u, init) => {
            sent = init.body as Uint8Array;
            type = (init.headers as Record<string, string>)["content-type"]!;
            return signedJson("v", {text: "Pay Corvane AI five dollars.", usage: {type: "duration", seconds: 5}}, init);
          },
        ],
      ],
    });
    const out = await compute.run(op("voice"), {audio: {base64: SPEECH.toString("base64"), mimeType: "audio/mpeg", seconds: 5}}, {purchaseId: "q"});
    expect(out).toMatchObject({ok: true, output: {kind: "text", text: "Pay Corvane AI five dollars."}});
    if (out.ok) expect(out.costNeuron).toBe(5n * 524_770_000_000_000n);
    const body = Buffer.from(sent!);
    expect(type).toMatch(/^multipart\/form-data; boundary=/);
    expect(body.toString("latin1")).toContain('name="file"; filename="audio.mp3"');
    expect(body.includes(SPEECH)).toBe(true);
    expect(body.toString("latin1")).toContain('name="model"\r\n\r\nopenai/whisper-large-v3');
    expect(body.toString("latin1")).toContain('name="response_format"\r\n\r\njson');
  });

  it("refuses audio that plays longer than the limit, whatever the caller says, before spending", async () => {
    // 8 kHz 8-bit mono WAV that plays 70 s (the limit is 60), declared as 5 s
    const seconds = 70;
    const data = Buffer.alloc(8000 * seconds, 0x80);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(8000, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    const {port, f, compute} = await setup();
    const out = failed(await compute.run(op("voice"), {audio: {base64: Buffer.concat([header, data]).toString("base64"), mimeType: "audio/wav", seconds: 5}}, {purchaseId: "q"}));
    expect(out).toMatchObject({code: "input_invalid", retryable: false, message: "Keep the audio under 60 seconds."});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("/audio/transcriptions"))).toBe(false);
  });

  it("refuses audio that plays longer than the length it was priced for, before spending", async () => {
    const {port, f, compute} = await setup({fetch: [["/audio/transcriptions", (_u, init) => signedJson("v", {text: "ok", usage: {type: "duration", seconds: 5}}, init)]]});
    // the 4.9 s clip stated as 2 s (priced for 2): more than a second over
    const out = failed(await compute.run(op("voice"), {audio: {base64: SPEECH.toString("base64"), mimeType: "audio/mpeg", seconds: 2}}, {purchaseId: "q"}));
    expect(out).toMatchObject({code: "input_invalid", retryable: false, message: "That audio plays about 5 seconds, longer than the 2 it was priced for, so it was not run."});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("/audio/transcriptions"))).toBe(false);
    // within a second of the stated length it runs
    expect((await compute.run(op("voice"), {audio: {base64: SPEECH.toString("base64"), mimeType: "audio/mpeg", seconds: 4.5}}, {purchaseId: "q2"})).ok).toBe(true);
  });

  it("refuses audio whose length cannot be read", async () => {
    const {compute} = await setup();
    const out = failed(await compute.run(op("voice"), {audio: {base64: Buffer.from("not really audio at all").toString("base64"), mimeType: "audio/mpeg", seconds: 2}}, {purchaseId: "q"}));
    expect(out).toMatchObject({code: "input_invalid", message: expect.stringContaining("could not read how long")});
  });

  /** An image provider whose proof covers the request and `signedImage` (sha256 of each). */
  function imageSetup(signedImage: Uint8Array, signedRequest?: string) {
    return setup({
      fetch: [
        [
          "/images/generations",
          (_u, init) => {
            prove("img", signedRequest ?? String(init.body), signedImage);
            return json({data: [{b64_json: Buffer.from(PNG).toString("base64")}]}, {headers: {"ZG-Res-Key": "img"}});
          },
        ],
      ],
    });
  }

  it("delivers the image when the signed text covers the request and its exact bytes", async () => {
    const {compute, f} = await imageSetup(PNG);
    const out = await compute.run(op("image"), {prompt: "a paper boat"}, {purchaseId: "q"});
    expect(out).toMatchObject({ok: true, output: {kind: "image", mimeType: "image/png"}});
    if (out.ok && out.output.kind === "image") expect([...out.output.bytes]).toEqual([...PNG]);
    const call = f.calls.find((c) => c.url.endsWith("/images/generations"))!;
    expect(JSON.parse(String(call.init.body))).toEqual({model: "z-image-turbo", prompt: "a paper boat", n: 1, size: "1024x1024", response_format: "b64_json"});
  });

  it("withholds an image the signature does not cover", async () => {
    const {compute} = await imageSetup(new Uint8Array([1, 2, 3]));
    expect(failed(await compute.run(op("image"), {prompt: "a paper boat"}, {purchaseId: "q"}))).toMatchObject({code: "verification_rejected"});
  });

  it("withholds an image signed for a different request", async () => {
    const {compute} = await imageSetup(PNG, "{\"prompt\":\"something else\"}");
    expect(failed(await compute.run(op("image"), {prompt: "a paper boat"}, {purchaseId: "q"}))).toMatchObject({code: "verification_rejected"});
  });

  it("polls an async image job", async () => {
    let polls = 0;
    const {compute} = await setup({
      fetch: [
        [
          "/images/generations",
          (_u, init) => {
            prove("img", String(init.body), PNG);
            return json({jobId: "job-1", status: "pending"}, {status: 202});
          },
        ],
        ["/v1/async/jobs/job-1", () => (++polls < 2 ? json({status: "processing"}) : json({status: "completed", data: {data: [{b64_json: Buffer.from(PNG).toString("base64")}]}}, {headers: {"ZG-Res-Key": "img"}}))],
      ],
    });
    expect((await compute.run(op("image"), {prompt: "a boat"}, {purchaseId: "q"})).ok).toBe(true);
    expect(polls).toBe(2);
  });
});

describe("run: video", () => {
  async function videoSetup(opts: {final?: Record<string, unknown>; unsettled?: () => Response; neverResign?: boolean} = {}) {
    const signer = privateKeyToAccount(generatePrivateKey());
    const created = {id: "v0_job-1", object: "video", status: "queued"};
    const createText = JSON.stringify(created);
    const final = opts.final ?? {id: "v0_job-1", status: "completed", usage: {completion_tokens: 40_000}};
    const createProof = `req:${sha256Hex(createText)}:centralized:bytedance:fp`;
    const finalProof = `req:${sha256Hex(JSON.stringify(final))}:centralized:bytedance:fp`;
    let polls = 0;
    let finalSigned = false;
    const port = {
      services: liveServices({video: signer.address}),
      catalogs: new Map([[PROVIDERS.video.toLowerCase(), VIDEO_CATALOG]]),
      subs: new Map(),
    };
    const s = await setup({
      port,
      fetch: [
        ["/v1/proxy/videos/v0_job-1/content", () => new Response(MP4, {headers: {"content-type": "video/mp4"}})],
        [
          "/v1/proxy/videos/v0_job-1",
          () => {
            polls++;
            if (polls < 3) return json({id: "v0_job-1", status: "in_progress"}, {headers: {"ZG-Res-Key": "vid"}});
            finalSigned = true;
            return new Response(JSON.stringify(final), {headers: {"content-type": "application/json", "ZG-Res-Key": "vid"}});
          },
        ],
        ["/v1/proxy/videos", () => new Response(createText, {headers: {"content-type": "application/json", "ZG-Res-Key": "vid"}})],
        [
          "/v1/proxy/signature/vid",
          async () => {
            const text = finalSigned && !opts.neverResign ? finalProof : createProof;
            return json({text, signature: await signer.signMessage({message: text})});
          },
        ],
        ...(opts.unsettled ? [["/unsettledfee", opts.unsettled] as [string, () => Response]] : []),
      ],
    });
    return {...s, polls: () => polls};
  }

  it("submits 4 s at 480p, polls, downloads the MP4, and accepts only the final proof", async () => {
    const {compute, f, port, polls} = await videoSetup();
    const out = await compute.run(op("video"), {prompt: "a paper boat drifting"}, {purchaseId: "q"});
    // The proof is the vendor relay's: it does not cover the MP4, and says so.
    expect(out).toMatchObject({ok: true, output: {kind: "video", mimeType: "video/mp4"}, proof: {chatId: "vid", verified: true, covers: "route", vendor: "bytedance"}});
    if (out.ok) expect(out.costNeuron).toBe(40_000n * 27_590_909_090_909n);
    expect(polls()).toBe(3);
    const create = new TextDecoder().decode(f.calls.find((c) => c.url.endsWith("/v1/proxy/videos"))!.init.body as Uint8Array);
    expect(create).toContain('name="seconds"\r\n\r\n4');
    expect(create).toContain('name="size"\r\n\r\n480p');
    expect(create).toContain('name="model"\r\n\r\ndreamina-seedance-2-0-260128');
    // funded for the clip itself, not just the provider minimum
    const transfer = port.state.writes.find((w) => w.startsWith("transferFund"))!;
    expect(BigInt(transfer.split(" ")[2]!)).toBeGreaterThan(2n * ZG);
  });

  it("withholds the clip while only the create-time proof exists", async () => {
    const {compute} = await videoSetup({neverResign: true});
    expect(failed(await compute.run(op("video"), {prompt: "x"}, {purchaseId: "q"}))).toMatchObject({code: "verification_unavailable", retryable: true});
  });

  it("calls a refused prompt a refusal, not a retryable failure", async () => {
    const {compute} = await videoSetup({final: {id: "v0_job-1", status: "failed", error: {code: "OutputVideoSensitiveContentDetected", message: "policy"}}});
    expect(failed(await compute.run(op("video"), {prompt: "x"}, {purchaseId: "q"}))).toMatchObject({code: "video_refused", retryable: false});
  });

  it("will not start a clip while the provider's open charges cannot be read", async () => {
    const {compute, port, f} = await videoSetup({unsettled: () => new Response("err", {status: 500})});
    port.state.ledger = {availableBalance: 5n * ZG, totalBalance: 5n * ZG};
    port.state.subs.set(PROVIDERS.video.toLowerCase(), {balance: 3n * ZG, pendingRefund: 0n, acknowledged: true});
    expect(failed(await compute.run(op("video"), {prompt: "x"}, {purchaseId: "q"}))).toMatchObject({code: "unsettled_unreadable", retryable: true});
    expect(f.calls.some((c) => c.url.endsWith("/v1/proxy/videos"))).toBe(false);
  });
});

describe("run: one purchase, one run", () => {
  it("a second call for the same purchase while the first runs gets the same outcome", async () => {
    let calls = 0;
    const {compute} = await setup({
      fetch: [
        [
          "/chat/completions",
          async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 20));
            return signedJson("k", chatBody(), {});
          },
        ],
      ],
    });
    const [a, b] = await Promise.all([compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "same"}), compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "same"})]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("funds a second run on the same provider for its own worst case while the first is still working", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let n = 0;
    const {port, compute} = await setup({
      fetch: [
        [
          "/chat/completions",
          async (_u, init) => {
            if (++n === 1) await gate; // the first run's answer (and so its fee) is not in yet
            return signedJson(`k${n}`, chatBody(), init);
          },
        ],
      ],
    });
    const first = compute.run(op("chat"), {prompt: "one"}, {purchaseId: "a"});
    const second = compute.run(op("chat"), {prompt: "two"}, {purchaseId: "b"});
    while (n < 2) await new Promise((r) => setTimeout(r, 1));
    // The provider's unsettled total does not show the first run yet, so the second run counted the
    // first one's worst case as open and topped up for itself.
    expect(port.state.writes.filter((w) => w.startsWith(`transferFund ${PROVIDERS.chat}`))).toHaveLength(2);
    open();
    expect((await first).ok && (await second).ok).toBe(true);
    // Both finished: their holds are released, and a third run finds enough locked.
    port.state.writes.length = 0;
    expect((await compute.run(op("chat"), {prompt: "three"}, {purchaseId: "c"})).ok).toBe(true);
    expect(port.state.writes).toEqual([]);
  });

  it("funding is serialized per wallet: concurrent runs open the ledger once", async () => {
    const {port, compute} = await setup({fetch: [["/audio/transcriptions", (_u, init) => signedJson("v", {text: "ok", usage: {type: "duration", seconds: 1}}, init)]]});
    await Promise.all([
      compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "a"}),
      compute.run(op("voice"), {audio: {base64: SPEECH.toString("base64"), mimeType: "audio/mpeg", seconds: 5}}, {purchaseId: "b"}),
    ]);
    expect(port.state.writes.filter((w) => w.startsWith("addLedger"))).toEqual(["addLedger 3"]);
    expect(port.state.writes.filter((w) => w.startsWith("transferFund")).length).toBe(2);
  });
});

describe("priceOf and status", () => {
  it("prices from live unit prices and 0G's rate, with a revision naming its inputs", async () => {
    const {compute} = await setup({port: {catalogs: liveCatalogs()}});
    const p = await compute.priceOf(op("chat"));
    expect(p).toMatchObject({ok: true, maxCostNeuron: 5_826_560_000_000_000n});
    if (p.ok && "usdPerZg" in p) {
      expect(p.usdPerZg).toBeCloseTo(0.25, 9);
      expect(p.revision).toContain(`provider=${PROVIDERS.chat}`);
      expect(p.revision).toContain("in=12064tok@320000000000");
      expect(p.revision).toContain("usdPerZg=0.250000");
    }
  });

  it("quotes at the published price when it is above the on-chain one", async () => {
    const catalogs = liveCatalogs();
    catalogs.set(PROVIDERS.voice.toLowerCase(), [{id: "openai/whisper-large-v3", pricing: {prompt: "600000000000000"}}]);
    const {compute} = await setup({port: {catalogs}});
    expect(await compute.priceOf(op("voice"))).toMatchObject({ok: true, maxCostNeuron: 61n * 600_000_000_000_000n});
  });

  it("does not quote from on-chain prices alone when the published ones cannot be read", async () => {
    const {compute} = await setup(); // no catalogs: every provider's /v1/models fails
    expect(await compute.priceOf(op("chat"))).toEqual({ok: false, reason: "We could not read the compute provider's current price right now."});
  });

  it("reads the service list fresh for every quote, so a provider change is never quoted stale", async () => {
    const {compute, port} = await setup({port: {catalogs: liveCatalogs()}});
    expect((await compute.priceOf(op("chat"))).ok).toBe(true);
    port.state.services = port.state.services.filter((s) => s.provider !== PROVIDERS.chat);
    expect(await compute.priceOf(op("chat"))).toEqual({ok: false, reason: expect.stringContaining("No verified")});
    expect(port.state.listReads).toBe(2);
  });

  it("does not quote without a rate, a provider, or the funds to run it", async () => {
    const noRate = await createZgComputeWith(fakePort({catalogs: liveCatalogs()}), {fetch: fakeFetch([["router", () => new Response("", {status: 500})]])});
    expect(await noRate.priceOf(op("chat"))).toEqual({ok: false, reason: expect.stringContaining("price in dollars")});
    const {compute: noProvider} = await setup({port: {services: []}});
    expect(await noProvider.priceOf(op("chat"))).toEqual({ok: false, reason: expect.stringContaining("No verified")});
    const {compute: atCap} = await setup({port: {catalogs: liveCatalogs(), ledger: {availableBalance: 0n, totalBalance: 10n * ZG}}});
    expect(await atCap.priceOf(op("chat"))).toEqual({ok: false, reason: "The compute balance is at its limit."});
  });

  it("reports the ledger's available balance, or null and a reason when unreadable", async () => {
    const {compute} = await setup({port: {ledger: {availableBalance: 2n * ZG, totalBalance: 6n * ZG}}});
    expect(await compute.status()).toEqual({ledgerNeuron: 2n * ZG, reason: null});
    const {compute: down} = await setup({port: {failRead: true}});
    expect(await down.status()).toEqual({ledgerNeuron: null, reason: "We could not read the compute balance."});
  });

  it("reads the wallet and the ledger for health without moving anything, and throws when unreadable", async () => {
    const {compute, port} = await setup({port: {wallet: 7n * ZG, ledger: {availableBalance: ZG, totalBalance: 9n * ZG}}});
    expect(await compute.funds()).toEqual({wallet: 7n * ZG, ledger: {availableBalance: ZG, totalBalance: 9n * ZG}});
    const {compute: fresh} = await setup({port: {wallet: 3n * ZG}});
    expect(await fresh.funds()).toEqual({wallet: 3n * ZG, ledger: null});
    expect(port.state.writes).toEqual([]);
    const {compute: down} = await setup({port: {failRead: true}});
    await expect(down.funds()).rejects.toThrow("rpc down");
  });

  it("names each operation's provider and what its enclave covers", async () => {
    const {compute} = await setup();
    const views = await compute.providers();
    expect(views.find((v) => v.operation === "video")).toMatchObject({provider: PROVIDERS.video, trust: "routed-to-vendor", vendor: "bytedance"});
    expect(views.find((v) => v.operation === "chat")).toMatchObject({trust: "model-in-enclave"});
  });

  it("refuses a wallet on the wrong chain", async () => {
    const port = {...fakePort(), chainId: async () => 1};
    await expect(createZgComputeWith(port)).rejects.toThrow(/chain 1/);
  });
});


describe("closed models: Claude relayed, GPT routed to OpenAI", () => {
  // Claude's providers answer Anthropic's Messages API only (the paid probe of 30 Oct).
  const claudeBody = {id: "msg-1", type: "message", role: "assistant", model: "claude-fable-5", content: [{type: "text", text: "A budget the contract enforces."}], stop_reason: "end_turn", usage: {input_tokens: 21, output_tokens: 9}};

  it("runs Claude through a provider with no TEE, delivers the answer unchecked, and never asks the SDK", async () => {
    let asked = 0;
    const {port, f, compute} = await setup({
      port: {
        catalogs: liveCatalogs(),
        // The SDK's processResponse answers false for a non-verifiable service: never asked here.
        verify: async () => {
          asked += 1;
          return false;
        },
      },
      fetch: [["claude.example/v1/proxy/messages", () => json(claudeBody, {headers: {"ZG-Res-Key": "claude-key"}})]],
    });
    const out = await compute.run(op("claude"), {prompt: "What is a spending policy?"}, {purchaseId: "c1"});
    expect(out).toMatchObject({
      ok: true,
      output: {kind: "text", text: "A budget the contract enforces."},
      proof: {provider: PROVIDERS.claude, model: "claude-fable-5", chatId: "claude-key", verified: false, covers: "none", vendor: "Anthropic"},
    });
    expect(asked).toBe(0);
    // Nothing is signed, so no signature is fetched to bind.
    expect(f.calls.some((c) => c.url.includes("/v1/proxy/signature/"))).toBe(false);
    // Billed at the published price, which is what the provider charges.
    if (out.ok) expect(out.costNeuron).toBe(21n * 58_250_000_000_000n + 9n * 291_270_000_000_000n);
    // Funded and acknowledged like any provider: the SDK's auth header needs the acknowledgement.
    expect(port.state.writes).toContain(`acknowledge ${PROVIDERS.claude}`);
    // An Anthropic Messages body: no template switch a vendor's API does not know, no cache request.
    const sent = JSON.parse(String(f.calls.find((c) => c.url.includes("claude.example/v1/proxy/messages"))!.init.body));
    expect(sent).toEqual({model: "claude-fable-5", max_tokens: 1024, messages: [{role: "user", content: "What is a spending policy?"}]});
    expect(f.calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("counts cache tokens a relay reports as input", async () => {
    const body = {...claudeBody, usage: {input_tokens: 15, cache_creation_input_tokens: 2, cache_read_input_tokens: 4, output_tokens: 9}};
    const {compute} = await setup({port: {catalogs: liveCatalogs()}, fetch: [["claude.example", () => json(body)]]});
    const out = await compute.run(op("claude"), {prompt: "hi"}, {purchaseId: "c2"});
    if (!out.ok) throw new Error("expected a delivery");
    expect(out.costNeuron).toBe(21n * 58_250_000_000_000n + 9n * 291_270_000_000_000n);
  });

  it("never delivers Claude's thinking as its answer", async () => {
    const body = {...claudeBody, content: [{type: "thinking", thinking: "Thinking it over."}]};
    const {compute} = await setup({port: {catalogs: liveCatalogs()}, fetch: [["claude.example", () => json(body)]]});
    expect(failed(await compute.run(op("claude"), {prompt: "hi"}, {purchaseId: "c3"}))).toMatchObject({code: "empty_output"});
  });

  it("refuses an answer that is not an Anthropic message", async () => {
    const body = {id: "cmpl-1", choices: [{message: {content: "OpenAI shaped"}}]};
    const {compute} = await setup({port: {catalogs: liveCatalogs()}, fetch: [["claude.example", () => json(body)]]});
    expect(failed(await compute.run(op("claude"), {prompt: "hi"}, {purchaseId: "c4"}))).toMatchObject({code: "output_unreadable"});
  });

  it("prices Claude with the chat formula from the live listing (the higher of on-chain and published)", async () => {
    const {compute} = await setup({port: {catalogs: liveCatalogs()}});
    const p = await compute.priceOf(op("claude"));
    // 4,000 characters x 3 + 64 prompt tokens and 1,024 answer tokens, at the on-chain prices (above the published ones).
    expect(p).toMatchObject({ok: true, maxCostNeuron: 12_064n * 100_110_000_000_000n + 1_024n * 375_420_000_000_000n});
    if (p.ok && "revision" in p) expect(p.revision).toContain(`provider=${PROVIDERS.claude}`);
  });

  it("checks GPT's signature like chat, and says its proof covers the route to OpenAI", async () => {
    const services = liveServices({gpt: SIGNER.address});
    const {compute} = await setup({port: {services, catalogs: liveCatalogs()}, fetch: [["gpt.example/v1/proxy/chat/completions", (_u, init) => signedJson("gpt-key", chatBody("Answer from GPT."), init)]]});
    const out = await compute.run(op("gpt"), {prompt: "hi"}, {purchaseId: "g1"});
    expect(out).toMatchObject({ok: true, output: {text: "Answer from GPT."}, proof: {provider: PROVIDERS.gpt, verified: true, covers: "route", vendor: "OpenAI"}});
  });

  it("withholds GPT's answer when its signature check fails (the TEE rule, unchanged)", async () => {
    const {compute} = await setup({port: {services: liveServices({gpt: SIGNER.address}), catalogs: liveCatalogs(), verify: async () => false}, fetch: [["gpt.example/v1/proxy/chat/completions", (_u, init) => signedJson("gpt-key", chatBody(), init)]]});
    expect(failed(await compute.run(op("gpt"), {prompt: "hi"}, {purchaseId: "g2"}))).toMatchObject({code: "verification_rejected", retryable: false});
  });

  it("withholds GPT's answer when its signed text covers other bytes", async () => {
    const {compute} = await setup({
      port: {services: liveServices({gpt: SIGNER.address}), catalogs: liveCatalogs()},
      fetch: [["gpt.example/v1/proxy/chat/completions", () => (prove("gpt-key", "", "something else"), json(chatBody(), {headers: {"ZG-Res-Key": "gpt-key"}}))]],
    });
    expect(failed(await compute.run(op("gpt"), {prompt: "hi"}, {purchaseId: "g3"}))).toMatchObject({code: "verification_rejected"});
  });

  it("never runs GPT on a provider with no TEE: its list entry says it is routed through one", async () => {
    const services = signedServices().map((s) => (s.provider === PROVIDERS.gpt ? {...s, verifiability: "standard"} : s));
    const {port, f, compute} = await setup({port: {services, catalogs: liveCatalogs()}});
    expect(failed(await compute.run(op("gpt"), {prompt: "hi"}, {purchaseId: "g4"}))).toMatchObject({code: "no_provider"});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("gpt.example"))).toBe(false);
  });

  it("never runs any other model on a provider with no TEE", async () => {
    const services = signedServices().map((s) => (s.provider === PROVIDERS.chat ? {...s, verifiability: "standard", additionalInfo: STANDARD} : s));
    const {port, f, compute} = await setup({port: {services, catalogs: liveCatalogs()}});
    expect(failed(await compute.run(op("chat"), {prompt: "hi"}, {purchaseId: "o1"}))).toMatchObject({code: "no_provider"});
    expect(port.state.writes).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("/chat/completions"))).toBe(false);
  });

  it("names each closed model's provider, trust and vendor from the list", async () => {
    const {compute} = await setup();
    const views = await compute.providers();
    expect(views.find((v) => v.operation === "claude")).toMatchObject({provider: PROVIDERS.claude, trust: "relayed", vendor: "Anthropic"});
    expect(views.find((v) => v.operation === "gpt")).toMatchObject({provider: PROVIDERS.gpt, trust: "routed-to-vendor", vendor: "OpenAI"});
  });

  it("says what each kind of proof covers", () => {
    expect(coversOf("chat", "model-in-enclave")).toBe("output");
    expect(coversOf("video", "routed-to-vendor")).toBe("route");
    expect(coversOf("gpt", "routed-to-vendor")).toBe("route");
    expect(coversOf("claude", "relayed")).toBe("none");
  });
});
