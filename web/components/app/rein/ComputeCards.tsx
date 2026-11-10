"use client";

// The compute page's working cards: the Rein agent's budget (its on-chain policy, edited with the
// existing set_policy flow), the run panel (pick a service, give it a prompt or audio, and the
// team's Rein agent buys one run from the gateway under its policy), and four steps:
// Price → Paid or Waiting → Ran → Delivered or Refunded. Every figure is read from chain or from
// the gateway; a missing gateway is said, a service that cannot run says why, and no result is
// ever made up.

import Link from "next/link";
import {useCallback, useEffect, useRef, useState} from "react";
import {AGENT_LABEL, fetchAgentKey, fetchCatalog, findReinAgent, grantable, starterPolicy, vaultShortfall, type AgentKey, type Catalog, type CatalogService, type ComingSoon, type ServiceKind} from "@/lib/agent-setup";
import {DEMO_TEAM, period, short, usdc} from "@/lib/chain";
import {audioMime, buyCompute, bytesToBase64, readResult, resultBlobUrl, startRun, type BuyPayment, type Outcome, type RunResult} from "@/lib/compute-client";
import {ixs, pda, rolled, type Payment} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button, ButtonLink} from "../Button";
import {StatusPill} from "../ui";
import {SignInPrompt} from "../WalletButton";
import {Explorer, StatusLine, sentStatus, type Status} from "./bits";
import {ClaimCard} from "./ClaimCard";
import {useTeamView} from "./context";
import styles from "./rein.module.css";
import card from "../pages/compute-run.module.css";

// One request per team for the agent key and one for the catalog, shared by every card on a page for
// a minute. A failed answer is not kept, so the next mount asks again.
const keyCache = new Map<string, {at: number; p: Promise<AgentKey>}>();
let catalogCache: {at: number; p: Promise<Catalog>} | null = null;

function cachedKey(team: string): Promise<AgentKey> {
  const hit = keyCache.get(team);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = fetchAgentKey(team).then((k) => {
    if (!k.ok) keyCache.delete(team);
    return k;
  });
  keyCache.set(team, {at: Date.now(), p});
  return p;
}

function cachedCatalog(): Promise<Catalog> {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.p;
  const p = fetchCatalog().then((c) => {
    if (!c.ok) catalogCache = null;
    return c;
  });
  catalogCache = {at: Date.now(), p};
  return p;
}

/** The team's agent key and the gateway's catalog. undefined while loading. */
export function useComputeSetup(team: string) {
  const [agentKey, setAgentKey] = useState<AgentKey | undefined>(undefined);
  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    cachedKey(team).then((k) => !stop && setAgentKey(k));
    cachedCatalog().then((c) => !stop && setCatalog(c));
    return () => {
      stop = true;
    };
  }, [team]);
  return {agentKey, catalog};
}

/**
 * The whole compute block for one team: the claim card and the agent's budget side by side, then the
 * run panel. Takes only the team's address, so /app/<team>/compute and a route for the signed-in
 * user's own team can both render it.
 */
export function ComputePanel({teamAddress}: {teamAddress: string}) {
  return (
    <>
      <div className={card.cards}>
        <ClaimCard teamAddress={teamAddress} />
        <AgentBudgetCard teamAddress={teamAddress} />
      </div>
      <ComputeRunPanel teamAddress={teamAddress} />
    </>
  );
}

function date(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"});
}

// ------------------------------------------------------------------------------ the budget ---

