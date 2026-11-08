"use client";

// The compute page's working cards: the Rein agent's budget (its on-chain policy, edited with the
// existing set_policy flow), the run panel (the agent buys a 0G compute run through the gateway),
// and Nuntio's four steps: Price → Paid or Waiting → Ran → Delivered or Refunded. Every figure is
// read from chain or from the gateway; a missing gateway is said, and no result is ever made up.

import Link from "next/link";
import {useCallback, useEffect, useRef, useState} from "react";
import {AGENT_LABEL, fetchAgentKey, fetchCatalog, findReinAgent, starterPolicy, type AgentKey, type Catalog} from "@/lib/agent-setup";
import {period, usdc} from "@/lib/chain";
import {findAmount, findIntent, readResult, startRun, type Outcome} from "@/lib/compute-client";
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
          services: catalog.services.map((s) => pda.service(s.id).toBase58()),
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
    s.pay = s.pay[0] === "todo" ? ["done", "Paid"] : s.pay;
    s.ran = ["done", outcome.result.model];
    s.end = ["done", outcome.result.fake ? "Delivered (test upstream, no model called)" : "Delivered"];
  }
  if (outcome?.kind === "refunded") {
    s.ran = ["bad", "Did not run"];
    s.end = ["wait", `Refunded${outcome.state && outcome.state !== "confirmed" ? ` (${outcome.state})` : ""}`];
  }
  if (outcome?.kind === "refused") s.ran = ["bad", outcome.error];
  return s;
}

export function OutcomeView({outcome}: {outcome: Outcome | null}) {
  if (!outcome) return null;
  if (outcome.kind === "done")
    return (
      <div className={card.result}>
        <div className={card.resultHead}>
          <span>
            {outcome.result.service} · {outcome.result.model}
          </span>
          <span className={styles.mono}>sha256 {outcome.result.resultHash.slice(0, 12)}…</span>
        </div>
        <p className={card.resultText}>{outcome.result.text}</p>
      </div>
    );
  if (outcome.kind === "refunded")
    return (
      <div className={card.result} data-refunded="">
        <div className={card.resultHead}>
          <span>Refunded{outcome.amount ? ` ${usdc(BigInt(outcome.amount))}` : ""} to the vault</span>
          {outcome.signature ? <Explorer kind="tx" id={outcome.signature}>Refund transaction</Explorer> : null}
        </div>
        <p className={card.resultText}>{outcome.reason ?? "The run did not happen."}</p>
      </div>
    );
  return null;
}

// ------------------------------------------------------------------------------ the run ---

type Wire = {type: string; text?: string; name?: string; args?: unknown; result?: unknown; status?: string; service?: string; amount?: string | null; signature?: string; error?: string; unconfirmed?: boolean};

function describe(e: Wire): [string, string] {
  if (e.type === "thinking") return ["thinking", e.text ?? ""];
  if (e.type === "tool_call") return ["calls", `${e.name ?? "tool"} ${JSON.stringify(e.args ?? {}).slice(0, 160)}`];
  if (e.type === "tool_result") return ["result", `${e.name ?? "tool"}: ${JSON.stringify(e.result ?? null).slice(0, 200)}`];
  if (e.type === "payment") return ["payment", `${e.status ?? "?"} · ${e.service ?? "?"} · ${e.amount && /^\d+$/.test(e.amount) ? usdc(BigInt(e.amount)) : "—"}${e.error ? ` · ${e.error}` : ""}`];
  if (e.type === "final") return ["final", `${e.text ?? ""}${e.error ? ` (${e.error})` : ""}`];
  return [e.type, JSON.stringify(e).slice(0, 200)];
}

const PROMPT_MAX = 400;

