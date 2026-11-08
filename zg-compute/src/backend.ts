import {checkInput, OPERATIONS, type ComputeBackend, type ComputeStatus, type Operation, type OperationId, type PriceOutcome, type RunInput, type RunOutcome} from "./commerce/index";
import type {Address} from "viem";
import {createZgApi, type ZgApi} from "./api";
import {audioLength} from "./audio";
import {describe, fail, redactDeep, ZgFailure, type Failure} from "./failure";
import {DEFAULT_FUNDING, planFunding, requiredLocked, type FundingConfig, type FundingPlan} from "./funding";
import {readCapped, runSignal, stopped, type Fetch} from "./http";
import {withWalletLock} from "./lock";
import {decodeBase64, runChat, runImage, runVideo, runVoice, type OpContext, type OpResult, type ZgEvent} from "./ops";
import type {ZgLedger, ZgPort, ZgProviderModel, ZgService} from "./port";
import {billedPrices, costFromUsage, unitPrices, worstCase, type UnitPrices, type WorstCase} from "./pricing";
import {resolveProviders, type ResolvedProvider, type Trust} from "./providers";
import {createRateSource, type RateSource} from "./rate";
import {formatZg, NEURON_PER_ZG} from "./units";
import {checkBinding, verifyWithRetries} from "./verify";

/*
 * The 0G Compute adapter: `ComputeBackend` (ported from Nuntio's @nuntio/commerce), on 0G mainnet.
 *
 * - priceOf: the worst case of one run from the provider's live prices and 0G's own USD rate, and
 *   only while the float can actually pay for that run (so the gateway never takes money for work
 *   it cannot buy).
 * - run: resolve the provider fresh, fund its sub-account under the wallet lock, run once, verify
 *   the TEE signature (fail closed), and say what it cost from the usage the provider reported.
 *   It never retries the work itself: a retry is the gateway's decision, made on `retryable`.
 */

/** The operations 0G serves: every operation but the x402 one, which the gateway buys elsewhere. */
export type ZgOperationId = Exclude<OperationId, "monad">;
export type ZgOperation = Operation & {id: ZgOperationId};

/** Whether 0G serves `op`. Narrows `op.id`, so the per-operation maps below need no x402 entry. */
export const isZgOperation = (op: Operation): op is ZgOperation => op.id !== "monad" && op.fulfillment !== "x402";

export interface ZgComputeOptions {
  /** HTTP for providers and the Router catalog. Defaults to the global fetch. */
  fetch?: Fetch;
  /** The chain the wallet must be on. Default 16661 (0G mainnet). */
  chainId?: number;
  /** Ceiling on the ledger's total balance, whole 0G. Default 10. */
  maxLedgerZg?: number;
  /**
   * How long a provider's last good published prices stand in when a fresh read fails, ms.
   * Default 10 minutes: one slow read must not drop a model from the key list or stop its quotes;
   * a provider never read at all stays unpriced.
   */
  publishedMaxStaleMs?: number;
  funding?: Partial<FundingConfig>;
  routerCatalogUrl?: string;
  /** Run deadlines, ms. Defaults: chat 120 s, voice 120 s, image 180 s, video 600 s, claude and gpt 180 s. */
  timeoutsMs?: Partial<Record<ZgOperationId, number>>;
  /** Pause between job polls (image jobs, video), ms. Default 5 s. */
  pollMs?: number;
  /**
   * Signature retries, backing off linearly. Defaults: 4 attempts from 1 s for chat, voice and
   * image; 10 from 2 s for video (up to 90 s: the live clip's final proof appeared after ~24 s).
   */
  verify?: {attempts?: number; backoffMs?: number; videoAttempts?: number; videoBackoffMs?: number};
  /** How long a service list may be reused by status and providers, ms. priceOf and run always read it fresh. */
  servicesMaxAgeMs?: number;
  now?: () => number;
  /** Structured events for logs and the probe. Never carries keys or auth headers. */
  onEvent?: (e: ZgEvent) => void;
  /** Read back what every signature covers and emit it, even where BINDING does not enforce it. */
  diagnoseBinding?: boolean;
}

/** Claude and GPT are relayed to their vendor's API (models.ts), a longer path than a model in 0G's enclave. */
export const DEFAULT_TIMEOUTS_MS: Record<ZgOperationId, number> = {chat: 120_000, voice: 120_000, image: 180_000, video: 600_000, claude: 180_000, gpt: 180_000};

