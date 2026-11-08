"use client";

import {useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {createAssociatedTokenAccountIdempotentInstruction} from "@solana/spl-token";
import {usdc} from "@/lib/chain";
import {parseUsdc} from "@/lib/money";
import {ixs, pda} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {Money as Figure} from "../Money";
import {PageHeader} from "../PageHeader";
import {ContentLoading} from "../ui";
import {Explorer, StatusLine, sentStatus, type Status} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import styles from "../rein/rein.module.css";

export function MoneyScreen() {
  const t = useTeamPage();
  const {publicKey, sendOwnFee} = useWallet();
  const [fund, setFund] = useState("100");
  const [out, setOut] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (t.at === 0) return <ContentLoading label="Reading the vault from chain…" rows={2} />;
  const team = t.team;
  const fundUnits = parseUsdc(fund);
  const outUnits = parseUsdc(out);

  async function faucet() {
    if (!team || fundUnits === null || fundUnits <= 0n) return;
    setBusy("fund");
    setStatus({tone: "wait", text: `Minting ${usdc(fundUnits)} of test USDC into the vault…`});
    try {
      const res = await fetch("/api/faucet", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({team: team.address, amount: fund.trim()})});
      const r = (await res.json().catch(() => ({ok: false, error: `no answer (${res.status})`}))) as {ok: boolean; status?: "confirmed" | "failed" | "pending"; signature?: string | null; error?: string};
      if (r.status) setStatus(sentStatus({signature: r.signature ?? null, status: r.status, error: r.error}, `${usdc(fundUnits)} of test USDC is in the vault.`));
      else setStatus({tone: "bad", text: r.error ?? "The faucet refused."});
    } catch (e) {
      setStatus({tone: "wait", text: `No answer from the faucet (${errorText(e)}). Check the balance before trying again.`});
    } finally {
      setBusy(null);
      void t.refresh();
    }
  }

  async function withdraw() {
    if (!team || !publicKey || outUnits === null || outUnits <= 0n) return;
    setBusy("out");
    setStatus({tone: "wait", text: `Withdrawing ${usdc(outUnits)} to your wallet. Confirm in your wallet.`});
    try {
      const mint = new PublicKey(team.mint);
      const to = pda.vault(mint, publicKey);
      const sent = await sendOwnFee([
        createAssociatedTokenAccountIdempotentInstruction(publicKey, to, publicKey, mint),
        ixs.withdraw({owner: publicKey, vault: team.vault, to: to.toBase58(), amount: outUnits}),
      ]);
      setStatus(sentStatus(sent, `${usdc(outUnits)} is in your wallet's USDC account.`));
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(null);
      void t.refresh();
    }
  }

  return (
    <div className={styles.section}>
      <PageHeader kind="money" title="Money" description="The vault is a token account owned by the team PDA. No private key can sign for it: money leaves only through pay, approve or the owner's withdraw." />
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>In the vault</h2>
          {team ? <Explorer id={team.vault}>Vault account</Explorer> : null}
        </div>
        <Figure value={t.balance} size="hero" label="Vault balance" />
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Add test USDC</h2>
          <p className={styles.panelNote}>Up to 100 USDC at a time, from the devnet faucet.</p>
        </div>
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Amount (USDC)</span>
            <input className={styles.input} inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} />
          </label>
          <div className={styles.actions}>
            <Button variant="primary" busy={busy === "fund"} onClick={() => void faucet()} disabledReason={fundUnits === null || fundUnits <= 0n ? "Enter an amount." : fundUnits > 100_000_000n ? "At most 100 USDC." : undefined}>
              Add to the vault
            </Button>
          </div>
        </div>
      </div>
      {t.isOwner ? (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Withdraw</h2>
            <p className={styles.panelNote}>To your own USDC account. There is no destination field to get wrong. Your wallet pays this fee.</p>
          </div>
          <div className={styles.form}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Amount (USDC)</span>
              <input className={styles.input} inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} placeholder="0.00" />
            </label>
            <div className={styles.actions}>
              <Button busy={busy === "out"} onClick={() => void withdraw()} disabledReason={outUnits === null || outUnits <= 0n ? "Enter an amount." : t.balance !== null && outUnits > t.balance ? "More than the vault holds." : undefined}>
                Withdraw to me
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <StatusLine status={status} />
    </div>
  );
}
