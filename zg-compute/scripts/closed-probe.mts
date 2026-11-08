/*
 * The closed models the gateway sells through 0G's direct providers (Claude Fable 5, Claude Opus 5,
 * GPT-5.4 mini; commerce's CLOSED_MODELS, docs/hackathon/CLOSED-MODELS-PLAN.md), on 0G mainnet.
 *
 *   pnpm --filter @rein/zg-compute exec tsx scripts/closed-probe.mts [--env /abs/path/.env.gateway.mainnet]
 *   pnpm --filter @rein/zg-compute exec tsx scripts/closed-probe.mts --env /abs/path/.env.gateway.mainnet --send [--max-ledger 12]
 *
 * Default: READ ONLY. Lists every provider 0G names for each model, which are usable and why the
 * others are not, their prices (on-chain, published, quote-safe), what each can prove (trust,
 * vendor), and the worst case of one answer of up to 1,024 tokens, in 0G and in US dollars at 0G's
 * own rate (the adapter's rate source). Without --env it reads with a throwaway wallet that holds
 * nothing; with --env it reads with the gateway's 0G wallet and also shows its ledger and each
 * provider's sub-account. Nothing is signed or sent either way.
 *
 * --send (needs --env): ONE short paid chat call per model with the gateway's 0G wallet, through the
 * adapter itself. It REALLY SPENDS 0G and locks some with each new provider: the first call to a
 * provider moves at least 1 0G (the provider's minimum) plus the call's worst case from the ledger
 * to that provider's sub-account, opening the ledger or depositing into it from the wallet when it
 * must (never past --max-ledger whole 0G, default 12), and acknowledges the provider (a
 * transaction). Claude Fable 5 and GPT-5.4 mini go through `run` (the Compute path: the run's body,
 * its checks, its proof); Claude Opus 5, which has no Compute service, through `api.chat` (the AI
 * keys path, with the body the gateway sends a closed model). Each prints the answer's first 120
 * characters, what it cost, its trust and whether it was verified ("unchecked" for a relayed model).
 *
 * The key is read from the env file named by --env (GATEWAY_ZG_PRIVATE_KEY) and handed to the
 * ethers Wallet; it is never printed or written. Everything printed is public.
 */
import {readFileSync} from "node:fs";
import {CLOSED_MODELS, operationById, trustSentence, type Operation} from "../src/commerce/index";
import {Wallet} from "ethers";
import {createRateSource, createSdkPort, createZgComputeWith, formatZg, resolveProviders, type ZgEvent, type ZgPort} from "../src/index";
import {DEFAULT_FUNDING, requiredLocked} from "../src/funding";
import {billedPrices, CHAT_OVERHEAD_TOKENS, CHAT_TOKENS_PER_CHAR, unitPrices} from "../src/pricing";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

for (const a of process.argv.slice(2)) {
  if (a.startsWith("--") && !["--env", "--send", "--max-ledger"].includes(a)) throw new Error(`unknown flag ${a}`);
}
const envPath = arg("env");
const send = flag("send");
if (send && !envPath) throw new Error("--send needs --env <path to .env.gateway.mainnet>: it pays with the gateway's 0G wallet");
const maxLedgerZg = Number(arg("max-ledger") ?? 12);
if (!Number.isFinite(maxLedgerZg) || maxLedgerZg <= 0 || maxLedgerZg > 50) throw new Error("--max-ledger must be whole 0G from 1 to 50");

function readKey(path: string): string {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^GATEWAY_ZG_PRIVATE_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("GATEWAY_ZG_PRIVATE_KEY not found in the env file");
}

const show = (o: Record<string, unknown>) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

/** One answer of up to 1,024 tokens, from a prompt at the Compute services' limit (4,000 characters). */
const ANSWER_TOKENS = 1_024n;
const PROMPT_TOKENS = 4_000n * CHAT_TOKENS_PER_CHAR + CHAT_OVERHEAD_TOKENS;
/** The AI keys price multiplier and per-request ceiling (commerce keys.ts, gateway config). */
const KEY_MULTIPLIER = 1.5;
const KEY_CEILING_USD = 0.5;

