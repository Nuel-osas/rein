"use client";

// The live half of /demo: the seeded team read from chain every 1.5 s, its pending payments with
// server-signed Approve and Decline (/api/demo), the agent panel, and the latest payments. Dark,
// like the app, inside the light marketing page.

import Link from "next/link";
import {useState} from "react";
import {DEMO_TEAM, ago, short, usdc} from "@/lib/chain";
import {isLive, remainingOf, rolled} from "@/lib/rein";
import {useNow, useTeam} from "@/lib/team";
import {WalletProvider} from "@/lib/wallet";
import {AgentPanel} from "@/components/app/agent-panel";
import {Button} from "@/components/app/Button";
import {Money} from "@/components/app/Money";
import {Avatar, Meter} from "@/components/app/ui";
import list from "@/components/app/ListView.module.css";
import {ApprovalsList} from "@/components/app/rein/ApprovalsList";
import {Explorer, PaymentPill, StatusLine, initials, sentStatus, serviceName, spenderName, type Status} from "@/components/app/rein/bits";
import rein from "@/components/app/rein/rein.module.css";
import styles from "./DemoLive.module.css";

export function DemoLive() {
  return (
    <WalletProvider>
      <section className={styles.band} data-theme="dark" data-app="" aria-label="The demo team, live">
        <div className={styles.inner}>{DEMO_TEAM ? <Live team={DEMO_TEAM} /> : <p className={rein.panelNote}>No demo team is configured on this server (NEXT_PUBLIC_DEMO_TEAM).</p>}</div>
      </section>
    </WalletProvider>
  );
}

function Live({team}: {team: string}) {
  const t = useTeam(team, 1500);
  const now = useNow();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const waiting = (t.payments ?? []).filter((p) => isLive(p, now));
  const refresh = () => void t.refresh();

  async function reset() {
    setBusy(true);
    setStatus({tone: "wait", text: "Topping the vault back up to 500 test USDC…"});
    try {
      const res = await fetch("/api/demo", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "reset"})});
      const r = (await res.json().catch(() => ({ok: false, error: `no answer (${res.status})`}))) as {status?: "confirmed" | "failed" | "pending"; signature?: string | null; error?: string; note?: string};
      if (r.note) setStatus({tone: "quiet", text: r.note});
      else if (r.status) setStatus(sentStatus({signature: r.signature ?? null, status: r.status, error: r.error}, "The vault is back at 500 test USDC."));
      else setStatus({tone: "bad", text: r.error ?? "The reset was refused."});
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className={styles.grid}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Demo team · read from chain</p>
          <h2 className={styles.title}>{t.team?.name ?? (t.at ? "—" : "Reading…")}</h2>
          <p className={rein.panelNote}>
            Team <Explorer id={team}>{short(team, 6)}</Explorer> · owner {t.team ? short(t.team.owner, 4) : "—"} · approvals here are signed on the server with the demo owner&apos;s key
          </p>
        </div>
        <div className={styles.vault}>
          <span className={rein.figureLabel}>In the vault</span>
          <Money value={t.balance} size="hero" label="Vault balance" />
          <Button small busy={busy} onClick={() => void reset()}>
            Top up to $500
          </Button>
        </div>
      </header>

      <section className={rein.section} aria-labelledby="demo-waiting">
        <div className={rein.sectionHead}>
          <h3 className={rein.sectionTitle} id="demo-waiting">
            Waiting for the owner{waiting.length ? ` · ${waiting.length}` : ""}
          </h3>
          <Link className={rein.sectionLink} href={`/app/${team}/approvals`}>
            All approvals →
          </Link>
        </div>
        <ApprovalsList
          team={t.team}
          payments={t.payments}
          spenders={t.spenders}
          services={t.services}
          isOwner={false}
          demo
          now={now}
          onChange={refresh}
          base={`/app/${team}`}
          empty="Nothing is waiting right now. Run Over the limit below: the agent buys ai-claude, which is not on its list, and the payment stops here."
        />
      </section>

      <section className={rein.section} aria-label="Agent">
        <AgentPanel teamAddress={team} onActivity={refresh} />
      </section>

      <div className={styles.two}>
        <section className={rein.section} aria-labelledby="demo-budgets">
          <h3 className={rein.sectionTitle} id="demo-budgets">
            Budgets right now
          </h3>
          <div className={list.card} style={{["--cols" as string]: "minmax(10rem,1fr) minmax(7rem,.6fr)"}}>
            {t.spenders === null && t.at ? <div className={list.empty}><p>Could not read spenders.</p></div> : null}
            <ul className={list.rows}>
              {t.spenders
                ?.filter((s) => s.status !== "revoked")
                .map((s) => {
                  const r = rolled(s, now);
                  return (
                    <li key={s.address}>
                      <Link href={s.kind === "agent" ? `/app/${team}/agents/${s.authority}` : `/app/${team}/spenders/${s.address}`} className={list.row}>
                        <span className={list.who}>
                          <Avatar initials={initials(s.label)} kind={s.kind} small />
                          <span className={list.cell}>
                            <span className={list.main}>{s.label}</span>
                            <span className={list.sub}>
                              {usdc(r.spent)} of {usdc(s.policy.allowance)} · cap {usdc(s.policy.cap)}
                            </span>
                            <Meter spent={r.spent} allowance={s.policy.allowance} />
                          </span>
                        </span>
                        <span className={`${list.cell} ${list.numeric}`}>
                          <span className={list.text}>{usdc(remainingOf(s, now, !!t.team?.paused))}</span>
                          <span className={list.sub}>can pay now</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        </section>
        <section className={rein.section} aria-labelledby="demo-recent">
          <h3 className={rein.sectionTitle} id="demo-recent">
            Latest payments
          </h3>
          <div className={list.card} style={{["--cols" as string]: "minmax(10rem,1fr) minmax(6rem,.5fr)"}}>
            {t.payments === null && t.at ? <div className={list.empty}><p>Could not read payments.</p></div> : null}
            {t.payments?.length === 0 ? <div className={list.empty}><p>No payments yet.</p></div> : null}
            <ul className={list.rows}>
              {t.payments?.slice(0, 6).map((p) => (
                <li key={p.address}>
                  <Link href={`/app/${team}/activity/${p.address}`} className={list.row}>
                    <span className={list.cell}>
                      <span className={list.main}>
                        {spenderName(p.spender, t.spenders)} → {serviceName(p.service, t.services)}
                      </span>
                      <span className={list.sub}>
                        <PaymentPill p={p} now={now} /> {ago(p.decidedAt || p.createdAt, now * 1000)}
                      </span>
                    </span>
                    <span className={`${list.cell} ${list.numeric}`}>
                      <span className={list.text}>{usdc(p.amount)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
      <StatusLine status={status} />
    </div>
  );
}
