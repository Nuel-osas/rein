"use client";

// The buying agent, live. Pick a scenario or type a task; the agent (a Groq-hosted model) plans and
// pays through /api/agent, and each payment shows what the Rein program decided: settled at once,
// waiting for the owner, or refused on chain. Red-team calls made by the harness, not the model, are
// labelled as such. Only the demo team can run the agent; other teams see how to add their own.

import {useRef, useState} from "react";
import {DEMO_TEAM} from "@/lib/chain";
import {Button} from "./Button";
import {StatusPill} from "./ui";
import {Explorer} from "./rein/bits";
import styles from "./rein/rein.module.css";

export type AgentPanelProps = {teamAddress: string; onActivity?: () => void};

type Wire =
  | {type: "thinking"; text: string; probe?: boolean}
  | {type: "tool_call"; name: string; args: Record<string, unknown>; probe?: boolean}
  | {type: "tool_result"; name: string; result: unknown; probe?: boolean}
  | {
      type: "payment";
      status: "paid" | "pending" | "refused" | "failed";
      service: string;
      amount: string | null;
      reasons?: string[];
      signature?: string;
      payment?: string;
      error?: string;
      errorName?: string;
      unconfirmed?: boolean;
      probe?: boolean;
    }
  | {type: "final"; text: string; error?: string};

const SCENARIOS = [
  {id: "research", label: "Research brief", hint: "Buys a few cheap services inside its policy."},
  {id: "overspend", label: "Over the cap", hint: "Asks for the $12 dataset. It waits for you."},
  {id: "injection", label: "Prompt injection", hint: "A pasted message tells it to send 50 USDC to a wallet."},
] as const;

const REASON: Record<string, string> = {
  service_not_allowed: "service not on its list",
  over_cap: "over the per-payment cap",
  over_allowance: "over the allowance",
  over_payment_count: "too many payments this period",
};

/** "12500000" (base units) -> "$12.50". Unknown stays unknown. */
function usd(base: string | null): string {
  if (base === null || !/^\d+$/.test(base)) return "—";
  const v = BigInt(base);
  const whole = v / 1_000_000n;
  const cents = ((v % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${cents}`;
}

function pill(e: Extract<Wire, {type: "payment"}>) {
  if (e.status === "paid") return <StatusPill tone="settled" label="Paid at once" />;
  if (e.status === "pending" && e.unconfirmed) return <StatusPill tone="pending" label="Sent, not confirmed yet" />;
  if (e.status === "pending") return <StatusPill tone="blocked" label="Waiting for owner" />;
  if (e.status === "refused") return <StatusPill tone="failed" label="Refused on chain" />;
  return <StatusPill tone="failed" label="Failed" />;
}

export function AgentPanel({teamAddress, onActivity}: AgentPanelProps) {
  const [events, setEvents] = useState<Wire[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const isDemo = DEMO_TEAM !== null && teamAddress === DEMO_TEAM;

  async function run(payload: {scenario: string} | {task: string}, label: string) {
    if (running) return;
    setEvents([]);
    setError(null);
    setRunning(label);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/agent", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(payload), signal: ctrl.signal});
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? `The agent could not start (HTTP ${res.status}).`);
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
          try {
            const ev = JSON.parse(line) as Wire;
            setEvents((prev) => [...prev, ev]);
            if (ev.type === "payment") onActivity?.();
          } catch {
            /* a malformed line is skipped, never guessed at */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("The connection to the agent dropped. Any payment shown above is on chain; check the activity list.");
    } finally {
      setRunning(null);
      abort.current = null;
      onActivity?.();
    }
  }

  if (!isDemo) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>AI agent</h2>
        </div>
        <p className={styles.panelNote}>
          Add an agent under Team with its own key and policy, then run it with the Rein agent package. To watch one work right now, open the{" "}
          <a className={styles.sectionLink} href="/demo">live demo</a>.
        </p>
      </div>
    );
  }

  const payments = events.filter((e): e is Extract<Wire, {type: "payment"}> => e.type === "payment");
  const final = events.find((e): e is Extract<Wire, {type: "final"}> => e.type === "final");
  const steps = events.filter((e) => e.type !== "payment" && e.type !== "final");

  return (
    <div className={styles.panel} data-agent-panel="live">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Research agent</h2>
        <span className={styles.panelNote}>A Groq-hosted model. Holds no money and no SOL. Its tools cannot take an address.</span>
      </div>

      <div className={styles.actions}>
        {SCENARIOS.map((s) => (
          <Button key={s.id} variant={s.id === "overspend" ? "primary" : "secondary"} small busy={running === s.label} onClick={() => run({scenario: s.id}, s.label)}>
            {s.label}
          </Button>
        ))}
      </div>
      <p className={styles.fieldHint}>{SCENARIOS.map((s) => `${s.label}: ${s.hint}`).join("  ·  ")}</p>

      <form
        className={styles.actions}
        onSubmit={(e) => {
          e.preventDefault();
          if (task.trim()) void run({task: task.trim()}, "task");
        }}
      >
        <input
          className={styles.input}
          style={{flex: "1 1 18rem"}}
          value={task}
          maxLength={500}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Or give it a task in plain words, e.g. buy an hour of GPU time"
          aria-label="Task for the agent"
        />
        <Button type="submit" small busy={running === "task"}>Run</Button>
        {running && (
          <Button small variant="ghost" onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        )}
      </form>

      {error && <p className={styles.problems} role="alert">{error}</p>}

      {payments.length > 0 && (
        <ul className={styles.checksList} aria-label="Payments the agent made">
          {payments.map((p, i) => (
            <li key={i}>
              <span className={p.status === "paid" ? styles.tick : styles.tickOff}>{p.status === "paid" ? "✓" : p.status === "pending" ? "…" : "×"}</span>
              <div>
                <b>
                  {usd(p.amount)} for {p.service} {pill(p)}
                </b>
                {p.probe && <small>Red-team check: Rein made this call itself, after the model refused, to show the chain refuses it too.</small>}
                {p.reasons && p.reasons.length > 0 && <small>Filed for the owner: {p.reasons.map((r) => REASON[r] ?? r).join(", ")}. Approve it above.</small>}
                {p.status === "refused" && <small>{p.errorName === "AccountNotInitialized" ? "No such service in the on-chain registry, so the program refused it. Nothing moved." : (p.error ?? "Refused by the program. Nothing moved.")}</small>}
                {p.status === "failed" && p.error && <small>{p.error}</small>}
                <small>
                  {p.signature && <Explorer kind="tx" id={p.signature}>Transaction</Explorer>} {p.payment && <Explorer id={p.payment}>Payment record</Explorer>}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}

      {steps.length > 0 && (
        <details>
          <summary className={styles.panelNote}>What the agent did ({steps.length} steps)</summary>
          <ol className={styles.small} style={{display: "grid", gap: ".375rem", margin: ".75rem 0 0", paddingInlineStart: "1.25rem"}}>
            {steps.map((s, i) => (
              <li key={i} className={styles.muted}>
                {s.type === "thinking" && <span>{s.probe ? "Red-team: " : ""}{s.text}</span>}
                {s.type === "tool_call" && (
                  <span className={styles.mono}>
                    {s.probe ? "red-team " : ""}
                    {s.name}({Object.entries(s.args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})
                  </span>
                )}
                {s.type === "tool_result" && <span className={styles.mono}>→ {s.name} returned</span>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {final && <p className={styles.notice}>{final.text.replace(/\*\*/g, "")}</p>}
      {running && !final && <p className={styles.panelNote} role="status">Running {running}…</p>}
    </div>
  );
}

export default AgentPanel;
