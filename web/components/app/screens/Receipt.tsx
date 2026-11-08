"use client";

import Link from "next/link";
import {PublicKey} from "@solana/web3.js";
import {countdown, short, usdc} from "@/lib/chain";
import {isLive, pda, reasonsOf} from "@/lib/rein";
import {Money} from "../Money";
import {ContentLoading} from "../ui";
import styles from "../pages/receipt.module.css";
import {Explorer, PaymentPill, serviceName, spenderName} from "../rein/bits";
import {ApprovalsList} from "../rein/ApprovalsList";
import {useTeamPage} from "../rein/context";
import rein from "../rein/rein.module.css";

function Row({label, value}: {label: string; value: React.ReactNode}) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === "" ? "—" : value}</dd>
    </div>
  );
}

const when = (t: number) => (t ? new Date(t * 1000).toLocaleString("en-GB", {timeZone: "UTC", dateStyle: "medium", timeStyle: "medium"}) + " UTC" : null);

export function Receipt({id}: {id: string}) {
  const t = useTeamPage();
  if (t.at === 0) return <ContentLoading label="Reading this payment from chain…" rows={4} />;
  const p = t.payments?.find((x) => x.address === id) ?? null;

  if (!p) {
    return (
      <article className={styles.doc}>
        <Link className={styles.back} href={`${t.base}/activity`}>
          <span aria-hidden="true">←</span> Activity
        </Link>
        <div className={styles.failure}>
          <p className={styles.label}>Payment</p>
          <h1 className={styles.merchant}>{t.payments === null ? "Could not read payments" : "No such payment on this team"}</h1>
          <p className={styles.failureBody}>
            {t.payments === null ? "This is a network problem. Nothing on this page moved money; try again in a moment." : "The address is not a payment account of this team. Nothing on this page moved money."}
          </p>
        </div>
      </article>
    );
  }

  let derived: boolean | null = null;
  try {
    derived = pda.payment(new PublicKey(p.spender), p.intent).toBase58() === p.address;
  } catch {
    derived = null;
  }
  const moved = p.status === "paid" || p.status === "settled";
  const live = isLive(p, t.now);
  const spender = t.spenders?.find((s) => s.address === p.spender);

  return (
    <article className={styles.doc}>
      <Link className={styles.back} href={`${t.base}/activity`}>
        <span aria-hidden="true">←</span> Activity
      </Link>
      <div className={styles.document}>
        <header className={styles.masthead}>
          <div>
            <p className={styles.label}>{moved ? "Payment receipt" : "Payment record"}</p>
            <h1 className={styles.merchant}>{serviceName(p.service, t.services)}</h1>
          </div>
          <span className={styles.reference}>#{p.number.toString()}</span>
        </header>
        <div className={styles.columns}>
          <section className={styles.column} aria-labelledby="r-pay">
            <h2 className={styles.label} id="r-pay">
              {moved ? "Amount paid" : "Amount asked"}
            </h2>
            <div className={styles.figure}>
              <Money className={styles.amount} label="Amount" size="hero" value={p.amount} />
              <PaymentPill p={p} now={t.now} />
            </div>
            <dl className={styles.rows}>
              <Row label="Paid by" value={spender ? `${spender.label} · ${p.kind}` : short(p.spender, 6)} />
              <Row label="Signed by" value={<span className={rein.mono}>{short(p.authority, 6)}</span>} />
              <Row label="Authorized by" value={p.status === "paid" ? "The spender's policy" : p.status === "settled" ? "The owner's approval" : p.status === "pending" ? "Waiting for the owner" : p.status} />
              <Row label="Why it waited" value={p.reasons ? reasonsOf(p.reasons).join(", ") : "It did not: inside the policy"} />
              <Row label="Filed" value={when(p.createdAt)} />
              <Row label="Decided" value={when(p.decidedAt)} />
              {live ? <Row label="Approve within" value={countdown(p.deadline, t.now * 1000)} /> : null}
              <Row label="Memo" value={p.memo} />
            </dl>
          </section>
          <section className={styles.column} aria-labelledby="r-chain">
            <h2 className={styles.label} id="r-chain">
              Onchain record
            </h2>
            <dl className={styles.rows}>
              <Row label="Payment account" value={<Explorer id={p.address}>{short(p.address, 6)}</Explorer>} />
              <Row label="Intent" value={<span className={rein.mono}>{p.intent}</span>} />
              <Row label="Address check" value={derived === null ? "unknown" : derived ? "✓ PDA of (spender, intent): this intent can be paid once" : "does not match"} />
              <Row label="Service" value={<Explorer id={p.service}>{serviceName(p.service, t.services)}</Explorer>} />
              <Row label="Payee account" value={<Explorer id={p.payeeToken}>{short(p.payeeToken, 6)}</Explorer>} />
              <Row label="Spender account" value={<Explorer id={p.spender}>{spenderName(p.spender, t.spenders)}</Explorer>} />
              <Row label="Asset" value={`Test USDC · ${usdc(p.amount)}`} />
            </dl>
          </section>
        </div>
        {live ? (
          <ApprovalsList team={t.team} payments={[p]} spenders={t.spenders} services={t.services} isOwner={t.isOwner} demo={t.demo} now={t.now} onChange={() => void t.refresh()} />
        ) : null}
        <p className={styles.foot}>Accounts do not store signatures, so this record links the payment account itself. Its transaction history is on the explorer.</p>
      </div>
    </article>
  );
}
