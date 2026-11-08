"use client";

import {useSearchParams} from "next/navigation";
import {useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {connection, period, usdc} from "@/lib/chain";
import {parseUsdc} from "@/lib/money";
import {MEMO_MAX, ixs, newIntent, overLimits, pda, readPayment, reasonsOf, remainingOf, rolled} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {Money} from "../Money";
import {PageHeader} from "../PageHeader";
import {ContentLoading, EmptyState} from "../ui";
import {Fact, StatusLine, sentStatus, serviceName, type Status} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import {SignInPrompt} from "../WalletButton";
import styles from "../rein/rein.module.css";

export function Pay() {
  const t = useTeamPage();
  const {publicKey, payer, send} = useWallet();
  const [service, setService] = useState("");
  // ?service=<id> from a service page preselects it; the spender still sees and can change it.
  const preset = useSearchParams()?.get("service") ?? null;
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  if (t.at === 0) return <ContentLoading label="Reading the team from chain…" rows={2} />;
  const header = <PageHeader kind="pay" title="New payment" description="Pick a registered service and an amount. Inside your policy it settles in the same transaction; outside it, it waits on chain for the owner." />;
  if (!t.wallet) return <div className={styles.section}>{header}<SignInPrompt action="pay" note="People pay from their own Solana wallet under their policy; agents pay from their own key." /></div>;
  if (!t.me || !t.team) return <div className={styles.section}>{header}<EmptyState title="You are not a spender on this team" body={`The owner can add your wallet, ${t.wallet.slice(0, 4)}…${t.wallet.slice(-4)}, under Team.`} /></div>;
  const me = t.me;
  const team = t.team;

  const units = parseUsdc(amount);
  const active = (t.services ?? []).filter((s) => s.active);
  const chosen = active.find((s) => s.address === service) ?? active.find((s) => s.id === preset) ?? active.find((s) => me.services.includes(s.address)) ?? active[0] ?? null;
  const bits = units !== null && units > 0n && chosen ? overLimits(me, chosen.address, units, t.now) : 0;
  const memoOk = new TextEncoder().encode(memo).length <= MEMO_MAX;
  const r = rolled(me, t.now);

  async function pay() {
    if (!chosen || units === null || units <= 0n || !publicKey || !payer || !memoOk) return;
    const intent = newIntent("web");
    const at = pda.payment(new PublicKey(me.address), intent).toBase58();
    setBusy(true);
    setStatus({tone: "wait", text: "Signing and sending…"});
    try {
      const sent = await send([ixs.pay({payer, authority: publicKey, team: team.address, vault: team.vault, service: chosen, intent, amount: units, memo: memo.trim()})]);
      if (sent.status === "confirmed") {
        const p = await readPayment(connection(), at);
        if (p?.status === "paid") {
          setStatus({tone: "ok", text: `Paid ${usdc(units)} to ${chosen.id}, settled in the same transaction.`, tx: sent.signature});
          setAmount("");
          setMemo("");
        } else if (p?.status === "pending") setStatus({tone: "wait", text: `Over a limit (${reasonsOf(p.reasons).join(", ")}): filed as payment #${p.number}. The owner can approve it for a day.`, tx: sent.signature});
        else setStatus({tone: "wait", text: "Landed. Its status shows under Activity once the payment account is readable.", tx: sent.signature});
      } else setStatus(sentStatus(sent, ""));
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(false);
      void t.refresh();
    }
  }

  return (
    <div className={styles.section}>
      {header}
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Your policy</h2>
          <Money value={remainingOf(me, t.now, team.paused)} size="title" label="Can pay now" />
        </div>
        <dl className={styles.facts}>
          <Fact label="Allowance">{usdc(me.policy.allowance)} per {period(me.policy.periodSecs)}</Fact>
          <Fact label="Spent this period">{usdc(r.spent)} · {r.count}/{me.policy.maxPayments} payments</Fact>
          <Fact label="Cap">{usdc(me.policy.cap)} a payment</Fact>
          <Fact label="Services">{me.services.map((s) => serviceName(s, t.services)).join(", ") || "None"}</Fact>
        </dl>
      </div>
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Service</span>
          <select className={styles.select} value={chosen?.address ?? ""} onChange={(e) => setService(e.target.value)}>
            {active.map((s) => (
              <option key={s.address} value={s.address}>
                {s.id} · {s.label} · list {usdc(s.price)}
                {me.services.includes(s.address) ? "" : " (needs approval)"}
              </option>
            ))}
          </select>
          <span className={styles.fieldHint}>pay takes a registered service. The registry names the payee; you never type an address.</span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Amount (USDC)</span>
          <input className={styles.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={chosen ? usdc(chosen.price).slice(1) : "1.00"} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Memo (optional, up to {MEMO_MAX} bytes)</span>
          <input className={styles.input} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="what it is for" />
        </label>
        {bits ? <p className={styles.problems}>This will wait for the owner: {reasonsOf(bits).join(", ")}.</p> : null}
        {!memoOk ? <p className={styles.problems}>The memo is longer than {MEMO_MAX} bytes.</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" busy={busy} onClick={() => void pay()} disabledReason={units === null || units <= 0n ? "Enter an amount." : me.status !== "active" ? "Your policy is not active." : undefined}>
            {units ? `Pay ${usdc(units)}` : "Pay"}
          </Button>
        </div>
        <StatusLine status={status} />
      </div>
    </div>
  );
}
