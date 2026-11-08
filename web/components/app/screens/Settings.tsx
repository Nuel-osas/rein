"use client";

import {useState} from "react";
import {PROGRAM_ID, short} from "@/lib/chain";
import {ixs} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {PageHeader} from "../PageHeader";
import {ContentLoading} from "../ui";
import {Explorer, Fact, StatusLine, sentStatus, type Status} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import {SignInPrompt} from "../WalletButton";
import styles from "../rein/rein.module.css";

export function Settings() {
  const t = useTeamPage();
  const {publicKey, send} = useWallet();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  if (t.at === 0) return <ContentLoading label="Reading the team from chain…" rows={2} />;
  const team = t.team;

  async function toggle() {
    if (!team || !publicKey) return;
    setBusy(true);
    const next = !team.paused;
    setStatus({tone: "wait", text: `${next ? "Pausing" : "Resuming"} the team…`});
    try {
      setStatus(sentStatus(await send([ixs.setPaused({owner: publicKey, paused: next})]), next ? "The team is paused. Nothing can move." : "The team is running again."));
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(false);
      void t.refresh();
    }
  }

  return (
    <div className={styles.section}>
      <PageHeader kind="settings" title="Settings" description="The team's accounts on chain, and the one switch that stops everything." />
      <dl className={styles.facts}>
        <Fact label="Team">{team?.name ?? "—"}</Fact>
        <Fact label="Team account">
          <Explorer id={t.address}>{short(t.address, 6)}</Explorer>
        </Fact>
        <Fact label="Owner">{team ? <Explorer id={team.owner}>{short(team.owner, 6)}</Explorer> : "—"}</Fact>
        <Fact label="Vault">{team ? <Explorer id={team.vault}>{short(team.vault, 6)}</Explorer> : "—"}</Fact>
        <Fact label="Token">{team ? <Explorer id={team.mint}>Test USDC · {short(team.mint, 4)}</Explorer> : "—"}</Fact>
        <Fact label="Program">
          <Explorer id={PROGRAM_ID.toBase58()}>{short(PROGRAM_ID.toBase58(), 6)}</Explorer>
        </Fact>
        <Fact label="Created">{team ? new Date(team.createdAt * 1000).toLocaleDateString("en-GB", {timeZone: "UTC", dateStyle: "medium"}) : "—"}</Fact>
        <Fact label="Payments filed">{team ? team.payments.toString() : "—"}</Fact>
      </dl>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Stop everything</h2>
          <p className={styles.panelNote}>{team?.paused ? "The team is paused. No payment or settlement can move money." : "Pausing stops every payment and every settlement at once, for every spender."}</p>
        </div>
        <div className={styles.actions}>
          {t.isOwner ? (
            <Button variant={team?.paused ? "primary" : "danger"} busy={busy} onClick={() => void toggle()}>
              {team?.paused ? "Resume the team" : "Pause the team"}
            </Button>
          ) : (
            t.wallet ? <p className={styles.panelNote}>Only the owner can pause or resume the team.</p> : <SignInPrompt action="pause the team" note="Only the owner can." />
          )}
        </div>
      </div>
      <StatusLine status={status} />
    </div>
  );
}
