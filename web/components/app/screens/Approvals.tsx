"use client";

import {isLive} from "@/lib/rein";
import {PageHeader} from "../PageHeader";
import {ContentLoading} from "../ui";
import page from "../pages/approvals.module.css";
import {ApprovalsList} from "../rein/ApprovalsList";
import {useTeamPage} from "../rein/context";
import styles from "../rein/rein.module.css";

export function Approvals() {
  const t = useTeamPage();
  if (t.at === 0) return <ContentLoading label="Reading payments from chain…" rows={3} />;
  const waiting = (t.payments ?? []).filter((p) => isLive(p, t.now)).length;
  const refresh = () => void t.refresh();
  const common = {team: t.team, payments: t.payments, spenders: t.spenders, services: t.services, isOwner: t.isOwner, demo: t.demo, now: t.now, onChange: refresh, base: t.base};
  return (
    <div className={page.page}>
      <PageHeader
        kind="approvals"
        title="Approvals"
        description="A payment past a limit is filed on chain as a Pending payment, and the USDC stays in the vault. Only the owner can settle it, within a day; approval re-checks the hard stops and moves the money in one transaction."
      />
      {t.demo && !t.isOwner ? (
        <p className={styles.notice}>
          <b>Public demo team.</b> You can approve or decline as the owner without a wallet. The server signs with the demo owner&apos;s key.
        </p>
      ) : null}
      <section className={styles.section} aria-labelledby="waiting">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="waiting">Waiting now{waiting ? ` · ${waiting}` : ""}</h2>
        </div>
        <ApprovalsList {...common} only="live" empty="Nothing is waiting. When a spender goes over a limit, the payment appears here, held on chain." />
      </section>
      <section className={styles.section} aria-labelledby="decided">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="decided">Decided</h2>
        </div>
        <ApprovalsList {...common} only="history" />
      </section>
    </div>
  );
}
