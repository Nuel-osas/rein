"use client";

// Home: what the team holds and who can spend it, and nothing that another page already shows in
// full. The vault balance, a short summary that links to Team, Approvals and Activity, the $0.30
// claim card for the owner, what is waiting for the owner, and how the team is held on chain.
// Every amount is devnet test USDC; a failed read shows as a dash, never as zero.

import Link from "next/link";
import {PublicKey} from "@solana/web3.js";
import {PROGRAM_ID, short, usdc} from "@/lib/chain";
import {isLive, pda} from "@/lib/rein";
import {Money} from "../Money";
import {PageHeader} from "../PageHeader";
import {ContentLoading, EmptyState} from "../ui";
import page from "../pages/dashboard.module.css";
import {Explorer} from "../rein/bits";
import {ApprovalsList} from "../rein/ApprovalsList";
import {ClaimCard} from "../rein/ClaimCard";
import {useTeamPage} from "../rein/context";
import styles from "../rein/rein.module.css";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function Dashboard() {
  const t = useTeamPage();
  const info = t.team;

  if (t.at === 0) return <ContentLoading label="Reading the team from chain…" rows={3} />;
  if (t.missing) return <EmptyState as="h1" title="Not a Rein team" body={`${t.address} is not a Rein team on this cluster. Check the link, or open the demo team.`} action={<Link href="/app">Your teams</Link>} />;

  const waiting = (t.payments ?? []).filter((p) => isLive(p, t.now));
  const held = waiting.reduce((a, p) => a + p.amount, 0n);
  const active = t.spenders ? t.spenders.filter((s) => s.status !== "revoked") : null;
  const people = active ? active.filter((s) => s.kind === "person").length : 0;
  const agents = active ? active.filter((s) => s.kind === "agent").length : 0;
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

      <div className={page.top}>
        <div className={`${styles.figure} ${page.vault}`} data-strong="">
          <span className={styles.figureLabel}>In the vault</span>
          <Money value={t.balance} size="title" label="Vault balance" />
          <span className={styles.figureNote}>
            Devnet test USDC held by the team account, not real money.{info ? <> <Explorer id={info.vault}>Vault</Explorer></> : null}
          </span>
        </div>
        <section className={`${styles.figure} ${page.summary}`} aria-labelledby="summary">
          <h2 className={styles.figureLabel} id="summary">The team</h2>
          <ul className={page.lines}>
            <li>
              <Link href={`${t.base}/spenders`}>
                {active ? `${plural(people, "person", "people")} and ${plural(agents, "agent", "agents")} can pay` : "Could not read who can pay"}
              </Link>
            </li>
            <li>
              <Link href={`${t.base}/approvals`}>
                {t.payments ? (waiting.length ? `${plural(waiting.length, "payment", "payments")} waiting for the owner, ${usdc(held)} test USDC held` : "Nothing waiting for the owner") : "Could not read waiting payments"}
              </Link>
            </li>
            <li>
              <Link href={`${t.base}/activity`}>
                {info ? `${plural(Number(info.paidCount), "payment", "payments")} settled, ${usdc(info.paidTotal)} test USDC paid` : "Could not read payments"}
              </Link>
            </li>
          </ul>
        </section>
      </div>

      {t.isOwner ? <ClaimCard teamAddress={t.address} onClaimed={refresh} /> : null}

      <section className={styles.section} aria-labelledby="needs-you">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="needs-you">Needs you</h2>
          <Link href={`${t.base}/approvals`} className={styles.sectionLink}>All approvals →</Link>
        </div>
        <ApprovalsList team={info} payments={t.payments} spenders={t.spenders} services={t.services} isOwner={t.isOwner} demo={t.demo} now={t.now} onChange={refresh} limit={3} base={t.base} />
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