/**
 * How far past the limit a measured length may read. The quote already covers the limit plus a
 * second (the provider rounds to the nearest second), and an MP3 reads a little long.
 */
export const AUDIO_TOLERANCE_SECONDS = 0.25;

/**
 * How far past the input's stated length (the length it was priced for) the measured length may
 * read: a second or a tenth, whichever is more. The two are measured by different readers (an MP3
 * counts its padding frames, an M4A its priming), and the gateway's price carries a margin.
 */
export const AUDIO_STATED_TOLERANCE = {seconds: 1, fraction: 0.1} as const;

export interface ProviderView {
  operation: ZgOperationId;
  model: string;
  provider: Address | null;
  trust: Trust | null;
  vendor: string | null;
  refused: {provider: Address; reason: string}[];
}

export interface ZgCompute extends ComputeBackend {
  readonly address: Address;
  /** The provider each operation would use now, what its TEE covers, and who was refused. */
  providers(): Promise<ProviderView[]>;
  /**
   * For the operator's health check: the wallet's own 0G (what refills the ledger and pays gas) and
   * the ledger (null when there is none yet), neuron. Two reads; moves nothing, funds no provider.
   * Throws when either cannot be read.
   */
  funds(): Promise<{wallet: bigint; ledger: ZgLedger | null}>;
  /** The OpenAI-compatible pass-through behind Nuntio AI keys (api.ts). Shares this wallet's funding. */
  readonly api: ZgApi;
}

/**
 * How long a full funding reading of a provider may stand in for a fresh one, for an AI API call:
 * the API funds every request, and re-reading the ledger, the sub-account and the provider's open
 * fees each time (under the one wallet lock) would queue every call behind the last one's reads.
 */
export const API_FUNDING_SNAPSHOT_MS = 30_000;

interface Picked {
  provider: ResolvedProvider;
  /** For quoting: the higher of on-chain and published. */
  prices: UnitPrices;
  /** For reporting cost: what the provider bills at. */
  billed: UnitPrices;
  worst: WorstCase;
}

/**
 * Which parts of the provider's signed text must match before an output is delivered, set from
 * what the live probe showed each provider signs (PROBE.md, "What the signature covers"):
 *   chat   sha256(request):sha256(response body). The response matches byte for byte; the request
 *          half is over the provider's re-serialized body, so only the response is checked.
 *   voice  sha256(multipart body):sha256(response body). Both match.
 *   image  sha256(request):sha256(image bytes). Both match, so the proof covers the exact image.
 *   video  a routing proof request:response:centralized:bytedance:<TLS fingerprint>, re-signed
 *          over the final status JSON. The response half matches that JSON; the request half is
 *          over a rewritten body. The MP4 itself is covered by no signature.
 * `delivered` says whether the response half is a hash of what is delivered (so the proof covers
 * the output) or only of a status the delivery is fetched after (video): RunProof.covers.
 *
 * The closed models (commerce models.ts):
 *   gpt    a TeeML broker relaying to OpenAI, the same 0G broker as chat, so the same rule as chat:
 *          the response half must match. Its proof covers the route ("routed-to-vendor"), never what
 *          the model wrote, whatever this says (`coversOf`).
 *   claude relayed by a provider with no TEE: nothing is signed, so nothing is checked or bound and
 *          the proof says `covers: "none"`. Never read: a relayed run skips verification entirely.
 */
export const BINDING: Record<ZgOperationId, {request: boolean; response: boolean; delivered: boolean}> = {
  chat: {request: false, response: true, delivered: true},
  voice: {request: true, response: true, delivered: true},
  image: {request: true, response: true, delivered: true},
  video: {request: false, response: true, delivered: false},
  gpt: {request: false, response: true, delivered: true},
  claude: {request: false, response: false, delivered: false},
};

/**
 * What a delivered run's proof covers: "none" for a relayed provider (nothing is signed), "route"
 * for one that relays to a vendor through a TEE or whose signature binds only a status (video),
 * "output" only when the model ran in the enclave and the signature binds the delivered bytes.
 */
export function coversOf(op: ZgOperationId, trust: Trust): "output" | "route" | "none" {
  if (trust === "relayed") return "none";
  if (trust === "routed-to-vendor" || !BINDING[op].delivered) return "route";
  return "output";
}

