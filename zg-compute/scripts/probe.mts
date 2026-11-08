/*
 * Live probe: runs each operation once on 0G mainnet with REAL 0G, through the adapter itself.
 *
 *   pnpm --filter @rein/zg-compute probe -- --env /abs/path/.env.gateway.mainnet \
 *     --out /some/scratch/dir --audio /some/clip.mp3 [--ops chat,voice,image,video] [--dry]
 *
 * The key is read from the env file named by --env (GATEWAY_ZG_PRIVATE_KEY) and handed to the
 * ethers Wallet; it is never printed or written. Everything else printed (balances, provider
 * addresses, chat ids, events) is public.
 *
 * Budget guards: the ledger is capped at 7 0G for the probe, and the video run is skipped when
 * its worst case is over 2 0G.
 */
import {readFileSync, mkdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {OPERATIONS, type Operation, type RunInput} from "../src/commerce/index";
import {createSdkPort, createZgComputeWith, formatZg, isZgOperation, NEURON_PER_ZG, type ZgEvent, type ZgPort} from "../src/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const envPath = arg("env");
if (!envPath) throw new Error("--env <path to .env.gateway.mainnet> is required");
const outDir = resolve(arg("out") ?? "probe-out");
mkdirSync(outDir, {recursive: true});
const ops = (arg("ops") ?? "chat,voice,image,video").split(",");
const audioPath = arg("audio");
const VIDEO_LIMIT = 2n * NEURON_PER_ZG;

function readKey(path: string): string {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^GATEWAY_ZG_PRIVATE_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("GATEWAY_ZG_PRIVATE_KEY not found in the env file");
}

const log: unknown[] = [];
const say = (o: Record<string, unknown>) => {
  const line = {t: new Date().toISOString(), ...o};
  log.push(line);
  console.log(JSON.stringify(line, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};

const port: ZgPort = await createSdkPort({privateKey: readKey(envPath)});
say({step: "wallet", address: port.address, chainId: await port.chainId(), balance: formatZg(await port.walletBalance())});

const compute = await createZgComputeWith(port, {
  maxLedgerZg: 7,
  diagnoseBinding: true,
  // The provider needs 1 0G + open fees + this fee locked; the adapter adds a 5% margin on top.
  // A diagnostic re-run may drop the margin so it does not lock another 1 0G per provider.
  ...(arg("margin-bps") !== undefined ? {funding: {marginBps: BigInt(arg("margin-bps")!)}} : {}),
  onEvent: (e: ZgEvent) => say({event: e}),
});

async function unsettled(provider: `0x${string}`, url: string): Promise<string | null> {
  try {
    const sub = await port.getSubAccount(provider);
    if (!sub?.acknowledged) return "0 (not acknowledged)";
    const res = await fetch(`${url}/v1/user/${port.address}/unsettledfee`, {headers: await port.authHeaders(provider)});
    const body = (await res.json()) as {unsettledFee?: string};
    return body.unsettledFee ?? null;
  } catch (e) {
    return `unreadable: ${(e as Error).message.slice(0, 80)}`;
  }
}

async function snapshot(provider: `0x${string}`, url: string) {
  const [wallet, ledger, sub, unset] = await Promise.all([port.walletBalance(), port.getLedger(), port.getSubAccount(provider), unsettled(provider, url)]);
  return {
    wallet: formatZg(wallet, 9),
    ledgerAvailable: ledger ? formatZg(ledger.availableBalance, 9) : null,
    ledgerTotal: ledger ? formatZg(ledger.totalBalance, 9) : null,
    subBalance: sub ? formatZg(sub.balance, 9) : null,
    subPendingRefund: sub ? formatZg(sub.pendingRefund, 9) : null,
    acknowledged: sub?.acknowledged ?? false,
    unsettled: unset,
    raw: {wallet: wallet.toString(), ledgerTotal: ledger?.totalBalance.toString() ?? null, sub: sub?.balance.toString() ?? null, unsettled: unset},
  };
}

say({step: "status", status: await compute.status()});
const views = await compute.providers();
say({step: "providers", views});
const prices: Record<string, unknown> = {};
for (const op of OPERATIONS.filter(isZgOperation)) {
  const p = await compute.priceOf(op);
  prices[op.id] = p;
  say({step: "price", op: op.id, price: p.ok && "maxCostNeuron" in p ? {maxCostNeuron: p.maxCostNeuron, maxCostZg: formatZg(p.maxCostNeuron, 9), usd: Number(p.maxCostNeuron) / 1e18 * p.usdPerZg, usdPerZg: p.usdPerZg, revision: p.revision} : p});
}
if (flag("dry")) {
  writeFileSync(join(outDir, "probe-log.json"), JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
  process.exit(0);
}

function inputFor(op: Operation): RunInput {
  switch (op.id) {
    case "monad": throw new Error("x402 operations are not served by 0G");
    case "chat":
    case "claude":
    case "gpt":
      return {prompt: "In one sentence, what is a spending policy for an AI agent?"};
    case "voice": {
      if (!audioPath) throw new Error("--audio is required for voice");
      const bytes = readFileSync(audioPath);
      return {audio: {base64: bytes.toString("base64"), mimeType: "audio/mpeg", seconds: 5}};
    }
    case "image":
      return {prompt: "A small blue paper boat on a calm lake at sunrise, minimal, soft light"};
    case "video":
      return {prompt: "A small blue paper boat drifting on a calm lake at sunrise, gentle ripples, slow camera pan"};
  }
}

const results: Record<string, unknown> = {};
for (const id of ops) {
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) continue;
  const price = prices[op.id] as {ok: boolean; maxCostNeuron?: bigint};
  if (op.id === "video" && (!price.ok || (price.maxCostNeuron ?? 0n) > VIDEO_LIMIT)) {
    say({step: "skip", op: op.id, reason: "video worst case over 2 0G or unpriced", price});
    continue;
  }
  const view = views.find((v) => v.operation === op.id);
  const services = await port.listServices();
  const svc = services.find((s) => s.provider === view?.provider);
  if (!svc) {
    say({step: "skip", op: op.id, reason: "no provider"});
    continue;
  }
  const before = await snapshot(svc.provider, svc.url);
  say({step: "before", op: op.id, before});
  const t0 = Date.now();
  const outcome = await compute.run(op, inputFor(op), {purchaseId: `probe-${op.id}-${t0}`});
  const ms = Date.now() - t0;
  // Give the provider a moment to record the fee before reading the unsettled total again.
  await new Promise((r) => setTimeout(r, 5_000));
  const after = await snapshot(svc.provider, svc.url);
  const summary: Record<string, unknown> = {op: op.id, ms, before, after};
  if (outcome.ok) {
    const out = outcome.output;
    summary.ok = true;
    summary.proof = outcome.proof;
    summary.costNeuron = outcome.costNeuron;
    summary.costZg = outcome.costNeuron === null ? null : formatZg(outcome.costNeuron, 9);
    if (out.kind === "text") {
      summary.output = {kind: "text", chars: out.text.length, text: out.text.slice(0, 400)};
      writeFileSync(join(outDir, `${op.id}.txt`), out.text);
    } else {
      const ext = out.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
      writeFileSync(join(outDir, `${op.id}.${ext}`), out.bytes);
      summary.output = {kind: out.kind, mimeType: out.mimeType, bytes: out.bytes.length};
    }
    const u0 = BigInt(/^\d+$/.test(String(before.unsettled)) ? String(before.unsettled) : "0");
    const u1 = /^\d+$/.test(String(after.unsettled)) ? BigInt(String(after.unsettled)) : null;
    summary.unsettledDelta = u1 === null ? null : formatZg(u1 - u0, 9);
  } else {
    summary.ok = false;
    summary.failure = outcome;
  }
  results[op.id] = summary;
  say({step: "result", ...summary});
}

say({step: "status.end", status: await compute.status()});
writeFileSync(join(outDir, "probe-log.json"), JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
writeFileSync(join(outDir, "probe-results.json"), JSON.stringify(results, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
console.log(`wrote ${outDir}`);
