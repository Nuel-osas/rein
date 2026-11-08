"use client";

import Link from "next/link";
import {period, short, usdc} from "@/lib/chain";
import {remainingOf, rolled, type Kind, type Spender} from "@/lib/rein";
import {ButtonLink} from "../Button";
import {SPENDER_STATUS_COPY} from "../copy";
import {PageHeader} from "../PageHeader";
import {Avatar, ContentLoading, Meter, StatusPill} from "../ui";
import list from "../ListView.module.css";
import styles from "../pages/spenders.module.css";
import {initials} from "../rein/bits";
import {useTeamPage} from "../rein/context";

/** Spenders and agents share one list; agents link by their key, people by their Spender account. */
export function SpenderList({kind}: {kind?: Kind}) {
  const t = useTeamPage();
  if (t.at === 0) return <ContentLoading label="Reading spenders from chain…" rows={2} />;
  const rows = (t.spenders ?? []).filter((s) => !kind || s.kind === kind);
  const agents = kind === "agent";
  const href = (s: Spender) => (s.kind === "agent" ? `${t.base}/agents/${s.authority}` : `${t.base}/spenders/${s.address}`);

  return (
    <div className={styles.page}>
      <PageHeader
        kind="spenders"
        title={agents ? "Agents" : "Spenders"}
        description={
          agents
            ? "AI agents that can pay from this vault. Each is a keypair that holds no money, checked against its own Spender account on every payment."
            : "People and agents who can pay from this vault, and the limits the program checks on each payment."
        }
        action={
          t.isOwner ? (
            <div className={styles.actions}>
              {agents ? null : <ButtonLink href={`${t.base}/spenders/new`}>Add a person</ButtonLink>}
              <ButtonLink href={`${t.base}/agents/new`} variant="primary">
                Add an agent
              </ButtonLink>
            </div>
          ) : undefined
        }
      />
      <div className={`${list.card} ${styles.table}`}>
        <div className={list.head} aria-hidden="true">
          <span>Name</span>
          <span>Left this period</span>
          <span className={list.headNumeric}>Per payment cap</span>
          <span>Status</span>
        </div>
        {t.spenders === null ? (
          <div className={list.empty}>
            <p>Could not read spenders from chain. This is a network problem, not a team with nobody in it.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className={list.empty}>
            <p>{agents ? "No agents yet. Give an agent key an allowance and the services it may pay, and it appears here." : "No one can pay from this vault yet."}</p>
            {t.isOwner ? <ButtonLink href={`${t.base}/agents/new`}>Add an agent</ButtonLink> : null}
          </div>
        ) : (
          <ul className={list.rows} aria-label={agents ? "Agents" : "Spenders"}>
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