export async function createZgComputeWith(port: ZgPort, opts: ZgComputeOptions = {}): Promise<ZgCompute> {
  const f: Fetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const emit = (e: ZgEvent) => {
    if (!opts.onEvent) return;
    try {
      // Provider text (error bodies, headers) reaches events; a credential it echoes does not.
      opts.onEvent(redactDeep(e));
    } catch {
      // a logger must never break a run
    }
  };
  const expectedChain = opts.chainId ?? 16661;
  const chain = await port.chainId();
  if (chain !== expectedChain) throw new Error(`0G wallet is on chain ${chain}, expected ${expectedChain}`);

  const cfg: FundingConfig = {
    ...DEFAULT_FUNDING,
    ...opts.funding,
    ...(opts.maxLedgerZg !== undefined ? {maxLedger: BigInt(Math.floor(opts.maxLedgerZg * 1e6)) * (NEURON_PER_ZG / 1_000_000n)} : {}),
  };
  const timeouts = {...DEFAULT_TIMEOUTS_MS, ...opts.timeoutsMs};
  const pollMs = opts.pollMs ?? 5_000;
  const rates: RateSource = createRateSource({fetch: f, url: opts.routerCatalogUrl, now});
  const servicesMaxAge = opts.servicesMaxAgeMs ?? 60_000;
  let servicesCache: {at: number; list: ZgService[]} | null = null;
  const inflight = new Map<string, Promise<RunOutcome>>();

  async function services(fresh: boolean): Promise<ZgService[]> {
    if (!fresh && servicesCache && now() - servicesCache.at <= servicesMaxAge) return servicesCache.list;
    const list = await port.listServices();
    servicesCache = {at: now(), list};
    return list;
  }

  const publishedMaxStale = opts.publishedMaxStaleMs ?? 600_000;
  const lastPublished = new Map<string, {at: number; models: ZgProviderModel[]}>();
  /** A provider's published prices, read live; a failed read answers the last good one for a while. */
  async function published(provider: Address): Promise<ZgProviderModel[]> {
    const k = provider.toLowerCase();
    try {
      const models = await port.providerModels(provider);
      lastPublished.set(k, {at: now(), models});
      return models;
    } catch (err) {
      const last = lastPublished.get(k);
      if (last && now() - last.at <= publishedMaxStale) {
        emit({type: "published.stale", provider, ageMs: now() - last.at});
        return last.models;
      }
      throw err;
    }
  }

  async function catalog(p: ResolvedProvider): Promise<ZgProviderModel[] | null> {
    try {
      return await published(p.provider);
    } catch {
      return null;
    }
  }

  /**
   * The cheapest usable provider for `op` by worst case, with its prices. `forQuote` reads the
   * service list fresh and skips a provider whose published prices cannot be read: they follow 0G's
   * USD rate and can sit above the on-chain ones, so a quote from on-chain prices alone could be
   * below the bill. A run already paid for still goes ahead on on-chain prices.
   */
  async function pick(op: Operation, opts: {fresh: boolean; forQuote?: boolean}): Promise<Picked | {none: string; unpriced?: true}> {
    let list: ZgService[];
    try {
      list = await services(opts.fresh || opts.forQuote === true);
    } catch (err) {
      return {none: `could not read 0G's service list: ${describe(err)}`};
    }
    const {usable, refused} = resolveProviders(op, list);
    if (usable.length === 0) return {none: refused.length ? `no usable provider for ${op.model} (${refused.map((r) => r.reason).join("; ")})` : `no provider lists ${op.model}`};
    let best: Picked | null = null;
    let unreadable = 0;
    for (const provider of usable) {
      const models = await catalog(provider);
      if (models === null && opts.forQuote) {
        unreadable++;
        continue;
      }
      const prices = unitPrices(provider, models);
      const worst = worstCase(op, prices);
      if (!worst) continue;
      if (!best || worst.neuron < best.worst.neuron) best = {provider, prices, billed: billedPrices(provider, models), worst};
    }
    if (best) return best;
    return unreadable > 0 ? {none: `${op.model}: published prices unreadable`, unpriced: true} : {none: `no provider publishes a price for ${op.model}`};
  }

  /** The provider's unsettled fees for this wallet; null when they could not be read. */
  async function unsettledFee(p: ResolvedProvider, signal?: AbortSignal): Promise<bigint | null> {
    try {
      const auth = await port.authHeaders(p.provider);
      const res = await f(`${p.url}/v1/user/${port.address}/unsettledfee`, {headers: auth, signal: signal ?? AbortSignal.timeout(15_000)});
      if (!res.ok) return null;
      const body = JSON.parse(new TextDecoder().decode(await readCapped(res, 64 * 1024))) as {unsettledFee?: unknown};
      return typeof body.unsettledFee === "string" && /^\d{1,40}$/.test(body.unsettledFee) ? BigInt(body.unsettledFee) : null;
    } catch {
      return null;
    }
  }

  /**
   * Worst cases of runs that are funded and still working, per provider. A provider adds a run's
   * fee to its unsettled total only once it answers, so until then the next run's funding cannot
   * see it there and would count the same locked balance twice: two clips at once, one clip's worst
   * case locked, and a settlement the balance cannot cover. Held from funding until the run ends.
   */
  const reserved = new Map<string, bigint>();
  const reservedFor = (p: Address) => reserved.get(p.toLowerCase()) ?? 0n;
  /**
   * The last full funding reading per provider (what was locked after funding, and the provider's
   * open fees then), and the worst cases of every run that ended since: the provider may have
   * recorded their fees by now, and the reading cannot see them. The AI API's fast path counts both.
   */
  const snapshots = new Map<string, {at: number; locked: bigint; unsettled: bigint}>();
  const consumed = new Map<string, bigint>();
  function hold(p: Address, n: bigint): () => void {
    const k = p.toLowerCase();
    reserved.set(k, reservedFor(p) + n);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (reserved.get(k) ?? 0n) - n;
      if (left > 0n) reserved.set(k, left);
      else reserved.delete(k);
      consumed.set(k, (consumed.get(k) ?? 0n) + n);
    };
  }

  /** Can the float pay for one run of `op` on `p` right now? Reads only. */
  async function capacity(op: Operation, picked: Picked): Promise<{ok: true} | {ok: false; reason: string; detail: string}> {
    try {
      const [limits, sub, ledger, wallet] = await Promise.all([port.ledgerLimits(), port.getSubAccount(picked.provider.provider), port.getLedger(), port.walletBalance()]);
      const unsettled = sub?.acknowledged ? await unsettledFee(picked.provider) : 0n;
      if (unsettled === null && op.id === "video") return {ok: false, reason: "We could not confirm the video provider's open charges.", detail: "unsettled fee unreadable"};
      const open = (unsettled ?? 0n) + reservedFor(picked.provider.provider);
      const d = planFunding(cfg, {sub, ledger, limits, unsettled: open, cost: picked.worst.neuron, wallet});
      if (d.ok) return {ok: true};
      return {ok: false, reason: d.code === "ledger_cap" ? "The compute balance is at its limit." : "The compute balance is too low for another run.", detail: d.detail};
    } catch (err) {
      return {ok: false, reason: "We could not read the compute balance.", detail: describe(err)};
    }
  }

  /** Funds the provider for this run and holds its worst case until `release` is called. */
  async function fund(op: Operation, picked: Picked, run: {signal: AbortSignal; timedOut: () => boolean}): Promise<{plan: FundingPlan | null; release: () => void}> {
    return fundProvider(picked.provider, picked.worst.neuron, op.id === "video", run, false);
  }

  /**
   * Funds `p` for `cost` neuron under the wallet lock and holds it until `release` is called.
   * `strict`: an unreadable open-fee total stops the run (video, see funding.ts). `fast`: a reading
   * younger than API_FUNDING_SNAPSHOT_MS that still covers this request after every hold and every
   * run ended since stands in for a fresh one (the AI API); compute runs always read fresh.
   */
  async function fundProvider(p: ResolvedProvider, cost: bigint, strict: boolean, run: {signal: AbortSignal; timedOut: () => boolean}, fast: boolean): Promise<{plan: FundingPlan | null; release: () => void}> {
    return withWalletLock(port.address, async () => {
      if (run.signal.aborted) throw stopped(run, "funding");
      const k = p.provider.toLowerCase();
      const snap = snapshots.get(k);
      if (fast && snap && now() - snap.at <= API_FUNDING_SNAPSHOT_MS) {
        const open = snap.unsettled + (consumed.get(k) ?? 0n) + reservedFor(p.provider);
        if (snap.locked >= requiredLocked(cfg, open, cost)) return {plan: null, release: hold(p.provider, cost)};
      }
      let limits, sub, ledger;
      try {
        [limits, sub, ledger] = await Promise.all([port.ledgerLimits(), port.getSubAccount(p.provider), port.getLedger()]);
      } catch (err) {
        throw new ZgFailure("ledger_unreadable", describe(err));
      }
      const unsettled = sub?.acknowledged ? await unsettledFee(p) : 0n;
      // The provider gates chat, voice and image on its own balance check, so an unreadable total
      // costs at worst a refused request. Video is not gated (see funding.ts), so it stops here.
      if (unsettled === null && strict) throw new ZgFailure("unsettled_unreadable", `provider ${p.provider}`);
      // Open fees: what the provider has recorded, plus the worst cases of runs still working on it.
      const inFlight = reservedFor(p.provider);
      const input = {sub, ledger, limits, unsettled: (unsettled ?? 0n) + inFlight, cost, wallet: null as bigint | null};
      let d = planFunding(cfg, input);
      if (!d.ok && d.code === "wallet_unread") {
        try {
          input.wallet = await port.walletBalance();
        } catch (err) {
          throw new ZgFailure("ledger_unreadable", `wallet balance: ${describe(err)}`);
        }
        d = planFunding(cfg, input);
      }
      if (!d.ok) throw new ZgFailure(d.code === "ledger_cap" ? "ledger_cap" : "ledger_unfunded", d.detail);
      const plan = d.plan;
      emit({
        type: "funding.plan",
        provider: p.provider,
        locked: formatZg(plan.locked),
        required: formatZg(plan.required),
        unsettled: unsettled === null ? null : formatZg(unsettled),
        inFlight: formatZg(inFlight),
        createLedgerZg: plan.createLedgerZg.toString(),
        depositZg: plan.depositZg.toString(),
        transfer: formatZg(plan.transfer),
        acknowledge: plan.acknowledge,
      });
      try {
        if (plan.createLedgerZg > 0n) await port.addLedger(plan.createLedgerZg);
        else if (plan.depositZg > 0n) await port.depositFund(plan.depositZg);
      } catch (err) {
        throw new ZgFailure("ledger_unfunded", `ledger ${plan.createLedgerZg > 0n ? "create" : "deposit"} failed: ${describe(err)}`);
      }
      if (plan.transfer > 0n) {
        try {
          await port.transferFund(p.provider, plan.transfer);
        } catch (err) {
          throw new ZgFailure("funding_failed", `transfer ${formatZg(plan.transfer)} to ${p.provider}: ${describe(err)}`);
        }
      }
      if (plan.acknowledge) {
        try {
          await port.acknowledge(p.provider);
        } catch (err) {
          throw new ZgFailure("acknowledge_failed", `acknowledge ${p.provider}: ${describe(err)}`);
        }
      }
      // A reading the fast path may trust: only with the provider's open fees actually read.
      if (unsettled !== null) {
        snapshots.set(k, {at: now(), locked: plan.locked + plan.transfer, unsettled});
        consumed.set(k, 0n);
      } else snapshots.delete(k);
      // Held inside the lock, so the next run's funding (also inside it) already counts this one.
      return {plan, release: hold(p.provider, cost)};
    });
  }

  /** What leaves the adapter: no `detail`, which may quote a provider and is for logs only. */
  const outcome = (x: Failure): RunOutcome => ({ok: false, retryable: x.retryable, code: x.code, message: x.message});

  async function runOnce(op: Operation, input: RunInput, purchaseId: string, outer?: AbortSignal): Promise<RunOutcome> {
    const refused = (x: Failure) => {
      emit({type: "run.refused", op: op.id, purchaseId, code: x.code, detail: x.detail ?? null});
      return outcome(x);
    };
    if (!isZgOperation(op)) return {ok: false, retryable: false, code: "unsupported_operation", message: "This operation is not served by 0G."};
    const started = now();
    const problem = checkInput(op, input);
    if (problem) return refused(fail("input_invalid", problem.code, problem.message));
    let audio: {bytes: Uint8Array; mimeType: string} | null = null;
    if (op.input === "audio") {
      const bytes = decodeBase64(input.audio?.base64 ?? "");
      if (!bytes) return refused(fail("input_invalid", "audio is not base64", "That audio file could not be read."));
      // Billed on the length it actually plays, so that is measured here, not taken from the caller.
      const length = audioLength(bytes);
      const max = op.limits.maxAudioSeconds ?? 60;
      if (!length) return refused(fail("input_invalid", "audio length unreadable", "We could not read how long that audio is. Use an MP3, WAV, M4A, WebM or Ogg file."));
      if (length.seconds > max + AUDIO_TOLERANCE_SECONDS) return refused(fail("input_invalid", `audio plays ${length.seconds.toFixed(2)} s`, `Keep the audio under ${max} seconds.`));
      // The run was priced for the length the input states (the gateway measures it and charges by
      // it). Audio that plays materially longer would be billed past that price: not run.
      const stated = input.audio!.seconds;
      if (length.seconds > stated + Math.max(AUDIO_STATED_TOLERANCE.seconds, stated * AUDIO_STATED_TOLERANCE.fraction)) {
        return refused(
          fail("input_invalid", `audio plays ${length.seconds.toFixed(2)} s, stated ${stated} s`, `That audio plays about ${Math.ceil(length.seconds)} seconds, longer than the ${Math.ceil(stated)} it was priced for, so it was not run.`),
        );
      }
      audio = {bytes, mimeType: input.audio!.mimeType};
    }
    const run = runSignal(timeouts[op.id], outer);
    emit({type: "run.start", op: op.id, purchaseId});
    let release: (() => void) | null = null;
    try {
      if (run.signal.aborted) throw stopped(run, "run");
      const picked = await pick(op, {fresh: true});
      if ("none" in picked) throw new ZgFailure("no_provider", picked.none);
      release = (await fund(op, picked, run)).release;
      if (run.signal.aborted) throw stopped(run, "run");

      const ctx: OpContext = {fetch: f, port, provider: picked.provider, run, emit, pollMs};
      let result: OpResult;
      const prompt = input.prompt?.trim() ?? "";
      switch (op.id) {
        case "chat":
        case "claude":
        case "gpt":
          result = await runChat(ctx, prompt, op.limits.maxOutputTokens ?? 1024);
          break;
        case "voice":
          result = await runVoice(ctx, audio!);
          break;
        case "image":
          result = await runImage(ctx, prompt);
          break;
        case "video":
          result = await runVideo(ctx, prompt);
          break;
        default: throw new Error("unsupported_operation");
      }
      // A relayed provider (a closed model with no TEE, models.ts) signs nothing: there is no
      // signature to check and no text to bind, so neither is attempted, and its answer is delivered
      // as unchecked (`verified: false`, `covers: "none"`). This is never a failed check: the SDK's
      // processResponse answers false for such a service whatever it sent. Every other provider keeps
      // the rule below, fail closed.
      const relayed = picked.provider.trust === "relayed";
      let verifyAttempts = 0;
      if (!relayed) {
        const video = op.id === "video";
        const v = opts.verify ?? {};
        const verified = await verifyWithRetries(result.check, {
          attempts: video ? (v.videoAttempts ?? 10) : (v.attempts ?? undefined),
          backoffMs: video ? (v.videoBackoffMs ?? 2_000) : (v.backoffMs ?? undefined),
          signal: run.signal,
        });
        verifyAttempts = verified.attempts;
        // A valid signature over some text is not yet a proof about this output: the text must also
        // commit to the request sent and the bytes delivered, where the provider signs those.
        const rule = BINDING[op.id];
        if (rule.request || rule.response || opts.diagnoseBinding) {
          const b = await checkBinding(f, picked.provider, result.chatId, result.binding, run.signal);
          emit({type: "binding", op: op.id, request: b.request, response: b.response, text: b.text?.slice(0, 400) ?? null});
          if ((rule.request && b.request === false) || (rule.response && b.response === false)) {
            throw new ZgFailure("verification_rejected", `signed text does not commit to the ${b.response === false ? "delivered output" : "request sent"}`);
          }
          if ((rule.request && b.request === null) || (rule.response && b.response === null)) {
            throw new ZgFailure("verification_unavailable", "signed text could not be read back to check what it covers");
          }
        }
      }
      const cost = costFromUsage(op, picked.billed, result.usage);
      const seconds = Math.round((now() - started) / 100) / 10;
      // Video's proof covers the relay to the vendor and its final status, never the MP4, which is
      // downloaded unsigned; GPT's covers its route to OpenAI; a relayed answer is covered by nothing.
      // Said so in the proof itself, so none of them is read as a proof of what was delivered.
      const covers = coversOf(op.id, picked.provider.trust);
      emit({type: "run.ok", op: op.id, purchaseId, provider: picked.provider.provider, chatId: result.chatId, seconds, verifyAttempts, covers, cost: cost === null ? null : formatZg(cost), worst: formatZg(picked.worst.neuron)});
      return {
        ok: true,
        output: result.output,
        proof: {provider: picked.provider.provider, model: picked.provider.model, chatId: result.chatId, verified: !relayed, covers, vendor: picked.provider.vendor, seconds},
        costNeuron: cost,
      };
    } catch (err) {
      const failure: Failure = err instanceof ZgFailure ? err.failure : fail("provider_unavailable", describe(err));
      emit({type: "run.fail", op: op.id, purchaseId, code: failure.code, retryable: failure.retryable, detail: failure.detail ?? null});
      return outcome(failure);
    } finally {
      run.dispose();
      release?.();
    }
  }

  const api = createZgApi({
    port,
    published,
    fetch: f,
    emit,
    services,
    rates,
    fund: async (p, worst, signal) => (await fundProvider(p, worst, false, {signal, timedOut: () => false}, true)).release,
  });

  const backend: ZgCompute = {
    address: port.address,
    api,

    async funds() {
      // Plain reads through the port: never the SDK's getRequestHeaders, which can fund a provider.
      const [wallet, ledger] = await Promise.all([port.walletBalance(), port.getLedger()]);
      return {wallet, ledger};
    },

    async status(): Promise<ComputeStatus> {
      let ledgerNeuron: bigint;
      try {
        const ledger = await port.getLedger();
        ledgerNeuron = ledger?.availableBalance ?? 0n;
      } catch {
        return {ledgerNeuron: null, reason: "We could not read the compute balance."};
      }
      const reasons: string[] = [];
      for (const op of OPERATIONS.filter(isZgOperation)) {
        const picked = await pick(op, {fresh: false});
        if ("none" in picked) {
          reasons.push("No verified compute provider is serving right now.");
          continue;
        }
        const c = await capacity(op, picked);
        if (c.ok) return {ledgerNeuron, reason: null};
        reasons.push(c.reason);
      }
      return {ledgerNeuron, reason: reasons[0] ?? "The compute balance cannot cover another run."};
    },

    async priceOf(op: Operation): Promise<PriceOutcome> {
      if (!isZgOperation(op)) return {ok: false, reason: "This operation is not served by 0G."};
      // Never from a cached list: a quote must name the provider and prices a run would get now.
      const picked = await pick(op, {fresh: true, forQuote: true});
      if ("none" in picked) {
        return {ok: false, reason: picked.unpriced ? "We could not read the compute provider's current price right now." : "No verified compute provider is serving this model right now."};
      }
      const rate = await rates.get();
      if (!rate.ok) return {ok: false, reason: "We could not read 0G's price in dollars right now."};
      const c = await capacity(op, picked);
      if (!c.ok) return {ok: false, reason: c.reason};
      const p = picked.provider;
      const revision = [
        "zg1",
        `op=${op.id}`,
        `provider=${p.provider}`,
        `model=${p.model}`,
        `listed=${p.updatedAt}`,
        picked.worst.basis,
        `usdPerZg=${rate.rate.usdPerZg.toFixed(6)}`,
        `rateAt=${new Date(rate.rate.at).toISOString()}`,
        `at=${new Date(now()).toISOString()}`,
      ].join(";");
      return {ok: true, maxCostNeuron: picked.worst.neuron, usdPerZg: rate.rate.usdPerZg, revision};
    },

    run(op: Operation, input: RunInput, o: {purchaseId: string; signal?: AbortSignal}): Promise<RunOutcome> {
      // One run per purchase at a time: a second call while the first is working gets the same
      // outcome, so a double-delivered notice cannot buy the work twice.
      const key = `${op.id}:${o.purchaseId}`;
      const existing = inflight.get(key);
      if (existing) return existing;
      const p = runOnce(op, input, o.purchaseId, o.signal).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },

    async providers(): Promise<ProviderView[]> {
      let list: ZgService[];
      try {
        list = await services(false);
      } catch {
        list = [];
      }
      return OPERATIONS.filter(isZgOperation).map((op) => {
        const {usable, refused} = resolveProviders(op, list);
        const p = usable[0] ?? null;
        return {operation: op.id, model: op.model, provider: p?.provider ?? null, trust: p?.trust ?? null, vendor: p?.vendor ?? null, refused};
      });
    },
  };
  return backend;
}

