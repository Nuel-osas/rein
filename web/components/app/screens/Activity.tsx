"use client";

import Link from "next/link";
import {useState} from "react";
import {ago, usdc} from "@/lib/chain";
import {decimal} from "@/lib/money";
import {isLive, reasonsOf, type Payment} from "@/lib/rein";
import {Button} from "../Button";
import {FilterTabs, ListBar} from "../ListView";
import {PageHeader} from "../PageHeader";
import {Avatar, ContentLoading} from "../ui";
import list from "../ListView.module.css";
import page from "../pages/activity.module.css";
import {PaymentPill, initials, serviceName, spenderName} from "../rein/bits";
import {useTeamPage} from "../rein/context";

type Filter = "all" | "paid" | "waiting" | "other";

const COLS = "minmax(12rem,1.3fr) minmax(9rem,.9fr) minmax(10rem,.9fr) minmax(7rem,.6fr)";

export function Activity() {
  const t = useTeamPage();
  const [filter, setFilter] = useState<Filter>("all");
  if (t.at === 0) return <ContentLoading label="Reading payments from chain…" rows={4} />;
  const all = t.payments ?? [];
  const isPaid = (p: Payment) => p.status === "paid" || p.status === "settled";
  const shown = all.filter((p) =>
    filter === "all" ? true : filter === "paid" ? isPaid(p) : filter === "waiting" ? isLive(p, t.now) : !isPaid(p) && !isLive(p, t.now),
  );

  function csv() {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const iso = (x: number) => (x ? new Date(x * 1000).toISOString() : "");
    const head = ["number", "payment_account", "filed_at_utc", "decided_at_utc", "spender", "spender_label", "kind", "service", "payee_token", "amount_usdc", "status", "reasons", "intent", "memo"];
    const rows = all.map((p) => [p.number.toString(), p.address, iso(p.createdAt), iso(p.decidedAt), p.spender, spenderName(p.spender, t.spenders), p.kind, serviceName(p.service, t.services), p.payeeToken, decimal(p.amount), p.status, reasonsOf(p.reasons).join("; "), p.intent, p.memo]);
    const blob = new Blob([[head, ...rows].map((r) => r.map((c) => esc(String(c))).join(",")).join("\n")], {type: "text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rein-${t.address.slice(0, 8)}-payments.csv`;
    a.click();
  }

  return (
    <div className={page.page}>
      <PageHeader kind="activity" title="Activity" description="Every payment account the program wrote for this team, newest first. Paid and settled ones moved money; the rest are on chain too." />
      <ListBar end={<Button small onClick={csv}>Export CSV</Button>}>
        <FilterTabs
          label="Filter payments"
          value={filter}
          onChange={setFilter}
          options={[
            {value: "all", label: "All", count: t.payments ? all.length : null},
            {value: "paid", label: "Paid", count: t.payments ? all.filter(isPaid).length : null},
            {value: "waiting", label: "Waiting", count: t.payments ? all.filter((p) => isLive(p, t.now)).length : null},
            {value: "other", label: "Declined or refused"},
          ]}
        />
      </ListBar>
      <div className={list.card} style={{["--cols" as string]: COLS}}>
        <div className={list.head} aria-hidden="true">
          <span>Spender</span>
          <span>Service</span>
          <span>Status</span>
          <span className={list.headNumeric}>Amount</span>
        </div>
        {t.payments === null ? <div className={list.empty}><p>Could not read payments from chain. This is a network problem, not an empty history.</p></div> : null}
        {t.payments !== null && shown.length === 0 ? <div className={list.empty}><p>No payments here yet.</p></div> : null}
        <ul className={list.rows} aria-label="Payments">
          {shown.map((p) => {
            const name = spenderName(p.spender, t.spenders);
            return (
              <li key={p.address}>
                <Link href={`${t.base}/activity/${p.address}`} className={list.row}>
                  <span className={list.who}>
                    <Avatar initials={initials(name)} kind={p.kind} small />
                    <span className={list.cell}>
                      <span className={list.main}>{name}</span>
                      <span className={list.sub}>#{p.number.toString()} · {ago(p.decidedAt || p.createdAt, t.now * 1000)}</span>
                    </span>
                  </span>
                  <span className={list.cell}>
                    <span className={list.text}>{serviceName(p.service, t.services)}</span>
                    {p.memo ? <span className={list.sub}>{p.memo}</span> : null}
                  </span>
                  <span className={list.cell}>
                    <PaymentPill p={p} now={t.now} />
                    {p.reasons ? <span className={list.sub}>{reasonsOf(p.reasons).join(", ")}</span> : null}
                  </span>
                  <span className={`${list.cell} ${list.numeric}`}>
                    <span className={list.text}>{usdc(p.amount)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <p className={list.quiet}>Each payment is an account at the address derived from (spender, intent), so one intent can never be paid twice. The CSV keeps all six decimals.</p>
    </div>
  );
}
