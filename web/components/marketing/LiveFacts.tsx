"use client";

// The landing's live readings from the demo team, read from chain: the facts beside the capability
// rows and the hero's latest-payment card. A failed read shows as a dash, never a zero.

import type {CSSProperties, ReactNode} from "react";
import {DEMO_TEAM, ago, usdc} from "@/lib/chain";
import {isLive} from "@/lib/rein";
import {useNow, useTeam} from "@/lib/team";
import {NETWORK_NAME} from "@/components/app/network-copy";

function useDemo() {
  const t = useTeam(DEMO_TEAM, 5000);
  const now = useNow();
  const name = (spender: string) => t.spenders?.find((s) => s.address === spender)?.label ?? "A spender";
  const service = (addr: string) => t.services?.find((s) => s.address === addr)?.id ?? "a service";
  return {t, now, name, service};
}

export function LiveFacts({factClass, noteClass}: {factClass: string; noteClass: string}) {
  const {t, now, service} = useDemo();
  const agent = t.spenders?.find((s) => s.kind === "agent" && s.status !== "revoked");
  const waiting = t.payments?.find((p) => isLive(p, now));
  const paid = t.payments?.find((p) => p.status === "paid" || p.status === "settled");
  const facts = [
    {label: `${agent?.label ?? "Research agent"} · AI agent`, value: agent ? `${usdc(agent.policy.cap)} cap` : "—", note: "Its key holds no money"},
    {label: "Team vault", value: usdc(t.balance), note: "Test USDC"},
    {label: "Pending", value: waiting ? usdc(waiting.amount) : t.payments ? "None" : "—", note: waiting ? "Held on chain for the owner" : "Nothing waiting"},
    {label: paid ? service(paid.service) : "Service", value: paid ? `Paid ${usdc(paid.amount)}` : "—", note: paid ? (paid.status === "settled" ? "Approved, then settled" : "Settled in the same transaction") : "No payment yet"},
    {label: "Settlement", value: "Under a second", note: "Fee paid by the sponsor"},
  ];
  return (
    <>
      {facts.map((fact, i) => (
        <div key={i} className={factClass} data-fact="" data-on="true" style={{"--i": i} as CSSProperties}>
          <small>{fact.label}</small>
          <strong>{fact.value}</strong>
          <span>{fact.note}</span>
        </div>
      ))}
      <span className={noteClass}>{DEMO_TEAM ? `Live from the demo team on ${NETWORK_NAME}` : "Example values"}</span>
    </>
  );
}

export function LiveNews({className, metaClass, titleClass, children}: {className: string; metaClass: string; titleClass: string; children: ReactNode}) {
  const {t, now, name, service} = useDemo();
  const latest = t.payments?.[0];
  const title = latest
    ? latest.status === "pending"
      ? `${name(latest.spender)} asked for ${usdc(latest.amount)} for ${service(latest.service)}. It waits for the owner.`
      : latest.status === "paid" || latest.status === "settled"
        ? `${name(latest.spender)} paid ${usdc(latest.amount)} to ${service(latest.service)}`
        : `${name(latest.spender)}’s ${usdc(latest.amount)} for ${service(latest.service)} was ${latest.status}. Nothing moved.`
    : "Approve an agent’s payment, no wallet needed";
  return (
    <a className={className} href="/demo">
      <span className={metaClass}>
        <span>{latest ? "Live on chain" : "Latest"}</span>
        <span>{latest ? ago(latest.decidedAt || latest.createdAt, now * 1000) : "Live demo"}</span>
      </span>
      <span className={titleClass}>{title}</span>
      {children}
    </a>
  );
}