export function AgentBudgetCard({teamAddress}: {teamAddress: string}) {
  const t = useTeamView(teamAddress);
  const {agentKey, catalog} = useComputeSetup(teamAddress);
  const {publicKey, payer, send} = useWallet();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const key = agentKey?.ok ? agentKey.key.toBase58() : null;
  const agent = findReinAgent(t.spenders, key);
  const services = t.services;

  // Only services registered and active in the registry are granted; the catalog also lists ones it cannot sell yet.
  const grant = grantable(catalog);

  async function addAgent() {
    if (!publicKey || !payer || !agentKey?.ok || !catalog?.ok) return;
    setBusy(true);
    setStatus({tone: "wait", text: "Granting the Rein agent a $0.30-a-month compute budget…"});
    try {
      const sent = await send([
        ixs.addSpender({
          payer,
          owner: publicKey,
          authority: agentKey.key,
          kind: "agent",
          label: AGENT_LABEL,
          policy: starterPolicy(Math.floor(Date.now() / 1000)),
          services: grant.map((s) => pda.service(s.id).toBase58()),
        }),
      ]);
      setStatus(sentStatus(sent, "The Rein agent is on this team with a $0.30-a-month compute budget."));
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(false);
      void t.refresh();
    }
  }

  const head = (
    <div className={styles.panelHead}>
      <h2 className={styles.panelTitle} id="budget-title">
        Your agent&apos;s budget
      </h2>
      {agent ? <StatusPill tone={agent.status === "active" && t.now < agent.policy.expiresAt ? "settled" : "neutral"} label={t.now >= agent.policy.expiresAt ? "Expired" : agent.status === "active" ? "Active" : "Paused"} /> : null}
    </div>
  );

  if (t.spenders === null)
    return (
      <section className={styles.panel} aria-labelledby="budget-title">
        {head}
        <p className={styles.panelNote}>Could not read this team&apos;s spenders from chain. The budget is unknown, not empty.</p>
      </section>
    );

  if (!agent)
    return (
      <section className={styles.panel} aria-labelledby="budget-title">
        {head}
        <p className={styles.panelNote}>
          No Rein agent on this team yet. {agentKey && !agentKey.ok ? agentKey.error : null}
          {catalog && !catalog.ok ? ` Compute is not configured on this deployment yet: ${catalog.error}` : null}
        </p>
        {t.isOwner && agentKey?.ok && catalog?.ok ? (
          <div className={styles.actions}>
            <Button variant="primary" busy={busy} onClick={() => void addAgent()}>
              Add the Rein agent
            </Button>
            <span className={styles.panelNote}>0.30 per 30 days, 0.05 a run, 20 runs. You can change it after.</span>
          </div>
        ) : !t.wallet ? (
          <SignInPrompt action="add the Rein agent" />
        ) : null}
        <StatusLine status={status} />
      </section>
    );

  const r = rolled(agent, t.now);
  const left = agent.policy.allowance > r.spent ? agent.policy.allowance - r.spent : 0n;
  return (
    <section className={styles.panel} aria-labelledby="budget-title">
      {head}
      <dl className={card.budget}>
        <div>
          <dt>Allowance</dt>
          <dd>
            {usdc(agent.policy.allowance)}
            <small>per {period(agent.policy.periodSecs)}</small>
          </dd>
        </div>
        <div>
          <dt>Left this period</dt>
          <dd>
            {usdc(left)}
            <small>{usdc(r.spent)} spent</small>
          </dd>
        </div>
        <div>
          <dt>Cap per run</dt>
          <dd>
            {usdc(agent.policy.cap)}
            <small>above it, it asks you</small>
          </dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>
            {r.count} of {agent.policy.maxPayments}
            <small>this period</small>
          </dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {date(agent.policy.expiresAt)}
            <small>{agent.label}</small>
          </dd>
        </div>
      </dl>
      <ul className={card.chips} aria-label="Services it may buy">
        {agent.services.length === 0 ? <li className={card.chip}>No services: every purchase waits for you</li> : null}
        {agent.services.map((addr) => {
          const s = services?.find((x) => x.address === addr);
          const fromCatalog = catalog?.ok ? catalog.services.find((c) => pda.service(c.id).toBase58() === addr) : undefined;
          return (
            <li key={addr} className={card.chip} data-off={s && !s.active ? "" : undefined}>
              {s?.id ?? fromCatalog?.id ?? `${addr.slice(0, 4)}… (not registered yet)`}
            </li>
          );
        })}
      </ul>
      <p className={styles.panelNote}>This is the agent&apos;s policy on chain. The Rein program checks every run against it; a run over it waits for your approval.</p>
      <div className={styles.actions}>
        {t.isOwner ? (
          <ButtonLink href={`${t.base}/spenders/${agent.address}/edit`} variant="secondary">
            Edit budget
          </ButtonLink>
        ) : (
          <span className={styles.panelNote}>Only the team owner can change it.</span>
        )}
        <Explorer id={agent.address}>Spender account</Explorer>
      </div>
      <StatusLine status={status} />
    </section>
  );
}

// ---------------------------------------------------------------------------- the 4 steps ---

type StepState = "todo" | "active" | "done" | "wait" | "bad";
export type Steps = {price: [StepState, string]; pay: [StepState, string]; ran: [StepState, string]; end: [StepState, string]};