const port: ZgPort = await createSdkPort({privateKey: envPath ? readKey(envPath) : Wallet.createRandom().privateKey});
const wallet = envPath ? port.address : null;
show({step: "wallet", reading: envPath ? "the gateway's 0G wallet (read only unless --send)" : "a throwaway wallet that holds nothing", address: wallet, chainId: await port.chainId()});
if (envPath) {
  const [balance, ledger] = await Promise.all([port.walletBalance(), port.getLedger()]);
  show({step: "funds", wallet: formatZg(balance), ledger: ledger ? {available: formatZg(ledger.availableBalance), total: formatZg(ledger.totalBalance)} : null});
}

const rate = await createRateSource({fetch}).get();
const usdPerZg = rate.ok ? rate.rate.usdPerZg : null;
show({step: "rate", usdPerZg, reason: rate.ok ? null : rate.reason});
const usd = (neuron: bigint) => (usdPerZg === null ? null : Number((Number(neuron) / 1e18) * usdPerZg).toFixed(6));

const services = await port.listServices();
for (const m of CLOSED_MODELS) {
  const {usable, refused} = resolveProviders({model: m.id, zgServiceType: "chatbot"}, services);
  const listed = services.filter((s) => s.model === m.id);
  const providers = [];
  for (const p of usable) {
    let published = null;
    try {
      published = await port.providerModels(p.provider);
    } catch {
      published = null;
    }
    const quote = unitPrices(p, published);
    const billed = billedPrices(p, published);
    const answerOnly = ANSWER_TOKENS * quote.output;
    const worst = PROMPT_TOKENS * quote.input + ANSWER_TOKENS * quote.output;
    // What an AI key pays per answer token at the quote-safe price, and how many fit under the ceiling with an empty prompt.
    const keyOut = usdPerZg === null ? null : (Number(quote.output) / 1e18) * usdPerZg * KEY_MULTIPLIER;
    const sub = envPath ? await port.getSubAccount(p.provider) : null;
    providers.push({
      provider: p.provider,
      url: p.url,
      trust: p.trust,
      vendor: p.vendor,
      listedVerifiability: listed.find((s) => s.provider === p.provider)?.verifiability ?? null,
      publishedPricesReadable: published !== null,
      onChain: {inputPerToken: formatZg(p.inputPrice, 12), outputPerToken: formatZg(p.outputPrice, 12)},
      quoteSafe: {inputPerToken: formatZg(quote.input, 12), outputPerToken: formatZg(quote.output, 12)},
      billed: {inputPerToken: formatZg(billed.input, 12), outputPerToken: formatZg(billed.output, 12)},
      oneAnswerOf1024Tokens: {zg: formatZg(answerOnly, 9), usd: usd(answerOnly)},
      worstRun4000CharsAnd1024Tokens: {zg: formatZg(worst, 9), usd: usd(worst)},
      aiKeyAnswerTokensUnderCeiling: keyOut === null || keyOut === 0 ? null : Math.floor(KEY_CEILING_USD / keyOut),
      firstSendLocks: formatZg(requiredLocked(DEFAULT_FUNDING, 0n, worst), 6),
      subAccount: sub ? {balance: formatZg(sub.balance), acknowledged: sub.acknowledged} : envPath ? "none yet" : undefined,
    });
  }
  show({step: "model", id: m.id, name: m.name, vendor: m.vendor, trust: m.trust, says: trustSentence(m.trust, m.vendor), listedBy: listed.length, usable: providers, refused});
}

if (!send) {
  console.log("read only: nothing was signed or sent.");
  process.exit(0);
}

// --- --send: one paid call per model -----------------------------------------------------------------

const compute = await createZgComputeWith(port, {
  maxLedgerZg,
  diagnoseBinding: true,
  onEvent: (e: ZgEvent) => {
    if (["funding.plan", "binding", "run.ok", "run.fail", "run.refused", "api.fail", "chat.response"].includes(e.type)) show({event: e});
  },
});
const PROMPT = "In one sentence, what is a spending policy for an AI agent?";

