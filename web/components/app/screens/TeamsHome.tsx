"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {DEMO_TEAM, connection, parseAddress, short} from "@/lib/chain";
import {pda, readTeam, type Team} from "@/lib/rein";
import {useWallet} from "@/lib/wallet";
import {Button, ButtonLink} from "../Button";
import {PageHeader} from "../PageHeader";
import {StatusLine, type Status} from "../rein/bits";
import {SignInPrompt} from "../WalletButton";
import styles from "../rein/rein.module.css";

/** One team per owner: the signed-in wallet's team is the PDA ["team", wallet]. */
export function TeamsHome() {
  const {address, publicKey} = useWallet();
  const router = useRouter();
  const [mine, setMine] = useState<{address: string; team: Team | null; read: boolean} | null>(null);
  const [open, setOpen] = useState("");
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (!publicKey) return setMine(null);
    const at = pda.team(publicKey).toBase58();
    let stop = false;
    connection()
      .getAccountInfo(new PublicKey(at), "confirmed")
      .then(async (info) => {
        if (stop) return;
        setMine({address: at, team: info ? await readTeam(connection(), at) : null, read: true});
      })
      .catch(() => !stop && setMine({address: at, team: null, read: false}));
    return () => {
      stop = true;
    };
  }, [publicKey]);

  function go() {
    const a = parseAddress(open.trim());
    if (!a) return setStatus({tone: "bad", text: "Enter a team account address (base58)."});
    router.push(`/app/${a}`);
  }

  return (
    <div className={styles.section}>
      <PageHeader kind="teams" title="Your teams" description="A team is a program account derived from its owner's key, with a USDC vault only the program can move. Open yours, create one, or look at the public demo team." />
      {DEMO_TEAM ? (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>The demo team</h2>
            <p className={styles.panelNote}>Seeded with an AI agent, a person and five services. Anyone can approve its pending payments, no sign-in needed.</p>
          </div>
          <div className={styles.actions}>
            <ButtonLink href={`/app/${DEMO_TEAM}`} variant="primary">
              Open the demo team
            </ButtonLink>
            <span className={styles.mono}>{short(DEMO_TEAM, 6)}</span>
          </div>
        </div>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Your team</h2>
          {address ? <span className={styles.mono}>{short(address, 4)}</span> : null}
        </div>
        {!address ? (
          <>
            <SignInPrompt action="open or create your team" note="Google sign-in gives you a Solana wallet; you never need SOL." />
          </>
        ) : mine === null ? (
          <p className={styles.panelNote}>Reading your team from chain…</p>
        ) : mine.team ? (
          <div className={styles.actions}>
            <ButtonLink href={`/app/${mine.address}`} variant="primary">
              Open {mine.team.name}
            </ButtonLink>
            <span className={styles.mono}>{short(mine.address, 6)}</span>
          </div>
        ) : mine.read ? (
          <div className={styles.actions}>
            <p className={styles.panelNote}>Your wallet does not own a team yet.</p>
            <ButtonLink href="/app/teams/new" variant="primary">
              Create a team
            </ButtonLink>
          </div>
        ) : (
          <p className={styles.panelNote}>Could not read the chain. Your team, if you have one, is unchanged; try again in a moment.</p>
        )}
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Open a team by address</h2>
          <p className={styles.panelNote}>For a team where you are a spender, or to look at any team. Every team is readable without signing in.</p>
        </div>
        <div className={styles.form}>
          <input className={styles.input} value={open} onChange={(e) => setOpen(e.target.value)} placeholder="team account address" spellCheck={false} />
          <div className={styles.actions}>
            <Button onClick={go}>Open</Button>
            <Link href="/" className={styles.sectionLink}>
              Back to the site
            </Link>
          </div>
        </div>
      </div>
      <StatusLine status={status} />
    </div>
  );
}