export const idleSteps: Steps = {
  price: ["todo", "The gateway quotes the run"],
  pay: ["todo", "The agent pays under its policy"],
  ran: ["todo", "The gateway runs it on 0G"],
  end: ["todo", "You get the answer, or a refund"],
};

export function ComputeSteps({steps}: {steps: Steps}) {
  const names: Record<keyof Steps, string> = {
    price: "Price",
    pay: steps.pay[0] === "wait" ? "Waiting" : "Paid",
    ran: "Ran",
    end: steps.end[0] === "wait" || steps.end[1].startsWith("Refunded") ? "Refunded" : "Delivered",
  };
  return (
    <ol className={card.steps} aria-label="Run progress">
      {(Object.keys(names) as (keyof Steps)[]).map((k) => (
        <li key={k} className={card.step} data-state={steps[k][0]}>
          <span className={card.stepName}>{names[k]}</span>
          <span className={card.stepNote}>{steps[k][1]}</span>
        </li>
      ))}
    </ol>
  );
}

/** The steps for an intent from its Payment account (if read) and the gateway's outcome. */
export function stepsFor(payment: Payment | null | undefined, outcome: Outcome | null, now: number): Steps {
  const s: Steps = {...idleSteps};
  if (payment) s.price = ["done", usdc(payment.amount)];
  // Only an answer that implies a quote exists marks it; "unknown" or an error says nothing about one.
  else if (outcome && ["done", "refunded", "running", "waiting", "unpaid", "not_run"].includes(outcome.kind)) s.price = ["done", "Quoted"];
  if (payment) {
    if (payment.status === "paid" || payment.status === "settled") s.pay = ["done", payment.status === "settled" ? "Approved by you" : "Inside its policy"];
    else if (payment.status === "pending" && now < payment.deadline) s.pay = ["wait", "Waiting for your approval"];
    else s.pay = ["bad", payment.status === "pending" ? "Approval expired" : payment.status];
  }
  if (outcome?.kind === "waiting") s.pay = ["wait", "Waiting for your approval"];
  if (outcome?.kind === "running") s.ran = ["active", "Running now…"];
  if (outcome?.kind === "done") {
    const r = outcome.result;
    s.pay = s.pay[0] === "todo" ? ["done", "Paid"] : s.pay;
    s.ran = ["done", r.model];
    s.end = ["done", r.fake ? "Delivered (test upstream, no model called)" : r.verified === true ? "Delivered, TEE verified" : isRelayed(r) ? "Delivered, relayed (not checked)" : "Delivered"];
  }
  if (outcome?.kind === "refunded") {
    s.ran = ["bad", "Did not run"];
    s.end = ["wait", `Refunded${outcome.state && outcome.state !== "confirmed" ? ` (${outcome.state})` : ""}`];
  }
  if (outcome?.kind === "refused") s.ran = ["bad", outcome.error];
  return s;
}

/** Fills the steps chain and the gateway have not spoken to yet from what this panel already knows. */
function mergeSteps(known: Steps, local: Steps): Steps {
  const out = {...known};
  for (const k of Object.keys(out) as (keyof Steps)[]) if (out[k][0] === "todo" && local[k][0] !== "todo") out[k] = local[k];
  return out;
}

const isRelayed = (r: RunResult) => r.covers === "none" || r.trust === "relayed";

/** What can be said about a delivered result: TEE verified only when its signature checked out. */
function ResultTrust({r}: {r: RunResult}) {
  if (r.fake) return <span className={card.badge} data-tone="fake">Test upstream, no model called</span>;
  if (r.verified === true) return <span className={card.badge} data-tone="tee">TEE verified</span>;
  if (isRelayed(r)) return <span className={card.badge} data-tone="relayed">Relayed, no TEE (not checked)</span>;
  return <span className={card.badge}>Signature not checked</span>;
}