async function viaRun(op: Operation) {
  const t0 = Date.now();
  const out = await compute.run(op, {prompt: PROMPT}, {purchaseId: `closed-probe-${op.id}-${t0}`});
  if (!out.ok) return show({step: "send", model: op.model, path: "run", ok: false, code: out.code, message: out.message, ms: Date.now() - t0});
  const text = out.output.kind === "text" ? out.output.text : `[${out.output.kind}]`;
  show({
    step: "send",
    model: op.model,
    path: "run",
    ok: true,
    answer: text.slice(0, 120),
    costZg: out.costNeuron === null ? null : formatZg(out.costNeuron, 9),
    costUsd: out.costNeuron === null ? null : usd(out.costNeuron),
    trust: out.proof.covers === "none" ? "relayed" : out.proof.covers === "route" ? "routed-to-vendor" : "model-in-enclave",
    verified: out.proof.covers === "none" ? "unchecked" : String(out.proof.verified),
    proof: out.proof,
    ms: Date.now() - t0,
  });
}

async function viaApi(model: string) {
  const t0 = Date.now();
  const catalog = await compute.api.catalog();
  const entry = catalog.models.find((m) => m.id === model);
  if (!entry) return show({step: "send", model, path: "api", ok: false, reason: "not in the adapter's catalog (no usable, priced provider)"});
  const maxTokens = 64n;
  // The body the gateway sends a closed model: plain OpenAI chat, no template switch, no cache request.
  const body = {messages: [{role: "user", content: PROMPT}], max_tokens: Number(maxTokens), stream: false};
  const promptCeiling = BigInt(Buffer.byteLength(JSON.stringify(body.messages), "utf8")) + 8n + CHAT_OVERHEAD_TOKENS;
  const worst = promptCeiling * entry.prices.input + maxTokens * entry.prices.output;
  const call = await compute.api.chat({model, provider: entry.provider, body, worstNeuron: worst, signal: AbortSignal.timeout(180_000)});
  if (!call.ok) return show({step: "send", model, path: "api", ok: false, code: call.code, status: call.status, message: call.message, ms: Date.now() - t0});
  try {
    const raw = await call.response.text();
    const json = JSON.parse(raw) as {id?: string; choices?: {message?: {content?: string}}[]; usage?: {prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number}};
    const u = json.usage ?? {};
    const inTok = BigInt(u.prompt_tokens ?? u.input_tokens ?? 0);
    const outTok = BigInt(u.completion_tokens ?? u.output_tokens ?? 0);
    let published = null;
    try {
      published = await port.providerModels(entry.provider);
    } catch {
      published = null;
    }
    const p = resolveProviders({model, zgServiceType: "chatbot"}, await port.listServices()).usable.find((x) => x.provider.toLowerCase() === entry.provider.toLowerCase());
    const billed = p ? billedPrices(p, published) : null;
    const cost = billed ? inTok * billed.input + outTok * billed.output : null;
    const verified = call.trust === "relayed" ? "unchecked" : String(await call.verify(call.chatId ?? json.id ?? null, json.usage ? JSON.stringify(json.usage) : undefined));
    show({
      step: "send",
      model,
      path: "api",
      ok: true,
      answer: (json.choices?.[0]?.message?.content ?? "").slice(0, 120),
      usage: json.usage ?? null,
      costZg: cost === null ? null : formatZg(cost, 9),
      costUsd: cost === null ? null : usd(cost),
      trust: call.trust,
      vendor: call.vendor,
      verified,
      ms: Date.now() - t0,
    });
  } finally {
    call.finish();
  }
}

await viaRun(operationById("claude")!);
await viaRun(operationById("gpt")!);
await viaApi("claude-opus-5");
const [balance, ledger] = await Promise.all([port.walletBalance(), port.getLedger()]);
show({step: "funds.end", wallet: formatZg(balance), ledger: ledger ? {available: formatZg(ledger.availableBalance), total: formatZg(ledger.totalBalance)} : null});
