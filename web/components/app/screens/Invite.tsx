"use client";

// Invites without a backend (lib/invite.ts). Nothing is stored on a server;
// Rein stores nothing. The owner shares a link that names the team and a label; the invitee signs
// in, gets an embedded wallet, and sends a link back that opens the owner's add-a-person form
// filled in. The owner checks the address and grants a policy on chain. Until then nothing is
// written anywhere and no money moves.

import Link from "next/link";
import {useEffect, useId, useState, type FormEvent, type ReactNode} from "react";
import {Brand} from "@/components/Brand";
import {short} from "@/lib/chain";
import {decodeInvite, encodeInvite, inviteLink, replyLink} from "@/lib/invite";
import {LABEL_MAX, checkLabel} from "@/lib/rein";
import {forgetReturnTo, rememberReturnTo} from "@/lib/return-to";
import {useTeam} from "@/lib/team";
import {useWallet} from "@/lib/wallet";
import {Button, ButtonLink} from "../Button";
import {NETWORK_NAME} from "../network-copy";
import {TestnetTag} from "../TestnetMark";
import styles from "../pages/invite.module.css";

function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* --- The owner's control on Team ----------------------------------------------------------- */

export function InviteControl({team, teamName}: {team: string; teamName: string | null}) {
  const origin = useOrigin();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const id = useId();
  const problem = label.trim() ? checkLabel(label.trim()) : null;
  const token = label.trim() && !problem ? encodeInvite({team, label}) : null;
  const link = token && origin ? inviteLink(origin, token) : "";

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} aria-label="Invite someone to this team">
        Invite someone
      </Button>
    );
  }
  return (
    <section className={styles.panel} aria-labelledby={`${id}-t`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id={`${id}-t`}>
          Invite someone{teamName ? ` to ${teamName}` : ""}
        </h2>
        <Button small variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className={styles.lead}>
        The link names this team and the person, nothing secret. They sign in with Google and send you back their wallet address as a link that opens Add a person,
        filled in. You check the address with them and grant a policy. Nothing is stored and no money moves until you do.
      </p>
      <div className={styles.field}>
        <label htmlFor={`${id}-label`}>Their name, as it will show on the team</label>
        <input
          id={`${id}-label`}
          className={styles.input}
          value={label}
          maxLength={LABEL_MAX}
          placeholder="Ada, operations"
          onChange={(e) => {
            setLabel(e.target.value);
            setCopied(null);
          }}
          aria-invalid={problem ? true : undefined}
        />
        {problem ? <p className={styles.fieldError}>Needs {problem}.</p> : <p className={styles.fieldHint}>Up to {LABEL_MAX} bytes. They can change it before sending it back.</p>}
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={`${id}-link`}>Invite link</label>
          <input id={`${id}-link`} className={styles.input} readOnly value={link} placeholder="Type a name to make the link" onFocus={(e) => e.currentTarget.select()} />
        </div>
        <Button
          variant="primary"
          disabledReason={link ? undefined : "Type their name first."}
          onClick={() => void copyText(link).then((ok) => setCopied(ok ? "yes" : "no"))}
        >
          Copy invite link
        </Button>
      </div>
      {copied === "yes" ? <p className={styles.ok} role="status">Copied. Send it to them in any chat.</p> : null}
      {copied === "no" ? <p className={styles.problem} role="status">Could not copy. Select the link above and copy it by hand.</p> : null}
    </section>
  );
}

/* --- The invite page ------------------------------------------------------------------------ */

function Standalone({children}: {children: ReactNode}) {
  return (
    <div className={styles.page} data-theme="dark" data-app="">
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Rein home">
          <Brand />
        </Link>
        <TestnetTag />
      </header>
      <main className={styles.main}>
        {children}
        <p className={styles.note}>{NETWORK_NAME}: test USDC only, nothing here is real money.</p>
      </main>
    </div>
  );
}

function Card({eyebrow, title, children}: {eyebrow?: string; title: string; children: ReactNode}) {
  return (
    <section className={styles.card} aria-labelledby="invite-title">
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 className={styles.title} id="invite-title">
        {title}
      </h1>
      {children}
    </section>
  );
}

export function InviteAccept({token}: {token: string}) {
  const invite = decodeInvite(token);
  return <Standalone>{invite ? <Accept team={invite.team} label={invite.label} /> : <BadInvite />}</Standalone>;
}

function BadInvite() {
  return (
    <Card title="This invite link does not work">
      <p className={styles.lead}>It is cut short or was changed, so it does not name a Rein team and a person. Ask the owner to send it again.</p>
    </Card>
  );
}

