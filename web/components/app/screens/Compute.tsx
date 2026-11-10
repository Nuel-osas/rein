"use client";

// AI compute. The team's Rein agent buys runs from Rein's compute gateway, which runs them on 0G:
// chat, images and transcripts in a TEE through the 0G Compute SDK, and Claude, GPT or a short video
// clip relayed through 0G Private Computer with no TEE (each card says which, and whether this server can sell it yet).
// Every run is a payment under the agent's on-chain policy; the gateway checks it, runs it once, and
// delivers the result or refunds it. The purchases below are this team's Payment accounts for the
// catalog's services. The assistant (the agent that pays for services in plain words) lives here
// too, under the run panel; /assistant redirects to this page.

import Link from "next/link";
import {ago, short, usdc} from "@/lib/chain";
import {pda} from "@/lib/rein";
import {AgentPanel} from "../agent-panel";
import {PageHeader} from "../PageHeader";
import {ContentLoading} from "../ui";
import list from "../ListView.module.css";
import {PaymentPill, spenderName} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import rein from "../rein/rein.module.css";
import styles from "../pages/compute.module.css";
import {ComputePanel, useComputeSetup} from "../rein/ComputeCards";

const FACTS = ["Paid from the team vault", "Checked by the Rein program", "Over a limit, it waits for you", "Refunded if it cannot run", "Test USDC only"];

export function Compute() {
  const t = useTeamPage();
  const {catalog} = useComputeSetup(t.address);
  if (t.at === 0) return <ContentLoading label="Reading compute purchases from chain…" rows={3} />;

  // A purchase is a payment to one of the catalog's services, matched by its registry PDA. Without
  // the catalog nothing can be matched, which is unknown, not an empty history.
  const ids = catalog?.ok ? new Map(catalog.services.map((s) => [pda.service(s.id).toBase58(), s.id])) : null;
  const purchases = t.payments && ids ? t.payments.filter((p) => ids.has(p.service)) : null;
  const agents = t.spenders?.filter((s) => s.kind === "agent" && s.status !== "revoked") ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.lead}>
        <PageHeader
          kind="compute"
          title="AI compute"
          description="Claim your $0.30 of test USDC, set your Rein agent's budget, and let it buy model runs on 0G: chat, images and transcripts in a TEE, or Claude, GPT and short video clips relayed with no TEE. Every run is a payment in test USDC under the agent's own policy, and a run that cannot happen is refunded."
        />
        <ul className={styles.facts} aria-label="About these purchases">
          {FACTS.map((f) => (
            <li key={f} className={styles.fact}>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <ComputePanel teamAddress={t.address} />

      <section className={rein.section} aria-label="Assistant">
        <AgentPanel teamAddress={t.address} onActivity={() => void t.refresh()} />
      </section>

      <section className={rein.section} aria-labelledby="purchases">
        <div className={rein.sectionHead}>
          <h2 className={rein.sectionTitle} id="purchases">Purchases</h2>
          <Link href={`${t.base}/spenders`} className={rein.sectionLink}>
            {agents === null ? "Team →" : `${agents.length} ${agents.length === 1 ? "agent" : "agents"} on this team →`}
          </Link>
        </div>
        <div className={`${list.card} ${styles.purchases}`}>
          {t.payments === null ? <div className={list.empty}><p>Could not read this team&apos;s payments. This is not an empty history.</p></div> : null}
          {t.payments !== null && catalog === undefined ? <div className={list.empty}><p>Reading the compute catalog to match purchases…</p></div> : null}
          {t.payments !== null && catalog !== undefined && !catalog.ok ? (
            <div className={list.empty}><p>Purchases are matched to the compute catalog, which could not be read ({catalog.error}). This is not an empty history.</p></div>
          ) : null}
          {purchases?.length === 0 ? (
            <div className={list.empty}>
              <p>No compute bought yet. Pick a service above, or ask the assistant for a job that needs a model; each purchase appears here when its transaction lands.</p>
            </div>
          ) : null}
          {purchases?.length ? (
            <ul className={list.rows} aria-label="Compute purchases">
              {purchases.map((p) => (
                <li key={p.address}>
                  <Link href={`${t.base}/activity/${p.address}`} className={list.row}>
                    <span className={list.cell}>
                      <span className={list.main}>
                        {spenderName(p.spender, t.spenders)} → {ids?.get(p.service) ?? short(p.service)}
                      </span>
                      <span className={list.sub}>
                        #{p.number.toString()} · {ago(p.decidedAt || p.createdAt, t.now * 1000)}
                        {p.memo ? ` · ${p.memo}` : ""}
                      </span>
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
          ) : null}
        </div>
      </section>

      <p className={styles.foot}>
        Each purchase is a Rein payment read from chain. The result comes from Rein&apos;s compute gateway, which runs a paid intent once on 0G after checking the
        payment, or refunds it in full. A TEE-verified result carries the 0G provider&apos;s signature; a relayed one (Claude, GPT) is delivered unchecked and says so.
        Payments to services outside this catalog are under Activity.
      </p>
    </div>
  );
}
