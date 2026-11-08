"use client";

import Link from "next/link";
import {useEffect, useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {ago, connection, period, short, usdc} from "@/lib/chain";
import {budgetSeenKey, writeFlag} from "@/lib/get-started";
import {ixs, pda, readTokenBalance, remainingOf, rolled, type Spender} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button, ButtonLink} from "../Button";
import {SPENDER_STATUS_COPY} from "../copy";
import {Money} from "../Money";
import {Avatar, ContentLoading, EmptyState, Meter, StatusPill} from "../ui";
import list from "../ListView.module.css";
import page from "../pages/spender.module.css";
import {Explorer, Fact, PaymentPill, StatusLine, initials, sentStatus, serviceName, type Status} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import styles from "../rein/rein.module.css";

/** What the key itself holds: the proof that an agent's key carries no money. null = unknown. */
function useKeyHoldings(authority: string | null, mint: string | null) {
  const [h, setH] = useState<{sol: number | null; usdc: bigint | null | "none"}>({sol: null, usdc: null});
  useEffect(() => {
    if (!authority || !mint) return;
    let stop = false;
    const load = async () => {
      const conn = connection();
      const key = new PublicKey(authority);
      const ata = pda.vault(new PublicKey(mint), key);
      const [lamports, info] = await Promise.all([conn.getBalance(key, "confirmed").catch(() => null), conn.getAccountInfo(ata, "confirmed").then((i) => i, () => undefined)]);
      let tokens: bigint | null | "none" = null;
      if (info === null) tokens = "none";
      else if (info) tokens = await readTokenBalance(conn, ata.toBase58());
      if (!stop) setH({sol: lamports === null ? null : lamports / 1e9, usdc: tokens});
    };
    void load();
    const t = setInterval(load, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [authority, mint]);
  return h;
}

export function SpenderDetail({by, id}: {by: "address" | "authority"; id: string}) {
  const t = useTeamPage();
  const s: Spender | null = t.spenders?.find((x) => (by === "address" ? x.address === id : x.authority === id)) ?? null;
  const holdings = useKeyHoldings(s?.authority ?? null, t.team?.mint ?? null);
  const {publicKey, send} = useWallet();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const agentSeen = !!s && s.kind === "agent" && t.isOwner;
  // Get started on Home ticks "Review your agent's budget" once the owner has opened an agent here.
  useEffect(() => {
    if (agentSeen) writeFlag(budgetSeenKey(t.address));
  }, [agentSeen, t.address]);

  if (t.at === 0) return <ContentLoading label="Reading this spender from chain…" rows={3} />;
  const back = `${t.base}/spenders`;
  if (!s) {
    return (
      <EmptyState
        as="h1"
        title={t.spenders === null ? "Could not read spenders" : "No such spender on this team"}
        body={t.spenders === null ? "This is a network problem. Their limits are unchanged." : "The link does not match a Spender account of this team."}
        action={<Link href={back}>Back</Link>}
      />
    );
  }

  const r = rolled(s, t.now);
  const left = remainingOf(s, t.now, !!t.team?.paused);
  const expired = t.now >= s.policy.expiresAt && s.status !== "revoked";
  const st = SPENDER_STATUS_COPY[expired ? "expired" : s.status];
  const mine = (t.payments ?? []).filter((p) => p.spender === s.address);
  const resets = s.periodStart + s.policy.periodSecs * (Math.floor((t.now - s.periodStart) / s.policy.periodSecs) + 1);

  async function act(key: string, label: string, ix: () => Parameters<typeof send>[0], done: string) {
    setBusy(key);
    setStatus({tone: "wait", text: `${label}…`});
    try {
      setStatus(sentStatus(await send(ix()), done));
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(null);
      void t.refresh();
    }
  }

  return (
    <div className={page.page}>
      <Link href={back} className={page.back}>
        <span aria-hidden="true">←</span> Team
      </Link>

      <header className={page.head}>
        <div className={page.who}>
          <Avatar initials={initials(s.label)} kind={s.kind} />
          <div>
            <h1 className={`t-title ${page.name}`}>{s.label}</h1>
            <p className={page.role}>
              {s.kind === "agent" ? "AI agent" : "Person"} · <StatusPill tone={st.tone} label={st.label} />
            </p>
          </div>
        </div>
        {t.isOwner && s.status !== "revoked" ? (
          <div className={styles.actions}>
            <ButtonLink href={`${t.base}/spenders/${s.address}/edit`} small>
              Edit policy
            </ButtonLink>
            {s.status === "active" ? (
              <Button small busy={busy === "pause"} onClick={() => act("pause", `Pausing ${s.label}`, () => [ixs.setSpenderStatus({owner: publicKey!, spender: s.address, active: false})], `${s.label} is paused.`)}>
                Pause
              </Button>
            ) : (
              <Button small busy={busy === "resume"} onClick={() => act("resume", `Resuming ${s.label}`, () => [ixs.setSpenderStatus({owner: publicKey!, spender: s.address, active: true})], `${s.label} is active again.`)}>
                Resume
              </Button>
            )}
            <Button
              small
              variant="danger"
              busy={busy === "revoke"}
              onClick={() => {
                if (window.confirm(`Revoke ${s.label}? Nothing it filed before can settle, and this cannot be undone.`))
                  void act("revoke", `Revoking ${s.label}`, () => [ixs.revoke({owner: publicKey!, spender: s.address})], `${s.label} is revoked.`);
              }}
            >
              Revoke
            </Button>
          </div>
        ) : null}
      </header>

      <StatusLine status={status} />

      <section className={`card ${page.hero}`} aria-labelledby="left-now">
        <p className={`t-meta ${page.heroLabel}`} id="left-now">
          Can pay now, in one payment, without asking
        </p>
        <p className={page.heroFigure}>
          <Money value={left} size="hero" label="Can pay now" />
        </p>
        <p className={page.heroLine}>
          {usdc(r.spent)} of {usdc(s.policy.allowance)} used this {period(s.policy.periodSecs)} · {r.count} of {s.policy.maxPayments} payments · resets{" "}
          {new Date(resets * 1000).toLocaleString("en-GB", {timeZone: "UTC", dateStyle: "medium", timeStyle: "short"})} UTC
        </p>
        <Meter spent={r.spent} allowance={s.policy.allowance} />
      </section>

      <dl className={styles.facts}>
        <Fact label="Allowance">{usdc(s.policy.allowance)} per {period(s.policy.periodSecs)}</Fact>
        <Fact label="Per-payment cap">{usdc(s.policy.cap)}</Fact>
        <Fact label="Payments per period">{s.policy.maxPayments}</Fact>
        <Fact label="Expires" note={expired ? "Expired: every payment is refused" : undefined}>
          {new Date(s.policy.expiresAt * 1000).toLocaleDateString("en-GB", {timeZone: "UTC", dateStyle: "medium"})}
        </Fact>
        <Fact label="Services it may pay">{s.services.length ? s.services.map((x) => serviceName(x, t.services)).join(", ") : "None: every payment goes to the owner"}</Fact>
        <Fact label="Generation" note="Bumped on re-grant after a revoke, so nothing filed before can settle">
          {s.generation}
        </Fact>
      </dl>

      <section className={styles.section} aria-labelledby="the-key">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="the-key">
            {s.kind === "agent" ? "The agent's key" : "Their wallet"}
          </h2>
        </div>
        <dl className={styles.facts}>
          <Fact label="Signs as">
            <Explorer id={s.authority}>{short(s.authority, 6)}</Explorer>
          </Fact>
          <Fact label="SOL it holds" note="A separate fee payer covers fees, so it needs none">
            {holdings.sol === null ? "—" : `${holdings.sol} SOL`}
          </Fact>
          <Fact label="USDC it holds" note="The money stays in the team vault">
            {holdings.usdc === null ? "—" : holdings.usdc === "none" ? "No USDC account" : usdc(holdings.usdc)}
          </Fact>
          <Fact label="Spender account">
            <Explorer id={s.address}>{short(s.address, 6)}</Explorer>
          </Fact>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="its-payments">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="its-payments">
            Payments
          </h2>
        </div>
        <div className={list.card} style={{["--cols" as string]: "minmax(10rem,1fr) minmax(9rem,.9fr) minmax(7rem,.6fr)"}}>
          {t.payments === null ? <div className={list.empty}><p>Could not read payments.</p></div> : null}
          {t.payments !== null && mine.length === 0 ? <div className={list.empty}><p>No payments yet.</p></div> : null}
          <ul className={list.rows}>
            {mine.slice(0, 20).map((p) => (
              <li key={p.address}>
                <Link href={`${t.base}/activity/${p.address}`} className={list.row}>
                  <span className={list.cell}>
                    <span className={list.main}>{serviceName(p.service, t.services)}</span>
                    <span className={list.sub}>#{p.number.toString()} · {ago(p.decidedAt || p.createdAt, t.now * 1000)}</span>
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
        </div>
      </section>
    </div>
  );
}