function Accept({team, label}: {team: string; label: string}) {
  const t = useTeam(team, 5000);
  const w = useWallet();
  const origin = useOrigin();
  const [name, setName] = useState(label);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const id = useId();

  // Back on the invite, signed in: the way back from sign-in has done its job.
  useEffect(() => {
    if (w.authenticated) forgetReturnTo();
  }, [w.authenticated]);
  const teamName = t.team?.name ?? null;
  const called = teamName ?? `team ${short(team, 4)}`;

  if (t.at > 0 && t.missing) {
    return (
      <Card title="This team is not on this cluster">
        <p className={styles.lead}>
          The link names {short(team, 6)}, which is not a Rein team here. Check that the owner sent a link from the same Rein.
        </p>
      </Card>
    );
  }

  if (!w.configured) {
    return (
      <Card eyebrow="You are invited" title={`Join ${called} on Rein`}>
        <p className={styles.lead}>Sign-in is not configured on this deployment, so you cannot get a wallet here. Nothing was sent.</p>
      </Card>
    );
  }

  if (!w.ready || !w.authenticated) {
    return (
      <Card eyebrow="You are invited" title={`Join ${called} on Rein`}>
        <p className={styles.lead}>
          {called} keeps test USDC in one vault, and each person pays under their own limits that the Rein program enforces. Sign in with Google and Rein gives you a
          Solana wallet; you send its address to the owner, and they decide what you can spend.
        </p>
        {w.error ? <p className={styles.problem} role="alert">{w.error}</p> : null}
        <div className={styles.actions}>
          <Button
            variant="primary"
            busy={!w.ready}
            onClick={() => {
              // Google sign-in leaves this page: /auth/callback brings the person back here.
              rememberReturnTo(window.location.pathname);
              w.signIn();
            }}
          >
            Sign in with Google
          </Button>
        </div>
        <p className={styles.note}>Signing in sends nothing on chain and moves no money.</p>
      </Card>
    );
  }

  if (!w.address) {
    return (
      <Card eyebrow="You are invited" title={`Join ${called} on Rein`}>
        <p className={styles.lead} role="status">Privy is creating your Solana wallet. This takes a moment.</p>
      </Card>
    );
  }

  if (t.team && t.team.owner === w.address) {
    return (
      <Card title={`You own ${called}`}>
        <p className={styles.lead}>This is your team&apos;s invite link. Send it to the person you want to add; they send their wallet address back to you.</p>
        <div className={styles.actions}>
          <ButtonLink href={`/app/${team}/spenders`} variant="primary">Open Team</ButtonLink>
        </div>
      </Card>
    );
  }

  const already = t.spenders?.find((s) => s.authority === w.address && s.status !== "revoked") ?? null;
  if (already) {
    return (
      <Card title={`You are already on ${called}`}>
        <p className={styles.lead}>Your wallet pays as {already.label}, under the limits the owner set.</p>
        <div className={styles.actions}>
          <ButtonLink href={`/app/${team}`} variant="primary">Open {called}</ButtonLink>
        </div>
      </Card>
    );
  }

  const problem = checkLabel(name.trim());
  const reply = !problem && origin ? replyLink(origin, team, w.address, name) : "";
  const message = reply ? `Please add me to ${called} on Rein. My wallet is ${w.address}. This link opens Add a person with it filled in: ${reply}` : "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!message) return;
    void copyText(message).then((ok) => setCopied(ok ? "yes" : "no"));
  }

  return (
    <form className={styles.card} aria-labelledby="invite-title" onSubmit={submit} noValidate>
      <p className={styles.eyebrow}>You are invited</p>
      <h1 className={styles.title} id="invite-title">
        Join {called}
      </h1>
      <p className={styles.lead}>Send your wallet address to the owner. They add you with a policy; after that you can pay from {called}&apos;s vault inside it.</p>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Your Rein wallet</span>
        <p className={styles.address}>{w.address}</p>
        <p className={styles.fieldHint}>An embedded Solana wallet from Privy. It holds no money and needs none: the vault pays, a sponsor covers fees.</p>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-name`}>Your name, as the owner will see it</label>
        <input id={`${id}-name`} className={styles.input} value={name} maxLength={LABEL_MAX} onChange={(e) => { setName(e.target.value); setCopied(null); }} aria-invalid={problem ? true : undefined} />
        {problem ? <p className={styles.fieldError}>Needs {problem}.</p> : <p className={styles.fieldHint}>The owner chose this; change it if it is wrong.</p>}
      </div>

      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabledReason={message ? undefined : "Fix your name first."}>
          Copy and send to the owner
        </Button>
      </div>
      {copied === "yes" ? <p className={styles.ok} role="status">Copied. Paste it to the owner in any chat. Nothing was sent from here and no money moved.</p> : null}
      {copied === "no" ? (
        <div className={styles.field}>
          <p className={styles.problem} role="status">Could not copy. Select this and send it by hand:</p>
          <input className={styles.input} readOnly value={message} onFocus={(e) => e.currentTarget.select()} aria-label="Message for the owner" />
        </div>
      ) : null}
      <p className={styles.note}>The owner should check this address with you before granting it a policy: whoever holds a wallet can spend what its policy allows.</p>
    </form>
  );
}
