"use client";

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {connection} from "@/lib/chain";
import {checkLabel, ixs, pda, readConfig, readTeam, type Config} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {PageHeader} from "../PageHeader";
import {StatusLine, sentStatus, type Status} from "../rein/bits";
import {SignInPrompt} from "../WalletButton";
import styles from "../rein/rein.module.css";

/** `openHref`: where the new team opens once confirmed. /app/<team> by default; /dashboard on /teams/new. */
export function CreateTeam({openHref}: {openHref?: string} = {}) {
  const {publicKey, payer, send, sponsor} = useWallet();
  const router = useRouter();
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Config | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    readConfig(connection()).then(setConfig);
  }, []);

  if (!publicKey)
    return (
      <div className={styles.section}>
        <PageHeader kind="teams" title="Create a team" description="Your Solana wallet becomes the team's owner: the only key that can change policies, approve payments or withdraw." />
        <SignInPrompt action="create a team" note="Privy gives you a Solana wallet when you sign in with Google." />
      </div>
    );
  const problem = checkLabel(name.trim());

  async function create() {
    if (problem || !publicKey || !payer || !config) return;
    setBusy(true);
    try {
      const at = pda.team(publicKey).toBase58();
      if (await readTeam(connection(), at)) {
        setStatus({tone: "bad", text: "Your wallet already owns a team. One team per owner."});
        return;
      }
      setStatus({tone: "wait", text: `Creating ${name.trim()}…`});
      const sent = await send([ixs.createTeam({payer, owner: publicKey, mint: config.mint, name: name.trim()})]);
      setStatus(sentStatus(sent, `${name.trim()} is live, with a vault only the program can move.`));
      if (sent.status === "confirmed") router.push(openHref ?? `/app/${at}`);
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.section}>
      <PageHeader kind="teams" title="Create a team" description="One transaction creates the team account (a PDA of your key) and its USDC vault (a token account the team PDA owns)." />
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Team name</span>
          <input className={styles.input} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Acme Research" />
          <span className={styles.fieldHint}>{sponsor ? "The sponsor pays the rent and the fee; you need no SOL." : "No sponsor is running here, so your wallet would have to pay the rent and fee (about 0.004 SOL)."}</span>
        </label>
        {config === null ? <p className={styles.problems}>Could not read the Rein config from chain, so the token is unknown. Try again in a moment.</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" busy={busy} onClick={() => void create()} disabledReason={problem ? "Give the team a name of 1 to 32 bytes." : !config ? "Reading the config…" : undefined}>
            Create team
          </Button>
        </div>
        <StatusLine status={status} />
      </div>
    </div>
  );
}