export function ComputeRunPanel({teamAddress}: {teamAddress: string}) {
  const t = useTeamView(teamAddress);
  const {agentKey, catalog} = useComputeSetup(teamAddress);
  const {authHeaders, authenticated} = useWallet();
  const [prompt, setPrompt] = useState("");
  const [service, setService] = useState<string>("");
  const [events, setEvents] = useState<Wire[]>([]);
  const [steps, setSteps] = useState<Steps>(idleSteps);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (catalog?.ok && !service) setService(catalog.services[0].id);
  }, [catalog, service]);

  const key = agentKey?.ok ? agentKey.key.toBase58() : null;
  const agent = findReinAgent(t.spenders, key);
  const payment = intent && agent ? t.payments?.find((p) => p.spender === agent.address && p.intent === intent) ?? null : null;

  // The payment from chain drives "Paid / Waiting"; the gateway drives "Ran / Delivered / Refunded".
  useEffect(() => {
    if (intent) setSteps(stepsFor(payment, outcome, t.now));
  }, [intent, payment, outcome, t.now]);

  const follow = useCallback(
    async (found: string) => {
      // Ask the gateway to run it (idempotent), then read the result until it settles.
      let o = await startRun(found, await authHeaders());
      for (let i = 0; i < 30 && (o.kind === "running" || o.kind === "unpaid" || o.kind === "not_run"); i++) {
        setOutcome(o);
        await new Promise((r) => setTimeout(r, 2000));
        o = o.kind === "unpaid" ? await startRun(found, await authHeaders()) : await readResult(found);
      }
      setOutcome(o);
      if (o.kind === "waiting") setStatus({tone: "wait", text: "Waiting for your approval: the run is over the agent's budget. Approve it under Approvals and it starts."});
      else if (o.kind === "unavailable" || o.kind === "error" || o.kind === "refused") setStatus({tone: o.kind === "refused" ? "bad" : "wait", text: o.error});
      else if (o.kind === "unpaid" || o.kind === "running" || o.kind === "not_run") setStatus({tone: "wait", text: "Not finished yet. The result page keeps checking."});
      else setStatus(null);
    },
    [authHeaders],
  );

  async function go() {
    if (running || !catalog?.ok || !agentKey?.ok) return;
    const p = prompt.trim();
    if (!p) return setStatus({tone: "bad", text: "Write a prompt first."});
    setRunning(true);
    setEvents([]);
    setOutcome(null);
    setIntent(null);
    setSteps({...idleSteps, price: ["active", "Asking for a quote…"]});
    setStatus(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let found: string | null = null;
    let paid = false;
    try {
      // The agent route keeps 500 characters of a task: a short instruction, and the prompt capped at 400.
      const task = `Use buy_compute with service "${service}" and exactly this prompt, then return the answer: ${p}`;
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: {"Content-Type": "application/json", ...(await authHeaders())},
        body: JSON.stringify({team: t.address, task}),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as {error?: string} | null;
        setSteps({...idleSteps, price: ["bad", "Not started"]});
        setStatus({tone: "bad", text: j?.error ?? (res.status === 404 ? "The agent route is not available on this deployment." : `The agent did not start (${res.status}).`)});
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        buf += dec.decode(value, {stream: true});
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let e: Wire;
          try {
            e = JSON.parse(line) as Wire;
          } catch {
            continue;
          }
          setEvents((xs) => [...xs, e]);
          const i = findIntent(e);
          if (i && !found) {
            found = i;
            setIntent(i);
            const amount = findAmount(e.result ?? e);
            setSteps((s) => ({...s, price: ["done", amount ? usdc(BigInt(amount)) : "Quoted"], pay: ["active", "Paying…"]}));
          }
          if (e.type === "payment") {
            if (e.status === "paid") paid = true;
            setSteps((s) => ({
              ...s,
              pay: e.status === "paid" ? ["done", "Inside its policy"] : e.status === "pending" ? (e.unconfirmed ? ["active", "Sent, not confirmed yet"] : ["wait", "Waiting for your approval"]) : ["bad", e.error ?? `Payment ${e.status}`],
            }));
          }
        }
      }
      void t.refresh();
      if (found) await follow(found);
      else setStatus({tone: "quiet", text: "The agent finished without buying a compute run. Nothing was charged for compute."});
      if (found && !paid) void t.refresh();
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setStatus({tone: "wait", text: `The stream stopped: ${errorText(e)}. Any payment already made is on chain; check Activity.`});
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  const blocked = !authenticated
    ? null
    : catalog && !catalog.ok
      ? `Compute is not configured on this deployment yet: ${catalog.error}`
      : agentKey && !agentKey.ok
        ? `The gateway is not available: ${agentKey.error}`
        : !t.isOwner
          ? "Only the team owner can ask the agent to buy compute."
          : !agent && t.spenders
            ? "Add the Rein agent first (Your agent's budget)."
            : undefined;

  return (
    <section className={styles.panel} aria-labelledby="run-title">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="run-title">
          Run a prompt on 0G compute
        </h2>
        <span className={styles.panelNote}>Your Rein agent buys the run from its own budget</span>
      </div>
      <div className={card.runForm}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Prompt</span>
          <textarea className={card.textarea} value={prompt} maxLength={PROMPT_MAX} onChange={(e) => setPrompt(e.target.value)} placeholder="Summarise why spending limits matter for AI agents, in three bullet points." />
        </label>
        <div className={card.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Service</span>
            {catalog?.ok ? (
              <select className={card.select} value={service} onChange={(e) => setService(e.target.value)}>
                {catalog.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.model ? ` · ${s.model}` : ""}
                    {s.price ? ` · ${s.price} a run` : ""}
                    {s.unavailable ? " · unavailable" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className={styles.panelNote}>{catalog === undefined ? "Reading the compute catalog…" : "Compute not configured"}</span>
            )}
          </label>
          <span className={card.count}>
            {prompt.length} / {PROMPT_MAX}
          </span>
        </div>
        {catalog?.ok && catalog.services.find((s) => s.id === service)?.unavailable ? (
          <p className={styles.panelNote}>The gateway cannot sell {service} right now: {catalog.services.find((s) => s.id === service)?.unavailable}.</p>
        ) : null}
        {!authenticated ? (
          <SignInPrompt action="run a prompt" />
        ) : (
          <div className={styles.actions}>
            <Button variant="primary" busy={running} onClick={() => void go()} disabledReason={blocked ?? (catalog === undefined || agentKey === undefined ? "Checking the gateway…" : undefined)}>
              Ask the agent to run it
            </Button>
            {running ? (
              <Button variant="ghost" onClick={() => abort.current?.abort()}>
                Stop watching
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <ComputeSteps steps={steps} />
      {events.length ? (
        <ol className={card.log} aria-label="What the agent did">
          {events.map((e, i) => {
            const [k, v] = describe(e);
            return (
              <li key={i}>
                <span>{k}</span>
                <span>{v}</span>
              </li>
            );
          })}
        </ol>
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