function sizeText(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function ResultBody({r}: {r: RunResult}) {
  const output = r.output ?? "text";
  if (output === "image" || output === "video") {
    // Only the gateway's own blob route for this intent is ever shown; anything else is not an output.
    const url = resultBlobUrl(r);
    if (!url) return <p className={card.resultText}>The gateway returned no link to this {output}, so nothing is shown.</p>;
    const meta = [r.mime, sizeText(r.bytes)].filter(Boolean).join(" · ");
    return (
      <figure className={card.media}>
        {output === "image" ? (
          <img className={card.mediaItem} src={url} alt={`The image ${r.model} made for this run`} loading="lazy" />
        ) : (
          <video className={card.mediaItem} src={url} controls preload="metadata" aria-label={`The clip ${r.model} made for this run`} />
        )}
        <figcaption className={card.mediaCaption}>
          <a className={styles.sectionLink} href={url} target="_blank" rel="noreferrer">
            Open the {output} <span aria-hidden="true">↗</span>
          </a>
          {meta ? <span>{meta}</span> : null}
        </figcaption>
      </figure>
    );
  }
  return (
    <>
      {r.service === "ai-voice" ? <span className={card.label}>Transcript</span> : null}
      <p className={card.resultText}>{r.text}</p>
    </>
  );
}

export function OutcomeView({outcome}: {outcome: Outcome | null}) {
  if (!outcome) return null;
  if (outcome.kind === "done") {
    const r = outcome.result;
    return (
      <div className={card.result}>
        <div className={card.resultHead}>
          <span>
            {r.service} · {r.model}
          </span>
          <ResultTrust r={r} />
        </div>
        <ResultBody r={r} />
        <div className={card.resultHead}>
          {typeof r.resultHash === "string" ? <span className={styles.mono}>sha256 {r.resultHash.slice(0, 12)}…</span> : <span />}
          {r.provider ? <span className={styles.mono}>0G provider {short(r.provider, 4)}</span> : null}
        </div>
      </div>
    );
  }
  if (outcome.kind === "refunded")
    return (
      <div className={card.result} data-refunded="">
        <div className={card.resultHead}>
          <span>Refunded{outcome.amount && /^\d+$/.test(outcome.amount) ? ` ${usdc(BigInt(outcome.amount))}` : ""} to the vault</span>
          {outcome.signature ? <Explorer kind="tx" id={outcome.signature}>Refund transaction</Explorer> : null}
        </div>
        <p className={card.resultText}>{outcome.reason ?? "The run did not happen."}</p>
      </div>
    );
  return null;
}

// ------------------------------------------------------------------------------ the run ---

/** The six cards, in this order, whatever order the catalog lists services in. */
const PICKER: {kind: ServiceKind; title: string; id: string; placeholder: string}[] = [
  {kind: "chat", title: "Chat", id: "ai-chat", placeholder: "Summarise why spending limits matter for AI agents, in three bullet points."},
  {kind: "image", title: "Image", id: "ai-image", placeholder: "A purple lighthouse on a black sea at night, flat illustration."},
  {kind: "voice", title: "Voice", id: "ai-voice", placeholder: ""},
  {kind: "claude", title: "Claude", id: "ai-claude", placeholder: "Review this policy in three sentences: 0.05 a run, 0.50 an hour, 20 runs."},
  {kind: "gpt", title: "GPT", id: "ai-gpt", placeholder: "Explain a per-payment cap to a new finance hire, in two sentences."},
  {kind: "video", title: "Video", id: "ai-video", placeholder: "A purple padlock slowly closing on a black background, simple clean animation."},
];

type Choice = (typeof PICKER)[number] & {
  svc: CatalogService | null;
  soon: ComingSoon | null;
  /** A short state for the card; null when it can be bought now. */
  state: string | null;
  /** Why it cannot be bought now, in full; null when it can. */
  why: string | null;
};

function choicesFrom(catalog: Catalog): Choice[] {
  const services = catalog.ok ? catalog.services : [];
  const soon = catalog.ok ? catalog.comingSoon : [];
  return PICKER.map((p): Choice => {
    const svc = services.find((s) => s.kind === p.kind) ?? services.find((s) => s.id === p.id) ?? null;
    const later = svc ? null : (soon.find((s) => s.kind === p.kind) ?? soon.find((s) => s.id === p.id) ?? null);
    const base = {...p, svc, soon: later};
    if (later) return {...base, state: "Coming soon", why: later.reason};
    if (!svc) return {...base, state: "Not offered here", why: `This deployment's compute catalog does not list ${p.title}.`};
    if (!svc.registered) return {...base, state: "Not registered", why: svc.reason ?? `${svc.id} is not in the Rein registry, so no agent can pay for it.`};
    if (!svc.active) return {...base, state: "Suspended", why: svc.reason ?? `${svc.id} is suspended in the Rein registry.`};
    if (!svc.configured) return {...base, state: "Needs 0G Private Computer key", why: svc.reason ?? `${svc.name} runs through 0G Private Computer, and this server has no key for it yet. It is not sold until it has one.`};
    if (!svc.available) return {...base, state: "Unavailable now", why: svc.reason ?? "The gateway cannot quote it right now."};
    return {...base, state: null, why: null};
  });
}

function trustText(c: Choice): {tone: "tee" | "relayed"; label: string} | null {
  const trust = c.svc?.trust ?? c.soon?.trust ?? null;
  const label = c.svc?.trustLabel ?? c.soon?.trustLabel ?? (trust === "tee" ? "TEE verified" : trust === "relayed" ? "Relayed, no TEE" : null);
  return label ? {tone: trust === "tee" ? "tee" : "relayed", label} : null;
}

type Clip = {bytes: Uint8Array; mime: string; name: string; size: number; seconds: number | null; url: string};

/** How long an audio file plays, from the browser's own decoder; null when it will not say. */
function durationOf(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (v: number | null) => {
      clearTimeout(timer);
      a.removeAttribute("src");
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 4000);
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

function payStep(p: BuyPayment): [StepState, string] {
  if (p.status === "paid") return ["done", "Inside its policy"];
  if (p.status === "pending") return p.unconfirmed ? ["active", "Sent, not confirmed yet"] : ["wait", "Waiting for your approval"];
  return ["bad", p.error ?? (p.status === "refused" ? "Refused on chain" : "Payment failed")];
}

const REASON_TEXT: Record<string, string> = {
  service_not_allowed: "the service is not on the agent's list",
  over_cap: "over the agent's cap per run",
  over_allowance: "over its allowance",
  over_payment_count: "over its runs this period",
};

export function ComputeRunPanel({teamAddress}: {teamAddress: string}) {
  const t = useTeamView(teamAddress);
  const {agentKey, catalog} = useComputeSetup(teamAddress);
  const {authHeaders, authenticated} = useWallet();
  const [kind, setKind] = useState<ServiceKind | null>(null);
  const [prompt, setPrompt] = useState("");
  const [clip, setClip] = useState<Clip | null>(null);
  const [recording, setRecording] = useState(false);
  const [local, setLocal] = useState<Steps>(idleSteps);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [paid, setPaid] = useState<BuyPayment | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const abort = useRef<AbortController | null>(null);
  const rec = useRef<{r: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout>} | null>(null);
  const isDemo = DEMO_TEAM !== null && teamAddress === DEMO_TEAM;

  const choices = catalog?.ok ? choicesFrom(catalog) : [];
  // The first card that can be bought now, else Chat.
  useEffect(() => {
    if (catalog?.ok && !kind) setKind(choicesFrom(catalog).find((c) => !c.why)?.kind ?? "chat");
  }, [catalog, kind]);
  // A clip's object URL is freed when it is replaced and when the panel goes.
  useEffect(() => () => (clip ? URL.revokeObjectURL(clip.url) : undefined), [clip]);
  useEffect(
    () => () => {
      if (rec.current) {
        clearTimeout(rec.current.timer);
        rec.current.stream.getTracks().forEach((x) => x.stop());
      }
    },
    [],
  );

  const choice = choices.find((c) => c.kind === kind) ?? null;
  const svc = choice?.svc ?? null;
  const key = agentKey?.ok ? agentKey.key.toBase58() : null;
  const agent = findReinAgent(t.spenders, key);
  const payment = intent ? (t.payments?.find((p) => p.intent === intent && (!agent || p.spender === agent.address)) ?? null) : null;
  const steps = intent ? mergeSteps(stepsFor(payment, outcome, t.now), local) : local;
  const maxChars = svc?.maxPromptChars ?? 1000;
  const maxBytes = svc?.maxAudioBytes ?? 3 * 1024 * 1024;
  const maxSeconds = svc?.maxAudioSeconds ?? 60;
  const offList = !!(agent && svc && svc.registered && !agent.services.includes(pda.service(svc.id).toBase58()));

  const follow = useCallback(
    async (found: string) => {
      // Ask the gateway to run it (idempotent), then read the result until it settles. A clip is a
      // job that takes a minute or two, so it is followed for longer (every read checks it once).
      let o = await startRun(found, await authHeaders());
      const tries = svc?.output === "video" ? 90 : 30;
      for (let i = 0; i < tries && (o.kind === "running" || o.kind === "unpaid" || o.kind === "not_run"); i++) {
        setOutcome(o);
        await new Promise((r) => setTimeout(r, 2000));
        o = o.kind === "unpaid" ? await startRun(found, await authHeaders()) : await readResult(found);
      }
      setOutcome(o);
      if (o.kind === "waiting") setStatus({tone: "wait", text: "Waiting for your approval: the run is over the agent's policy. Approve it under Approvals, then open the run to start it."});
      else if (o.kind === "unavailable" || o.kind === "error" || o.kind === "refused") setStatus({tone: o.kind === "refused" ? "bad" : "wait", text: o.error});
      else if (o.kind === "unpaid" || o.kind === "running" || o.kind === "not_run") setStatus({tone: "wait", text: "Not finished yet. The run page keeps checking."});
      else setStatus(null);
    },
    [authHeaders, svc?.output],
  );

  function pick(k: ServiceKind) {
    if (running || recording) return;
    setKind(k);
    setStatus(null);
  }

  async function takeClip(file: Blob, name: string, knownSeconds: number | null) {
    if (file.size === 0) return setStatus({tone: "bad", text: "That audio is empty."});
    if (file.size > maxBytes) return setStatus({tone: "bad", text: `That audio is ${sizeText(file.size)}. Keep it under ${sizeText(maxBytes)}.`});
    const url = URL.createObjectURL(file);
    const seconds = knownSeconds ?? (await durationOf(url));
    if (seconds !== null && seconds > maxSeconds + 0.5) {
      URL.revokeObjectURL(url);
      return setStatus({tone: "bad", text: `That audio plays about ${Math.ceil(seconds)} seconds. Keep it under ${maxSeconds}.`});
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setClip({bytes, mime: audioMime(file.type, name), name, size: file.size, seconds, url});
    setStatus(null);
  }

  async function startRecording() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return setStatus({tone: "bad", text: "This browser cannot record audio here. Upload a file instead."});
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
    } catch {
      return setStatus({tone: "bad", text: "Microphone access was refused. Upload a file instead."});
    }
    const type = ["audio/webm", "audio/ogg", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = type ? new MediaRecorder(stream, {mimeType: type}) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const started = Date.now();
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      stream.getTracks().forEach((x) => x.stop());
      if (rec.current) clearTimeout(rec.current.timer);
      rec.current = null;
      setRecording(false);
      const mime = audioMime(r.mimeType || type || "audio/webm");
      const ext = mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "m4a" : "webm";
      void takeClip(new Blob(chunks, {type: mime}), `recording.${ext}`, (Date.now() - started) / 1000);
    };
    // Stops itself just under the limit, so a recording is never refused for length.
    const timer = setTimeout(() => r.state !== "inactive" && r.stop(), Math.max(1, maxSeconds - 1) * 1000);
    rec.current = {r, stream, timer};
    r.start();
    setClip(null);
    setRecording(true);
    setStatus({tone: "quiet", text: `Recording… it stops by itself at ${maxSeconds - 1} seconds.`});
  }

  async function go() {
    if (running || !svc || choice?.why || !agentKey?.ok) return;
    let input: {prompt: string} | {audio: {base64: string; mime: string}};
    if (svc.input === "audio") {
      if (!clip) return setStatus({tone: "bad", text: "Add or record an audio clip first."});
      input = {audio: {base64: bytesToBase64(clip.bytes), mime: clip.mime}};
    } else {
      if (!prompt.trim()) return setStatus({tone: "bad", text: "Write a prompt first."});
      if (prompt.length > maxChars) return setStatus({tone: "bad", text: `Keep the prompt to ${maxChars.toLocaleString("en-US")} characters for ${svc.name}.`});
      input = {prompt};
    }
    setRunning(true);
    setOutcome(null);
    setIntent(null);
    setPaid(null);
    setLocal({...idleSteps, price: ["active", "Asking for a quote…"]});
    setStatus(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await buyCompute({team: t.address, service: svc.id, ...input}, await authHeaders(), ctrl.signal);
      if (!r.ok) {
        setLocal({...idleSteps, price: r.unknown ? ["wait", "Unknown: check Activity"] : ["bad", "Not bought"]});
        setStatus({tone: r.unknown ? "wait" : "bad", text: r.unknown ? r.error : `${r.error} Nothing was charged.`});
        if (r.unknown) void t.refresh();
        return;
      }
      setIntent(r.intent);
      setPaid(r.payment);
      setLocal({...idleSteps, price: ["done", r.amount !== null ? usdc(r.amount) : "Quoted"], pay: payStep(r.payment)});
      void t.refresh();
      const p = r.payment;
      if (p.status === "paid" || (p.status === "pending" && p.unconfirmed)) await follow(r.intent);
      else if (p.status === "pending") {
        const why = p.reasons.map((x) => REASON_TEXT[x] ?? x).join(", ");
        setStatus({tone: "wait", text: `Waiting for your approval${why ? `: ${why}` : ""}. Approve it under Approvals, then open the run to start it. Nothing has moved yet.`});
      } else setStatus({tone: "bad", text: `${p.status === "refused" ? "Refused on chain" : "The payment failed"}: ${p.error ?? "the program said no"}. Nothing moved and nothing ran.`});
    } catch (e) {
      setStatus({tone: "wait", text: `The request stopped: ${errorText(e)}. A payment may already be on chain; check Activity before trying again.`});
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  // A run the vault cannot cover is stopped here with the reason (lib/agent-setup.ts).
  const overVault = vaultShortfall(svc?.priceUnits ?? null, t.balance, kind, usdc) ?? undefined;
  const blocked =
    catalog && !catalog.ok
      ? `Compute is not configured on this deployment yet: ${catalog.error}`
      : agentKey && !agentKey.ok
        ? `The gateway is not available: ${agentKey.error}`
        : !isDemo && !t.isOwner
          ? "Only the team owner can ask the agent to buy compute."
          : !agent && t.spenders
            ? "Add the Rein agent first (Your agent's budget)."
            : recording
              ? "Stop the recording first."
              : (choice?.why ?? overVault ?? undefined);

  return (
    <section className={styles.panel} aria-labelledby="run-title">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="run-title">
          Buy a run on 0G
        </h2>
        <span className={styles.panelNote}>Your Rein agent pays from its own budget; the gateway runs it on 0G or refunds it</span>
      </div>

      {catalog === undefined ? (
        <p className={styles.panelNote} role="status">
          Reading the compute catalog…
        </p>
      ) : !catalog.ok ? (
        <p className={styles.panelNote}>Compute is not configured on this deployment yet: {catalog.error}</p>
      ) : (
        <div className={card.picker} role="group" aria-label="Service">
          {choices.map((c) => {
            const trust = trustText(c);
            return (
              <button key={c.kind} type="button" className={card.option} aria-pressed={c.kind === kind} data-off={c.why ? "" : undefined} onClick={() => pick(c.kind)}>
                <span className={card.optionTop}>
                  <span className={card.optionKind}>{c.title}</span>
                  {trust ? (
                    <span className={card.badge} data-tone={trust.tone}>
                      {trust.label}
                    </span>
                  ) : null}
                </span>
                <span className={card.optionName}>{c.svc?.name ?? c.soon?.name ?? c.title}</span>
                <span className={card.optionMeta}>{c.svc?.model ?? c.soon?.model ?? "—"}</span>
                <span className={card.optionFoot}>
                  <span className={card.optionPrice}>
                    {c.svc?.price ?? "—"}
                    <small> a run</small>
                  </span>
                  <span className={card.optionState} data-ready={c.state ? undefined : ""}>
                    {c.state ?? "Ready"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {choice ? (
        <div className={card.runForm}>
          {svc?.summary ? <p className={styles.panelNote}>{svc.summary}</p> : null}
          {choice.why ? <p className={card.why}>{choice.why}</p> : null}
          {!choice.why && offList ? <p className={card.why}>{svc?.id} is not on your agent&apos;s list of services, so the payment will wait for your approval before it runs.</p> : null}

          {svc && !choice.why && svc.input === "prompt" ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{svc.output === "image" ? "Describe the image" : "Prompt"}</span>
                <textarea className={card.textarea} value={prompt} maxLength={maxChars} onChange={(e) => setPrompt(e.target.value)} placeholder={choice.placeholder} />
              </label>
              <span className={card.count} data-over={prompt.length > maxChars ? "" : undefined}>
                {prompt.length.toLocaleString("en-US")} / {maxChars.toLocaleString("en-US")}
              </span>
            </>
          ) : null}

          {svc && !choice.why && svc.input === "audio" ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Audio to transcribe</span>
              <div className={card.row}>
                <label className={card.fileLabel}>
                  <span>Upload a file</span>
                  <input
                    className={card.fileInput}
                    type="file"
                    accept={[...(svc.audioTypes ?? ["audio/*"]), ".mp3", ".wav", ".m4a", ".webm", ".ogg"].join(",")}
                    disabled={recording || running}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void takeClip(f, f.name, null);
                    }}
                  />
                </label>
                {recording ? (
                  <Button small variant="primary" onClick={() => rec.current?.r.stop()}>
                    Stop recording
                  </Button>
                ) : (
                  <Button small onClick={() => void startRecording()} disabledReason={running ? "A run is in progress." : undefined}>
                    Record
                  </Button>
                )}
                <span className={card.count}>
                  Up to {maxSeconds} seconds, {sizeText(maxBytes)}
                </span>
              </div>
              {clip ? (
                <div className={card.clip}>
                  <audio controls src={clip.url} aria-label="Your audio clip" />
                  <span className={card.count}>
                    {clip.name} · {sizeText(clip.size)} · {clip.seconds !== null ? `${clip.seconds.toFixed(1)} s` : "length —"}
                  </span>
                  <Button small variant="ghost" onClick={() => setClip(null)} disabledReason={running ? "A run is in progress." : undefined}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {!authenticated && !isDemo ? (
            <SignInPrompt action="buy a run" />
          ) : (
            <div className={styles.actions}>
              <Button variant="primary" busy={running} onClick={() => void go()} disabledReason={blocked ?? (agentKey === undefined ? "Checking the gateway…" : undefined)}>
                {svc ? `Buy one run${svc.price ? ` for ${svc.price}` : ""}` : "Buy one run"}
              </Button>
              {running ? (
                <Button variant="ghost" onClick={() => abort.current?.abort()}>
                  Stop watching
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <ComputeSteps steps={steps} />
      {paid ? (
        <p className={styles.panelNote}>
          {paid.signature ? <Explorer kind="tx" id={paid.signature}>Payment transaction</Explorer> : null} {paid.payment ? <Explorer id={paid.payment}>Payment account</Explorer> : null}
        </p>
      ) : null}
      <OutcomeView outcome={outcome} />
      {intent ? (
        <Link href={`${t.base}/compute/${intent}`} className={styles.sectionLink}>
          Open this run →
        </Link>
      ) : null}
      <StatusLine status={status} />
    </section>
  );
}

// --------------------------------------------------------------------------- one result ---

export function ComputeResultView({teamAddress, intent}: {teamAddress: string; intent: string}) {
  const t = useTeamView(teamAddress);
  const {authHeaders} = useWallet();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const payment = t.payments?.find((p) => p.intent === intent) ?? null;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const o = await readResult(intent);
      if (stop) return;
      setOutcome(o);
      if (o.kind === "running" || o.kind === "not_run") timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [intent]);

  async function start() {
    setBusy(true);
    try {
      setOutcome(await startRun(intent, await authHeaders()));
    } finally {
      setBusy(false);
    }
  }

  const steps = stepsFor(payment, outcome, t.now);
  const paid = payment && (payment.status === "paid" || payment.status === "settled");
  return (
    <section className={styles.panel} aria-labelledby="result-title">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="result-title">
          Compute run
        </h2>
        <span className={styles.mono}>{intent}</span>
      </div>
      <ComputeSteps steps={steps} />
      <OutcomeView outcome={outcome} />
      {outcome && (outcome.kind === "unavailable" || outcome.kind === "error" || outcome.kind === "refused") ? <StatusLine status={{tone: outcome.kind === "refused" ? "bad" : "wait", text: outcome.error}} /> : null}
      {outcome?.kind === "not_run" && paid ? (
        <div className={styles.actions}>
          <Button variant="primary" busy={busy} onClick={() => void start()}>
            Start the run
          </Button>
          <span className={styles.panelNote}>The payment is on chain; the gateway runs a paid intent once.</span>
        </div>
      ) : null}
      {outcome?.kind === "waiting" || (payment?.status === "pending" && t.now < payment.deadline) ? (
        <p className={styles.panelNote}>
          Waiting for your approval. <Link href={`${t.base}/approvals`} className={styles.sectionLink}>Open approvals →</Link>
        </p>
      ) : null}
      {payment ? <Explorer id={payment.address}>Payment account</Explorer> : t.payments === null ? <p className={styles.panelNote}>Could not read the payment from chain.</p> : null}
    </section>
  );
}
