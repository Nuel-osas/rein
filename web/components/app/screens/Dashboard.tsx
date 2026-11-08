"use client";

import Link from "next/link";
import {PublicKey} from "@solana/web3.js";
import {PROGRAM_ID, ago, short, usdc} from "@/lib/chain";
import {isLive, pda, remainingOf, rolled} from "@/lib/rein";
import {AgentPanel} from "../agent-panel";
import {Money} from "../Money";
import {PageHeader} from "../PageHeader";
import {Avatar, ContentLoading, EmptyState, Meter} from "../ui";
import list from "../ListView.module.css";
import page from "../pages/dashboard.module.css";
import {Explorer, PaymentPill, initials, serviceName, spenderName} from "../rein/bits";
import {ApprovalsList} from "../rein/ApprovalsList";
import {ClaimCard} from "../rein/ClaimCard";
import {useTeamPage} from "../rein/context";
import styles from "../rein/rein.module.css";

function countWords(list: {kind: string}[]) {
  const people = list.filter((s) => s.kind === "person").length;
  const agents = list.filter((s) => s.kind === "agent").length;
  return `${people} ${people === 1 ? "person" : "people"} · ${agents} ${agents === 1 ? "agent" : "agents"}`;
}

export function Dashboard() {
  const t = useTeamPage();
  const info = t.team;

  if (t.at === 0) return <ContentLoading label="Reading the team from chain…" rows={3} />;
  if (t.missing) return <EmptyState as="h1" title="Not a Rein team" body={`${t.address} is not a Rein team on this cluster. Check the link, or open the demo team.`} action={<Link href="/app">Your teams</Link>} />;

  const waiting = (t.payments ?? []).filter((p) => isLive(p, t.now));
  const held = waiting.reduce((a, p) => a + p.amount, 0n);
  const role = t.isOwner ? "owner" : t.me ? "spender" : t.wallet ? "viewer" : "viewer, signed out";
  let derivedOk: boolean | null = null;
  let vaultOk: boolean | null = null;
  if (info) {
    try {
      derivedOk = pda.team(new PublicKey(info.owner)).toBase58() === t.address;
      vaultOk = pda.vault(new PublicKey(info.mint), new PublicKey(t.address)).toBase58() === info.vault;
    } catch {
      derivedOk = vaultOk = null;
    }
  }
  const refresh = () => void t.refresh();

  return (
    <div className={page.page}>
      <PageHeader
        kind="overview"
        title={info ? `Today at ${info.name}` : "Team"}
        description={
          <>
            You are the {role}. Owner <span className={styles.mono}>{info ? short(info.owner, 6) : "—"}</span> · <Explorer id={t.address}>Team account</Explorer>
          </>
        }
      />

      {t.demo && !t.isOwner ? (
        <p className={styles.notice}>
          <b>Public demo team.</b> No sign-in needed: Approve and Decline below are signed on the server with the demo owner&apos;s key, and land on chain like any
          owner&apos;s would.
        </p>
      ) : null}
      {info?.paused ? <p className={styles.notice}><b>The team is paused.</b> No payment or settlement can move money until the owner resumes it.</p> : null}

      <div className={styles.figures}>
        <div className={styles.figure} data-strong="">
          <span className={styles.figureLabel}>In the vault</span>
          <Money value={t.balance} size="title" label="Vault balance" />
          <span className={styles.figureNote}>Test USDC held by the team PDA</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Paid so far</span>
          <span className={styles.figureValue}>{info ? usdc(info.paidTotal) : "—"}</span>
          <span className={styles.figureNote}>{info ? `${info.paidCount.toString()} payments settled` : ""}</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Waiting for the owner</span>
          <span className={styles.figureValue}>{t.payments ? String(waiting.length) : "—"}</span>
          <span className={styles.figureNote}>{waiting.length ? `${usdc(held)} held on chain` : "Nothing held"}</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Spenders</span>
          <span className={styles.figureValue}>{t.spenders ? String(t.spenders.filter((s) => s.status !== "revoked").length) : "—"}</span>
          <span className={styles.figureNote}>
            {t.spenders ? countWords(t.spenders.filter((s) => s.status !== "revoked")) : ""}
          </span>
        </div>
      </div>

      {t.isOwner ? <ClaimCard team={t.address} isOwner={t.isOwner} onClaimed={refresh} /> : null}

      <section className={styles.section} aria-labelledby="needs-you">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="needs-you">Needs you</h2>
          <Link href={`${t.base}/approvals`} className={styles.sectionLink}>All approvals →</Link>
        </div>
        <ApprovalsList team={info} payments={t.payments} spenders={t.spenders} services={t.services} isOwner={t.isOwner} demo={t.demo} now={t.now} onChange={refresh} limit={4} base={t.base} />
      </section>

      <section className={styles.section} aria-label="Agent">
        <AgentPanel teamAddress={t.address} onActivity={refresh} />
      </section>

      <section className={styles.section} aria-labelledby="budgets">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="budgets">Budgets right now</h2>
          <Link href={`${t.base}/spenders`} className={styles.sectionLink}>Spenders →</Link>
        </div>
        <div className={list.card} style={{["--cols" as string]: "minmax(12rem,1.2fr) minmax(14rem,1.6fr) minmax(7rem,.6fr)"}}>
          <div className={list.head} aria-hidden="true">
            <span>Name</span>
            <span>Used this period</span>
            <span className={list.headNumeric}>Can pay now</span>
          </div>
          {t.spenders === null ? <div className={list.empty}><p>Could not read spenders.</p></div> : null}
          {t.spenders?.length === 0 ? <div className={list.empty}><p>No spenders yet. The owner adds people and agents under Spenders.</p></div> : null}
          <ul className={list.rows} aria-label="Budgets">
            {t.spenders
              ?.filter((s) => s.status !== "revoked")
              .map((s) => {
                const r = rolled(s, t.now);
                return (
                  <li key={s.address}>
                    <Link href={s.kind === "agent" ? `${t.base}/agents/${s.authority}` : `${t.base}/spenders/${s.address}`} className={list.row}>
                      <span className={list.who}>
                        <Avatar initials={initials(s.label)} kind={s.kind} small />
                        <span className={list.cell}>
                          <span className={list.main}>{s.label}</span>
                          <span className={list.sub}>{s.kind === "agent" ? "Agent" : "Person"}{s.status !== "active" ? ` · ${s.status}` : ""}</span>
                        </span>
                      </span>
                      <span className={list.cell}>
                        <span className={list.text}>
                          {usdc(r.spent)} <span className={styles.muted}>of {usdc(s.policy.allowance)}</span>
                        </span>
                        <Meter spent={r.spent} allowance={s.policy.allowance} />
                        <span className={list.sub}>
                          {r.count}/{s.policy.maxPayments} payments · cap {usdc(s.policy.cap)}
                        </span>
                      </span>
                      <span className={`${list.cell} ${list.numeric}`}>
                        <span className={list.text}>{usdc(remainingOf(s, t.now, !!info?.paused))}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="recent">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="recent">Recent</h2>
          <Link href={`${t.base}/activity`} className={styles.sectionLink}>All activity →</Link>
        </div>
        <div className={list.card} style={{["--cols" as string]: "minmax(12rem,1.4fr) minmax(9rem,.8fr) minmax(7rem,.6fr)"}}>
          {t.payments === null ? <div className={list.empty}><p>Could not read payments.</p></div> : null}
          {t.payments?.length === 0 ? <div className={list.empty}><p>No payments yet. Each one appears here the moment its transaction lands.</p></div> : null}
          <ul className={list.rows} aria-label="Recent payments">
            {t.payments?.slice(0, 6).map((p) => (
              <li key={p.address}>
                <Link href={`${t.base}/activity/${p.address}`} className={list.row}>
                  <span className={list.cell}>
                    <span className={list.main}>
                      {spenderName(p.spender, t.spenders)} → {serviceName(p.service, t.services)}
                    </span>
                    <span className={list.sub}>#{p.number.toString()} · {ago(p.decidedAt || p.createdAt, t.now * 1000)}</span>
                  </span>
                  <span className={list.cell}>
                    <PaymentPill p={p} now={t.now} />
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

      <section className={styles.section} aria-labelledby="held">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="held">How this team is held</h2>
        </div>
        <ul className={styles.checksList}>
          <li>
            <span className={derivedOk ? styles.tick : styles.tickOff} aria-hidden="true">{derivedOk ? "✓" : "·"}</span>
            <span>
              <b>The team is a PDA of its owner</b>
              <small>Seeds [&quot;team&quot;, owner]: {derivedOk === null ? "unknown" : derivedOk ? "matches" : "does not match"}</small>
            </span>
          </li>
          <li>
            <span className={vaultOk ? styles.tick : styles.tickOff} aria-hidden="true">{vaultOk ? "✓" : "·"}</span>
            <span>
              <b>The vault belongs to the team PDA</b>
              <small>
                {vaultOk === null ? "unknown" : vaultOk ? "No private key can sign for it; only the program moves this USDC." : "vault mismatch"} {info ? <Explorer id={info.vault}>Vault</Explorer> : null}
              </small>
            </span>
          </li>
          <li>
            <span className={styles.tick} aria-hidden="true">✓</span>
            <span>
              <b>Rules enforced by the Rein program</b>
              <small>
                <Explorer id={PROGRAM_ID.toBase58()}>{short(PROGRAM_ID.toBase58(), 6)}</Explorer>
              </small>
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
