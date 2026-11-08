"use client";

// Metrics: Nuntio's owner-metrics screen, rebuilt on what Rein has, which is the chain. Every figure
// is read from this team's Payment accounts (the team poller's memcmp read) and the Team account's
// own counters. A failed read shows "—", never 0; an empty bucket is a real zero because the list
// was read in full.

import Link from "next/link";
import {useState} from "react";
import {short, usdc} from "@/lib/chain";
import {OUTCOMES, OUTCOME_TEXT, groupBy, percent, series, summarize, type Group, type Series} from "@/lib/metrics";
import type {Service, Spender} from "@/lib/rein";
import {PageHeader} from "../PageHeader";
import {ContentLoading, EmptyState} from "../ui";
import {useTeamPage} from "../rein/context";
import rein from "../rein/rein.module.css";
import styles from "../pages/metrics.module.css";

const n = new Intl.NumberFormat("en-US");
const payments_ = (k: number | bigint) => `${n.format(k)} ${k === 1 || k === 1n ? "payment" : "payments"}`;

function when(unix: number, unit: "hour" | "day") {
  const d = new Date(unix * 1000);
  return unit === "hour"
    ? `${String(d.getUTCHours()).padStart(2, "0")}:00`
    : d.toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"});
}

export function Metrics() {
  const t = useTeamPage();
  const [busy, setBusy] = useState(false);

  if (t.at === 0) return <ContentLoading label="Reading the team's payments from chain…" rows={3} />;
  if (t.missing) return <EmptyState as="h1" title="Not a Rein team" body={`${t.address} is not a Rein team on this cluster.`} action={<Link href="/app">Your teams</Link>} />;

  const payments = t.payments;
  const s = payments ? summarize(payments, t.now) : null;
  const refresh = async () => {
    setBusy(true);
    await t.refresh();
    setBusy(false);
  };
  const counterMatches = s && t.team ? s.paid === t.team.paidTotal && BigInt(s.paidCount) === t.team.paidCount : null;

  return (
    <div className={styles.page}>
      <PageHeader
        kind="activity"
        title="Metrics"
        description="What this team's payments add up to, read from its Payment accounts on chain. Counts and sums only, nothing about what any payment bought."
      />

      <div className={styles.actions}>
        <p className={styles.readAt} role="status">
          Read at <time dateTime={new Date(t.at).toISOString()}>{new Date(t.at).toLocaleTimeString("en-GB", {timeZone: "UTC"})} UTC</time>. The team view
          re-reads every few seconds.
        </p>
        <button type="button" className={styles.refresh} onClick={() => void refresh()} disabled={busy}>
          {busy ? "Reading…" : "Refresh figures"}
        </button>
      </div>

      <div className={rein.figures}>
        <div className={rein.figure} data-strong="">
          <span className={rein.figureLabel}>USDC paid</span>
          <span className={rein.figureValue}>{s ? usdc(s.paid) : "—"}</span>
          <span className={rein.figureNote}>{s ? `${payments_(s.paidCount)} left the vault` : "Could not read payments"}</span>
        </div>
        <div className={rein.figure}>
          <span className={rein.figureLabel}>Payments filed</span>
          <span className={rein.figureValue}>{s ? n.format(s.count) : "—"}</span>
          <span className={rein.figureNote}>{s && s.first ? `Since ${new Date(s.first * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"})}` : ""}</span>
        </div>
        <div className={rein.figure}>
          <span className={rein.figureLabel}>Waiting for the owner</span>
          <span className={rein.figureValue}>{s ? n.format(s.counts.waiting) : "—"}</span>
          <span className={rein.figureNote}>{s ? (s.counts.waiting ? `${usdc(s.held)} held on chain` : "Nothing held") : ""}</span>
        </div>
        <div className={rein.figure}>
          <span className={rein.figureLabel}>Declined or refused</span>
          <span className={rein.figureValue}>{s ? n.format(s.counts.declined + s.counts.refused) : "—"}</span>
          <span className={rein.figureNote}>{s ? `${n.format(s.counts.declined)} declined · ${n.format(s.counts.refused)} refused` : ""}</span>
        </div>
      </div>

      {payments === null || !s ? (
        <EmptyState
          title="Could not read this team's payments"
          body="This is a problem reaching the network, not a team with no payments. The figures above stay unknown until a read succeeds."
          action={<button type="button" className={styles.refresh} onClick={() => void refresh()}>Try again</button>}
        />
      ) : (
        <>
          <section className={styles.panel} aria-labelledby="over-time">
            <h2 id="over-time">Payments over time</h2>
            <p className={styles.panelLead}>Payments filed per {series(payments, t.now).unit} (UTC), whatever happened to them next. Hover or focus a bar for its figures.</p>
            <Chart data={series(payments, t.now)} />
          </section>

          <section className={styles.panel} aria-labelledby="outcomes">
            <h2 id="outcomes">By outcome</h2>
            <p className={styles.panelLead}>Each payment is in exactly one row. Settled means the owner approved it after it went over a limit.</p>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Outcome</th>
                    <th scope="col" className={styles.numeric}>Payments</th>
                    <th scope="col" className={styles.numeric}>USDC asked</th>
                    <th scope="col" className={styles.numeric}>Of all payments</th>
                  </tr>
                </thead>
                <tbody>
                  {OUTCOMES.map((o) => (
                    <tr key={o}>
                      <th scope="row">{OUTCOME_TEXT[o]}</th>
                      <td className={styles.numeric}>{n.format(s.counts[o])}</td>
                      <td className={styles.numeric}>{usdc(s.amounts[o])}</td>
                      <td className={styles.numeric}>
                        <Share value={BigInt(s.counts[o])} of={BigInt(s.count)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              {counterMatches === null
                ? "The Team account's own counters could not be read to cross-check these sums."
                : counterMatches
                  ? `Matches the Team account's own counters: ${usdc(t.team!.paidTotal)} in ${payments_(t.team!.paidCount)}.`
                  : `The Team account's own counters say ${usdc(t.team!.paidTotal)} in ${payments_(t.team!.paidCount)}, which differs from the sum of the Payment accounts above. One of the two reads is older; refresh to compare again.`}
            </p>
          </section>

          <div className={styles.details}>
            <Breakdown
              title="By spender"
              lead="Who filed the payments: people and agents, by their Spender account."
              groups={groupBy(payments, (p) => p.spender, t.now)}
              total={s.paid}
              name={(k) => spenderLabel(k, t.spenders)}
              href={(k) => {
                const sp = t.spenders?.find((x) => x.address === k);
                return sp ? (sp.kind === "agent" ? `${t.base}/agents/${sp.authority}` : `${t.base}/spenders/${sp.address}`) : null;
              }}
            />
            <Breakdown
              title="By service"
              lead="Where the money went. Every payee is a service in the on-chain registry."
              groups={groupBy(payments, (p) => p.service, t.now)}
              total={s.paid}
              name={(k) => serviceLabel(k, t.services)}
              href={(k) => {
                const sv = t.services?.find((x) => x.address === k);
                return sv ? `${t.base}/recipients/${sv.id}` : null;
              }}
            />
          </div>
        </>
      )}

      <p className={styles.note}>
        Source: every Payment account of this team, read with getProgramAccounts (the Payment discriminator and the team address at byte 8). The program never closes a
        Payment account, so this is the whole history. Test USDC on {t.address ? short(t.address, 4) : "this team"}; nothing here is real money.
      </p>
    </div>
  );
}

function spenderLabel(k: string, spenders: Spender[] | null) {
  const sp = spenders?.find((x) => x.address === k);
  return sp ? `${sp.label}${sp.kind === "agent" ? " (agent)" : ""}` : short(k);
}

function serviceLabel(k: string, services: Service[] | null) {
  return services?.find((x) => x.address === k)?.id ?? short(k);
}

function Share({value, of}: {value: bigint; of: bigint}) {
  const p = percent(value, of);
  if (p === null) return <span className={styles.unknown}>—</span>;
  return (
    <span className={styles.share}>
      <span className={styles.shareTrack} aria-hidden="true">
        <span className={styles.shareFill} style={{inlineSize: `${Math.min(100, p)}%`}} />
      </span>
      {p}%
    </span>
  );
}

function Breakdown({title, lead, groups, total, name, href}: {title: string; lead: string; groups: Group[]; total: bigint; name: (k: string) => string; href: (k: string) => string | null}) {
  const id = `bd-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className={styles.panelLead}>{lead}</p>
      {groups.length === 0 ? (
        <p className={styles.note}>No payments yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{title === "By spender" ? "Spender" : "Service"}</th>
                <th scope="col" className={styles.numeric}>Filed</th>
                <th scope="col" className={styles.numeric}>USDC paid</th>
                <th scope="col" className={styles.numeric}>Of paid</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const link = href(g.key);
                return (
                  <tr key={g.key}>
                    <th scope="row">
                      {link ? <Link href={link}>{name(g.key)}</Link> : name(g.key)}
                      {g.waiting ? <span className={styles.unit}> · {g.waiting} waiting</span> : null}
                    </th>
                    <td className={styles.numeric}>{n.format(g.count)}</td>
                    <td className={styles.numeric}>
                      {usdc(g.paid)} <span className={styles.unit}>in {n.format(g.paidCount)}</span>
                    </td>
                    <td className={styles.numeric}>
                      <Share value={g.paid} of={total} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One series (payments filed per bucket): no legend, the title names it; a tooltip per bar. */
function Chart({data}: {data: Series}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...data.buckets.map((b) => b.count));
  const top = max <= 1 ? 1 : max % 2 ? max + 1 : max;
  const last = data.buckets.length - 1;
  const mid = Math.floor(last / 2);
  const a = active !== null ? data.buckets[active] : null;
  return (
    <div>
      <div className={styles.chart}>
        <div className={styles.yAxis} aria-hidden="true">
          <span>{top}</span>
          <span>{top > 1 ? top / 2 : ""}</span>
          <span>0</span>
        </div>
        <div className={styles.plot} role="list" aria-label={`Payments filed per ${data.unit}`} onMouseLeave={() => setActive(null)}>
          {data.buckets.map((b, i) => (
            <button
              key={b.start}
              type="button"
              role="listitem"
              className={styles.slot}
              data-active={active === i || undefined}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${when(b.start, data.unit)}: ${b.count} filed, ${b.paidCount} paid, ${usdc(b.paid)}`}
            >
              {b.count > 0 ? <span className={styles.bar} style={{blockSize: `${Math.max(2, (b.count / top) * 100)}%`}} /> : null}
            </button>
          ))}
          {a && active !== null ? (
            <div className={styles.tip} style={{insetInlineStart: `${Math.min(85, Math.max(15, ((active + 0.5) / data.buckets.length) * 100))}%`}} aria-hidden="true">
              <b>
                {data.unit === "day" ? when(a.start, "day") : `${when(a.start, "day")}, ${when(a.start, "hour")}–${when(a.end, "hour")}`} UTC
              </b>
              <span>{a.count} filed</span>
              <span>
                {a.paidCount} paid · {usdc(a.paid)}
              </span>
            </div>
          ) : null}
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          <span>{when(data.buckets[0].start, data.unit)}</span>
          <span>{when(data.buckets[mid].start, data.unit)}</span>
          <span>{when(data.buckets[last].start, data.unit)}</span>
        </div>
      </div>
      {data.earlier ? <p className={styles.note}>{data.earlier} earlier payments are outside this window and are counted in the tables below.</p> : null}
    </div>
  );
}
