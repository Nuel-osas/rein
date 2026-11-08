"use client";

// The owner's withdraw, moved here from the removed Vault page so Settings keeps it. Money leaves
// the vault only to the owner's own USDC account: there is no destination field to get wrong.

import {useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {createAssociatedTokenAccountIdempotentInstruction} from "@solana/spl-token";
import {usdc} from "@/lib/chain";
import {parseUsdc} from "@/lib/money";
import {ixs, pda} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {Money as Figure} from "../Money";
import {StatusLine, sentStatus, type Status} from "./bits";
import type {TeamPage} from "./context";
import styles from "./rein.module.css";

export function WithdrawPanel({t}: {t: TeamPage}) {
  const {publicKey, payer, send} = useWallet();
  const [out, setOut] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const team = t.team;
  if (!t.isOwner || !team) return null;
  const outUnits = parseUsdc(out);

  async function withdraw() {
    if (!team || !publicKey || outUnits === null || outUnits <= 0n) return;
    setBusy(true);
    setStatus({tone: "wait", text: `Withdrawing ${usdc(outUnits)} to your wallet…`});
    try {
      const mint = new PublicKey(team.mint);
      const to = pda.vault(mint, publicKey);
      const sent = await send([
        createAssociatedTokenAccountIdempotentInstruction(payer ?? publicKey, to, publicKey, mint),
        ixs.withdraw({owner: publicKey, vault: team.vault, to: to.toBase58(), amount: outUnits}),
      ]);
      setStatus(sentStatus(sent, `${usdc(outUnits)} is in your wallet's USDC account.`));
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(false);
      void t.refresh();
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Withdraw from the vault</h2>
        <p className={styles.panelNote}>To your own USDC account. There is no destination field to get wrong. The sponsor pays the fee and, the first time, the rent of your USDC account.</p>
      </div>
      <Figure value={t.balance} size="title" label="Vault balance" />
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Amount (USDC)</span>
          <input className={styles.input} inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} placeholder="0.00" />
        </label>
        <div className={styles.actions}>
          <Button busy={busy} onClick={() => void withdraw()} disabledReason={outUnits === null || outUnits <= 0n ? "Enter an amount." : t.balance !== null && outUnits > t.balance ? "More than the vault holds." : undefined}>
            Withdraw to me
          </Button>
        </div>
      </div>
      <StatusLine status={status} />
    </div>
  );
}
