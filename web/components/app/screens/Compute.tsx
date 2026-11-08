"use client";

// AI compute. Nuntio sells verified inference runs; Rein's equivalent is an AI agent buying compute
// services from the registry (llm-inference, gpu-hour) under its policy. This page lists those
// services and this team's purchases of them, from its Payment accounts. Rein records the payment,
// not the run: the service delivers the work off chain, so no run, output or proof is shown here.

import Link from "next/link";
import {ago, short, usdc} from "@/lib/chain";
import {groupBy} from "@/lib/metrics";
import {ButtonLink} from "../Button";
import {PageHeader} from "../PageHeader";
import {ContentLoading, EmptyState} from "../ui";
import list from "../ListView.module.css";
import {PaymentPill, spenderName} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import rein from "../rein/rein.module.css";
import styles from "../pages/compute.module.css";
import {ComputePanel, useComputeSetup} from "../rein/ComputeCards";

/** The registry ids this page counts as compute. Anything else the agent buys is under Activity. */
export const COMPUTE_IDS = ["llm-inference", "gpu-hour"] as const;

const KIND: Record<(typeof COMPUTE_IDS)[number], {kind: string; unit: string; blurb: string}> = {
  "llm-inference": {kind: "LLM", unit: "a call", blurb: "Model inference the agent pays per call, from the vault, under its own cap and allowance."},
  "gpu-hour": {kind: "GPU", unit: "an hour", blurb: "Rented GPU time, paid per hour. A job over the agent's cap or allowance waits on chain for the owner."},
};

const FACTS = ["Paid from the team vault", "Checked by the Rein program", "Over a limit, it waits for you", "Test USDC only"];

export function Compute() {
  const t = useTeamPage();
  const {agentKey, catalog} = useComputeSetup(t.address);
  if (t.at === 0) return <ContentLoading label="Reading compute purchases from chain…" rows={3} />;

  const services = t.services ? COMPUTE_IDS.map((id) => ({id, service: t.services!.find((s) => s.id === id) ?? null})) : null;
  // Purchases count the registry's legacy compute ids and every service the gateway's catalog sells.
  const catalogIds = new Set(catalog?.ok ? catalog.services.map((c) => c.id) : []);
  const addresses = new Set([
    ...(services ?? []).flatMap((x) => (x.service ? [x.service.address] : [])),
    ...(t.services ?? []).filter((s) => catalogIds.has(s.id)).map((s) => s.address),
  ]);
  const purchases = t.payments && services ? t.payments.filter((p) => addresses.has(p.service)) : null;
  const totals = purchases ? new Map(groupBy(purchases, (p) => p.service, t.now).map((g) => [g.key, g])) : null;
  const agents = t.spenders?.filter((s) => s.kind === "agent" && s.status !== "revoked") ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.lead}>
        <PageHeader
          kind="compute"
          title="AI compute"
          description="Claim your $0.30 of test USDC, set your Rein agent's budget, and let it buy model runs on the 0G Compute Network. Every run is a payment under the agent's own policy."
          action={<ButtonLink href={`${t.base}/assistant`} variant="secondary">Open the assistant</ButtonLink>}
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

      {services === null ? (
        <EmptyState title="Could not read the service registry" body="This is a problem reaching the network, not a registry without compute. Nothing was charged." />
      ) : (
        <ul className={styles.grid}>
          {services.map(({id, service}) => {
            const g = service && totals ? totals.get(service.address) : undefined;
            return (
              <li key={id} className={styles.card} aria-label={`${KIND[id].kind}: ${service?.label ?? id}`}>
                <div className={styles.cardTop}>
                  <span className={styles.kind}>{KIND[id].kind}</span>
                  <span className={styles.tee}>{service ? (service.active ? id : `${id} · suspended`) : `${id} · not listed`}</span>
                </div>
                <h2 className={styles.model}>{service?.label ?? id}</h2>
                <p className={styles.spec}>
                  {service ? KIND[id].blurb : `${id} is not in this cluster's registry, so no agent can buy it here.`}
                  {service ? <> Payee <span className={rein.mono}>{short(service.payee, 4)}</span>.</> : null}
                </p>
                <div className={styles.cardFoot}>
                  {service ? (
                    <p className={styles.price}>
                      <span>{usdc(service.price)}</span>
                      <small>{KIND[id].unit}, list price</small>
                    </p>
                  ) : (
                    <span />
                  )}
                  <p className={styles.bought}>
                    {totals === null ? (
                      "Purchases could not be read"
                    ) : (
                      <>
                        <b>{g?.paidCount ?? 0}</b> bought · <b>{usdc(g?.paid ?? 0n)}</b>
                        {g?.waiting ? ` · ${g.waiting} waiting` : ""}
                      </>
                    )}
                  </p>
                </div>
                {service ? (
                  <Link href={`${t.base}/recipients/${id}`} className={rein.sectionLink}>
                    Service details →
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <section className={rein.section} aria-labelledby="purchases">
        <div className={rein.sectionHead}>
          <h2 className={rein.sectionTitle} id="purchases">Purchases</h2>
          <Link href={`${t.base}/agents`} className={rein.sectionLink}>
            {agents === null ? "Agents →" : `${agents.length} ${agents.length === 1 ? "agent" : "agents"} on this team →`}
          </Link>
        </div>
        <div className={`${list.card} ${styles.purchases}`}>
          {t.payments === null ? <div className={list.empty}><p>Could not read this team&apos;s payments. This is not an empty history.</p></div> : null}
          {t.payments !== null && services === null ? <div className={list.empty}><p>Purchases are matched to the registry, which could not be read.</p></div> : null}
          {purchases?.length === 0 ? (
            <div className={list.empty}>
              <p>No compute bought yet. Ask the assistant for a job that needs a model call or GPU time; each purchase appears here when its transaction lands.</p>
              <ButtonLink href={`${t.base}/assistant`}>Open the assistant</ButtonLink>
            </div>
          ) : null}
          {purchases?.length ? (
            <ul className={list.rows} aria-label="Compute purchases">
              {purchases.map((p) => (
                <li key={p.address}>
                  <Link href={`${t.base}/activity/${p.address}`} className={list.row}>
                    <span className={list.cell}>
                      <span className={list.main}>
                        {spenderName(p.spender, t.spenders)} → {t.services?.find((s) => s.address === p.service)?.id ?? short(p.service)}
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
        Rein records the payment, not the run. The service delivers the work off chain, so this page shows what was bought, by whom and what the program decided, and
        never an output it did not see. Other services the agent buys, such as web-search or market-data, are under Activity and Metrics.
      </p>
    </div>
  );
}
