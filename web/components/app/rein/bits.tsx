"use client";

// Small pieces every Rein screen shares: names for spenders and services, the status pill for a
// payment, an honest status line for a sent transaction, and explorer links.

import type {ReactNode} from "react";
import {explorer, short} from "@/lib/chain";
import type {Payment, Service, Spender} from "@/lib/rein";
import {StatusPill} from "../ui";
import styles from "./rein.module.css";

export function spenderName(spender: string, spenders: Spender[] | null) {
  return spenders?.find((s) => s.address === spender)?.label ?? short(spender);
}

export function serviceName(service: string, services: Service[] | null) {
  return services?.find((s) => s.address === service)?.id ?? short(service);
}

export function initials(label: string) {
  const words = label.trim().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2)).toUpperCase();
}

/** Paid and settled are green, waiting is amber, refused is red, the rest are quiet. */
export function PaymentPill({p, now}: {p: Payment; now: number}) {
  if (p.status === "paid") return <StatusPill tone="settled" label="Paid" />;
  if (p.status === "settled") return <StatusPill tone="settled" label="Approved · settled" />;
  if (p.status === "pending") return now < p.deadline ? <StatusPill tone="blocked" label="Waiting for owner" /> : <StatusPill tone="neutral" label="Expired" />;
  if (p.status === "refused") return <StatusPill tone="failed" label="Refused at approval" />;
  if (p.status === "declined") return <StatusPill tone="neutral" label="Declined" />;
  return <StatusPill tone="neutral" label="Cancelled" />;
}

export function Explorer({kind = "address", id, children}: {kind?: "address" | "tx"; id: string | null | undefined; children?: ReactNode}) {
  if (!id) return null;
  return (
    <a className={styles.explorer} href={explorer(kind, id)} target="_blank" rel="noreferrer">
      {children ?? (kind === "tx" ? "Transaction" : "Explorer")} <span aria-hidden="true">↗</span>
    </a>
  );
}

export type Status = {tone: "ok" | "wait" | "bad" | "quiet"; text: string; tx?: string | null} | null;

export function StatusLine({status}: {status: Status}) {
  if (!status) return null;
  return (
    <p className={styles.status} data-tone={status.tone} role="status">
      <span className={styles.statusDot} aria-hidden="true" />
      <span>
        {status.text} {status.tx ? <Explorer kind="tx" id={status.tx}>View transaction</Explorer> : null}
      </span>
    </p>
  );
}

/** One status line for a sent transaction. Unknown outcomes are pending, never failed. */
export function sentStatus(s: {signature: string | null; status: "confirmed" | "failed" | "pending"; error?: string}, done: string): Status {
  if (s.status === "confirmed") return {tone: "ok", text: done, tx: s.signature};
  if (s.status === "failed") return {tone: "bad", text: `Refused: ${s.error ?? "the program said no"}. Nothing moved.`, tx: s.signature};
  return {tone: "wait", text: `Sent, not confirmed yet${s.error ? ` (${s.error})` : ""}. Check before trying again.`, tx: s.signature};
}

export function Fact({label, children, note}: {label: string; children: ReactNode; note?: ReactNode}) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>
        {children}
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}
