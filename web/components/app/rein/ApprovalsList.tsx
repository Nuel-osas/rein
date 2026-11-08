"use client";

// Pending payments. `pay` filed each one on chain when it broke a limit; the USDC is still in the
// vault. The owner's approve re-checks the hard stops and settles in one transaction. On the public
// demo team, a visitor without a wallet acts as the owner through /api/demo (server-signed).

import Link from "next/link";
import {useState} from "react";
import {countdown, usdc} from "@/lib/chain";
import {PENDING_TTL_SECS, ixs, isLive, reasonsOf, type Payment, type Service, type Spender, type Team} from "@/lib/rein";
import {useWallet, errorText} from "@/lib/wallet";
import {isComputeIntent, startRun} from "@/lib/compute-client";
import {Button} from "../Button";
import {SignInPrompt} from "../WalletButton";
import {PaymentPill, StatusLine, sentStatus, serviceName, spenderName, type Status} from "./bits";
import styles from "./rein.module.css";

type DemoReply = {ok: boolean; signature?: string | null; status?: "confirmed" | "failed" | "pending"; error?: string; result?: string | null};

export function ApprovalsList({
  team,
  payments,
  spenders,
  services,
  isOwner,
  demo,
  now,
  onChange,
  only = "live",
  limit,
  base,
  empty,
}: {
  team: Team | null;
  payments: Payment[] | null;
  spenders: Spender[] | null;
  services: Service[] | null;
  isOwner: boolean;
  demo: boolean;
  now: number;
  onChange: () => void;
  only?: "live" | "history";
  limit?: number;
  base?: string;
  empty?: string;
}) {
  const {publicKey, send, authHeaders} = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [runLink, setRunLink] = useState<string | null>(null);
  const viaWallet = isOwner && !!publicKey;
  const canAct = viaWallet || demo;

  async function decide(p: Payment, action: "approve" | "decline") {
    if (!team) return;
    setBusy(p.address + action);
    setRunLink(null);
    const started = performance.now();
    const secs = () => ((performance.now() - started) / 1000).toFixed(2);
    const svc = serviceName(p.service, services);
    setStatus({tone: "wait", text: `${action === "approve" ? "Approving" : "Declining"} ${usdc(p.amount)} for ${svc}${viaWallet ? "…" : " as the demo owner…"}`});
    try {
      if (viaWallet) {
        const ix = action === "approve" ? ixs.approve({owner: publicKey!, team, payment: p}) : ixs.decline({owner: publicKey!, team: team.address, payment: p.address});
        const sent = await send([ix]);
        setStatus(sentStatus(sent, action === "approve" ? `Approved. ${usdc(p.amount)} left the vault for ${svc} in one transaction, ${secs()} s after your click.` : "Declined. Nothing moved."));
        // A compute payment (its intent starts with "c"): once the approval is confirmed, start the run.
        if (action === "approve" && sent.status === "confirmed" && isComputeIntent(p.intent)) await startComputeRun(p.intent, sent.signature);
      } else {
        const res = await fetch("/api/demo", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, payment: p.address})});
        const r = (await res.json().catch(() => ({ok: false, error: `no answer (${res.status})`}))) as DemoReply;
        if (r.status === "confirmed") {
          if (r.result === "settled") {
            setStatus({tone: "ok", text: `Approved and settled: ${usdc(p.amount)} landed with ${svc}, ${secs()} s after your click.`, tx: r.signature});
            if (action === "approve" && isComputeIntent(p.intent)) await startComputeRun(p.intent, r.signature ?? null);
          }
          else if (r.result === "refused") setStatus({tone: "bad", text: "Approved, but a hard stop applied (revoked, expired or the service changed), so the program refused it. Nothing moved.", tx: r.signature});
          else if (r.result === "declined") setStatus({tone: "quiet", text: `Declined in ${secs()} s. Nothing moved.`, tx: r.signature});
          else setStatus({tone: "ok", text: `Done in ${secs()} s.`, tx: r.signature});
        } else if (r.status === "pending") {
          setStatus({tone: "wait", text: "Sent, not confirmed yet. The payment updates here when it lands; do not press again.", tx: r.signature});
        } else {
          setStatus({tone: "bad", text: r.error ?? "The demo could not act on that payment.", tx: r.signature});
        }
      }
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(null);
      onChange();
    }
  }

  async function startComputeRun(intent: string, tx: string | null) {
    const runHref = `${base ?? `/app/${team?.address}`}/compute/${intent}`;
    setRunLink(runHref);
    setStatus({tone: "wait", text: "Approved. Starting the compute run…", tx});
    const o = await startRun(intent, await authHeaders());
    if (o.kind === "done") setStatus({tone: "ok", text: "Approved, and the run is done. Its answer is on the run page.", tx});
    else if (o.kind === "refunded") setStatus({tone: "wait", text: `Approved, but the run did not happen and was refunded${o.reason ? `: ${o.reason}` : ""}.`, tx: o.signature ?? tx});
    else if (o.kind === "running" || o.kind === "unpaid" || o.kind === "not_run") setStatus({tone: "wait", text: "Approved. The run has started; the run page shows its answer when it lands.", tx});
    else if (o.kind === "unavailable") setStatus({tone: "wait", text: `Approved, but the compute gateway is not available here (${o.error}). The payment stands; start the run from its page later.`, tx});
    else setStatus({tone: "wait", text: `Approved. The run did not start yet: ${"error" in o ? o.error : o.kind}. Start it from its page.`, tx});
  }

  const all = payments ?? [];
  let shown = only === "live" ? all.filter((p) => isLive(p, now)) : all.filter((p) => p.reasons !== 0 && !isLive(p, now));
  if (limit) shown = shown.slice(0, limit);

  return (
    <div className={styles.list}>
      {payments === null ? <p className={styles.approvalMeta}>Could not read payments from chain. This is a network problem, not an empty list.</p> : null}
      {payments !== null && shown.length === 0 ? (
        <p className={styles.approvalMeta}>{empty ?? (only === "live" ? "Nothing is waiting for the owner." : "No decided requests yet.")}</p>
      ) : null}
      {shown.map((p) => {
        const live = isLive(p, now);
        const left = Math.max(0, p.deadline - now);
        const reasons = reasonsOf(p.reasons);
        const href = base ? `${base}/activity/${p.address}` : null;
        return (
          <article key={p.address} className={styles.approval} data-done={live ? undefined : ""}>
            <div className={styles.approvalMain}>
              <div className={styles.approvalTop}>
                <span className={styles.approvalAmount}>{usdc(p.amount)}</span>
                <span className={styles.approvalWho}>
                  {spenderName(p.spender, spenders)} <span className={styles.muted}>({p.kind === "agent" ? "agent" : "person"})</span> → {serviceName(p.service, services)}
                </span>
                <PaymentPill p={p} now={now} />
              </div>
              {reasons.length ? (
                <ul className={styles.reasons} aria-label="Why it waits">
                  {reasons.map((r) => (
                    <li key={r} className={styles.reason}>
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.approvalMeta}>
                Payment #{p.number.toString()}
                {p.memo ? <> · “{p.memo}”</> : null}
                {href ? (
                  <>
                    {" · "}
                    <Link href={href} className={styles.explorer}>
                      Details
                    </Link>
                  </>
                ) : null}
              </p>
              {live ? (
                <div className={styles.countdown}>
                  <span className={styles.bar} aria-hidden="true">
                    <span className={styles.barFill} style={{inlineSize: `${(left / PENDING_TTL_SECS) * 100}%`}} />
                  </span>
                  {countdown(p.deadline, now * 1000)} left to approve · the USDC is still in the vault
                </div>
              ) : null}
            </div>
            {live && canAct ? (
              <div className={styles.approvalActions}>
                <Button variant="primary" busy={busy === p.address + "approve"} onClick={() => !busy && decide(p, "approve")}>
                  Approve
                </Button>
                <Button variant="secondary" busy={busy === p.address + "decline"} onClick={() => !busy && decide(p, "decline")}>
                  Decline
                </Button>
              </div>
            ) : null}
          </article>
        );
      })}
      {!canAct && shown.some((p) => isLive(p, now)) ? (
        publicKey ? <p className={styles.approvalMeta}>Only the team owner can approve or decline. Your signed-in wallet is not the owner.</p> : <SignInPrompt action="approve or decline" note="Only the team owner can." />
      ) : null}
      <StatusLine status={status} />
      {runLink ? (
        <Link href={runLink} className={styles.explorer}>
          Open the compute run
        </Link>
      ) : null}
    </div>
  );
}
