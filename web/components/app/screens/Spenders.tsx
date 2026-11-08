"use client";

import Link from "next/link";
import {period, short, usdc} from "@/lib/chain";
import {remainingOf, rolled, type Spender} from "@/lib/rein";
import {ButtonLink} from "../Button";
import {SPENDER_STATUS_COPY} from "../copy";
import {PageHeader} from "../PageHeader";
import {Avatar, ContentLoading, Meter, StatusPill} from "../ui";
import list from "../ListView.module.css";
import styles from "../pages/spenders.module.css";
import {initials} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import {InviteControl} from "./Invite";

/**
 * Team: people and AI agents in one list, each marked Person or Agent. Agents link by their key,
 * people by their Spender account. The owner adds either from here, or invites someone by link.
 */
export function SpenderList() {
  const t = useTeamPage();
  if (t.at === 0) return <ContentLoading label="Reading the team from chain…" rows={2} />;
  const rows = t.spenders ?? [];
  const href = (s: Spender) => (s.kind === "agent" ? `${t.base}/agents/${s.authority}` : `${t.base}/spenders/${s.address}`);

  return (
    <div className={styles.page}>
      <PageHeader
        kind="spenders"
        title="Team"
        description="The people and AI agents who can pay from this vault in test USDC, and the limits the program checks on each payment. An agent is a keypair that holds no money."
        action={
          t.isOwner ? (
            <div className={styles.actions}>
              <ButtonLink href={`${t.base}/spenders/new`}>Add person</ButtonLink>
              <ButtonLink href={`${t.base}/agents/new`} variant="primary">
                Add agent
              </ButtonLink>
            </div>
          ) : undefined
        }
      />
      {t.isOwner ? <InviteControl team={t.address} teamName={t.team?.name ?? null} /> : null}
      <div className={`${list.card} ${styles.table}`}>
        <div className={list.head} aria-hidden="true">
          <span>Name</span>
          <span>Left this period</span>
          <span className={list.headNumeric}>Per payment cap</span>
          <span>Status</span>
        </div>
        {t.spenders === null ? (
          <div className={list.empty}>
            <p>Could not read the team from chain. This is a network problem, not a team with nobody in it.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className={list.empty}>
            <p>No one can pay from this vault yet. Add a person by their wallet address, or give an agent key an allowance and the services it may pay.</p>
            {t.isOwner ? <ButtonLink href={`${t.base}/agents/new`}>Add agent</ButtonLink> : null}
          </div>
        ) : (
          <ul className={list.rows} aria-label="People and agents">
            {rows.map((s) => {
              const r = rolled(s, t.now);
              const left = s.policy.allowance > r.spent ? s.policy.allowance - r.spent : 0n;
              const expired = t.now >= s.policy.expiresAt && s.status !== "revoked";
              const status = SPENDER_STATUS_COPY[expired ? "expired" : s.status];
              return (
                <li key={s.address}>
                  <Link href={href(s)} className={`${list.row} ${styles.row}`}>
                    <span className={`${list.who} ${styles.cellName}`}>
                      <Avatar initials={initials(s.label)} kind={s.kind} small />
                      <span className={list.cell}>
                        <span className={list.main}>{s.label}</span>
                        <span className={list.sub}>
                          {s.kind === "agent" ? "Agent" : "Person"} · {short(s.authority, 4)}
                        </span>
                      </span>
                    </span>
                    <div className={`${list.cell} ${styles.cellLeft}`}>
                      <span className={`${list.text} ${styles.figure}`}>
                        {usdc(left)} <span className={styles.of}>of {usdc(s.policy.allowance)}</span>
                      </span>
                      <div className={styles.meter}>
                        <Meter spent={r.spent} allowance={s.policy.allowance} />
                      </div>
                      <span className={list.sub}>
                        Per {period(s.policy.periodSecs)} · {r.count}/{s.policy.maxPayments} payments · can pay {usdc(remainingOf(s, t.now, !!t.team?.paused))} now
                      </span>
                    </div>
                    <span className={`${list.cell} ${list.numeric} ${styles.cellCap}`}>
                      <span className={`${list.text} ${styles.figure}`}>{usdc(s.policy.cap)}</span>
                      <span className={`${list.sub} ${styles.capWord}`}>per payment</span>
                    </span>
                    <span className={`${list.cell} ${styles.cellStatus}`}>
                      <StatusPill tone={status.tone} label={status.label} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
