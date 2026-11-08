"use client";

// "Claim your $0.30 of AI compute": once per Google account the team's owner moves 0.30 test USDC
// from the claim pool into the vault (POST /api/claim). The pool's balance is read from chain by the
// server; unknown shows "—", never 0. Whether this account has claimed comes from the claim records;
// unknown is said as unknown, and the server refuses a second claim either way.

import {useCallback, useEffect, useState} from "react";
import {usdc} from "@/lib/chain";
import {useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {StatusPill} from "../ui";
import {SignInPrompt} from "../WalletButton";
import {Explorer, StatusLine, type Status} from "./bits";
import styles from "./rein.module.css";
import card from "../pages/compute-run.module.css";

type ClaimInfo = {
  configured: boolean;
  pool: string | null;
  balance: string | null;
  amount: string;
  cap: number | null;
  taken: number | null;
  claimed: boolean | null;
  signedIn: boolean;
  signature?: string | null;
};

const units = (s: string | null | undefined): bigint | null => (s && /^\d+$/.test(s) ? BigInt(s) : null);

export function ClaimCard({team, isOwner, onClaimed}: {team: string; isOwner: boolean; onClaimed?: () => void}) {
  const {authenticated, authHeaders} = useWallet();
  const [info, setInfo] = useState<ClaimInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [mine, setMine] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/claim?team=${encodeURIComponent(team)}`, {cache: "no-store", headers: await authHeaders()});
      const j = (await res.json().catch(() => null)) as (ClaimInfo & {ok?: boolean}) | null;
      setInfo(res.ok && j ? j : null);
    } catch {
      setInfo(null);
    }
  }, [team, authHeaders]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load, authenticated]);

  async function claim() {
    if (busy) return;
    setBusy(true);
    setStatus({tone: "wait", text: "Claiming your $0.30 from the pool…"});
    try {
      const res = await fetch("/api/claim", {method: "POST", headers: {"Content-Type": "application/json", ...(await authHeaders())}, body: JSON.stringify({team})});
      const j = (await res.json().catch(() => null)) as {ok?: boolean; status?: string; signature?: string; error?: string} | null;
      if (!j) setStatus({tone: "wait", text: `No readable answer (${res.status}). The claim may or may not have been sent; check the vault before trying again.`});
      else if (j.ok && j.status === "confirmed") {
        setMine(j.signature ?? null);
        setStatus(null);
      } else if (j.ok) setStatus({tone: "wait", text: "Sent, not confirmed yet. Your claim is counted; check the vault before trying again.", tx: j.signature});
      else setStatus({tone: "bad", text: j.error ?? `The claim was refused (${res.status}).`, tx: (j as {signature?: string}).signature});
    } catch {
      setStatus({tone: "wait", text: "No answer from the server. The claim may or may not have been sent; check the vault before trying again."});
    } finally {
      setBusy(false);
      void load();
      onClaimed?.();
    }
  }

  const balance = units(info?.balance);
  const amount = units(info?.amount) ?? 300_000n;
  const empty = balance !== null && balance < amount;
  const left = info && info.cap !== null && info.taken !== null ? Math.max(0, info.cap - info.taken) : null;
  const closed = empty || left === 0;
  const claimed = mine ? true : (info?.claimed ?? null);
  const signature = mine ?? info?.signature ?? null;

  let pill = <StatusPill tone="neutral" label="Checking…" />;
  if (claimed === true) pill = <StatusPill tone="settled" label="Claimed" />;
  else if (info === null) pill = <StatusPill tone="neutral" label="Unknown" />;
  else if (info && !info.configured) pill = <StatusPill tone="neutral" label="Not configured" />;
  else if (closed) pill = <StatusPill tone="failed" label={empty ? "Pool empty" : "All claimed"} />;
  else if (claimed === false) pill = <StatusPill tone="pending" label="Available" />;
  else if (info) pill = <StatusPill tone="neutral" label={authenticated ? "Not known yet" : "Sign in to claim"} />;

  return (
    <section className={`${styles.panel} ${card.claim}`} aria-labelledby="claim-title">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="claim-title">
          Your $0.30 of AI compute
        </h2>
        {pill}
      </div>
      <div className={card.claimFigures}>
        <div>
          <span className={card.label}>Per account</span>
          <span className={card.value}>{usdc(amount)}</span>
        </div>
        <div>
          <span className={card.label}>Left in the pool</span>
          <span className={card.value}>{usdc(balance)}</span>
        </div>
        <div>
          <span className={card.label}>Claims left</span>
          <span className={card.value}>{left === null ? "—" : left}</span>
        </div>
      </div>
      <p className={styles.panelNote}>
        Test USDC into this team&apos;s vault, once per Google account, while the shared pool lasts. Your Rein agent spends it on AI compute under the budget you set for it.
      </p>
      {claimed === true ? (
        <p className={card.claimed}>
          <b>Claimed.</b> {signature ? <Explorer kind="tx" id={signature}>View the transaction</Explorer> : "Your $0.30 is in the vault."}
        </p>
      ) : !authenticated ? (
        <SignInPrompt action="claim your $0.30 of AI compute" />
      ) : !isOwner ? (
        <p className={styles.panelNote}>Only this team&apos;s owner can claim into its vault.</p>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => void claim()}
            disabledReason={info && !info.configured ? "The claim pool is not configured on this deployment." : empty ? "The pool is empty." : left === 0 ? "Every claim has been taken." : undefined}
          >
            Claim your $0.30 of AI compute (test USDC, once per account)
          </Button>
        </div>
      )}
      <StatusLine status={status} />
    </section>
  );
}
