"use client";

// Add a person or an agent (add_spender), or change a spender's policy and services (set_policy +
// set_services in one transaction). Every limit is checked here the way the program checks it, so
// the form refuses what the program would refuse.

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useMemo, useState} from "react";
import {Keypair, PublicKey} from "@solana/web3.js";
import {parseAddress, usdc} from "@/lib/chain";
import {PERIODS, parseCount, parseUsdc} from "@/lib/money";
import {MAX_SERVICES, checkLabel, ixs, policyProblems, type Kind, type Policy, type Spender} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {PageHeader} from "../PageHeader";
import {ContentLoading, EmptyState} from "../ui";
import {StatusLine, sentStatus, type Status} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import {SignInPrompt} from "../WalletButton";
import styles from "../rein/rein.module.css";

type Draft = {label: string; allowance: string; periodSecs: number; cap: string; maxPayments: string; days: string; services: string[]};

const plain = (u: bigint) => usdc(u).slice(1).replace(/,/g, "");

function draftOf(s: Spender, now: number): Draft {
  return {
    label: s.label,
    allowance: plain(s.policy.allowance),
    periodSecs: s.policy.periodSecs,
    cap: plain(s.policy.cap),
    maxPayments: String(s.policy.maxPayments),
    days: String(Math.max(1, Math.ceil((s.policy.expiresAt - now) / 86400))),
    services: s.services,
  };
}

function toPolicy(d: Draft, now: number): {problems: string[]; policy: Policy | null} {
  const allowance = parseUsdc(d.allowance);
  const cap = parseUsdc(d.cap);
  const max = parseCount(d.maxPayments, 1, 4_000_000_000);
  const days = parseCount(d.days, 1, 3650);
  const problems: string[] = [];
  const lp = checkLabel(d.label.trim());
  if (lp) problems.push(lp);
  if (allowance === null) problems.push("an allowance in USDC");
  if (cap === null) problems.push("a cap in USDC");
  if (max === null) problems.push("at least 1 payment per period");
  if (days === null) problems.push("an expiry of 1 to 3650 days");
  if (d.services.length > MAX_SERVICES) problems.push(`at most ${MAX_SERVICES} services`);
  if (problems.length) return {problems, policy: null};
  const policy: Policy = {allowance: allowance!, periodSecs: d.periodSecs, cap: cap!, maxPayments: max!, expiresAt: now + days! * 86400};
  const more = policyProblems(policy, now);
  return more.length ? {problems: more, policy: null} : {problems: [], policy};
}

/** An invite reply's address and name, each used only if it passes the same checks as typing it. */
export type SpenderPrefill = {authority?: string; label?: string};

export function SpenderForm({mode, kind = "agent", spenderId, prefill}: {mode: "add" | "edit"; kind?: Kind; spenderId?: string; prefill?: SpenderPrefill}) {
  const t = useTeamPage();
  const router = useRouter();
  const {publicKey, payer, send} = useWallet();
  const editing = mode === "edit" ? t.spenders?.find((s) => s.address === spenderId) ?? null : null;
  const pre = mode === "add" ? {authority: parseAddress(prefill?.authority?.trim()) ?? "", label: prefill?.label && !checkLabel(prefill.label.trim()) ? prefill.label.trim() : ""} : null;
  const [d, setD] = useState<Draft | null>(mode === "add" ? {label: pre?.label ?? "", allowance: "20", periodSecs: 86400, cap: "5", maxPayments: "10", days: "30", services: []} : null);
  const [authority, setAuthority] = useState(pre?.authority ?? "");
  const fromInvite = !!pre?.authority;
  const [secret, setSecret] = useState<{publicKey: string; bytes: number[]} | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const draft = d ?? (editing ? draftOf(editing, t.now) : null);
  const checked = useMemo(() => (draft ? toPolicy(draft, Math.floor(Date.now() / 1000)) : {problems: [], policy: null}), [draft]);

  if (t.at === 0) return <ContentLoading label="Reading the team from chain…" rows={2} />;
  if (!t.wallet) return <div className={styles.section}><PageHeader kind="spenders" title={mode === "edit" ? "Edit policy" : kind === "agent" ? "Add agent" : "Add person"} description="Only the team owner can grant or change a policy." /><SignInPrompt action={mode === "edit" ? "edit this policy" : "add a spender"} /></div>;
  if (!t.isOwner) return <EmptyState as="h1" title="Only the owner can do this" body="Your signed-in wallet does not own this team, so the program would refuse the change." />;
  if (mode === "edit" && !editing) return <EmptyState as="h1" title="No such spender" body="The link does not match a Spender account of this team." />;
  if (!draft) return null;
  const set = (next: Draft) => setD(next);
  const agent = mode === "edit" ? editing!.kind === "agent" : kind === "agent";

  function generate() {
    const kp = Keypair.generate();
    setAuthority(kp.publicKey.toBase58());
    setSecret({publicKey: kp.publicKey.toBase58(), bytes: Array.from(kp.secretKey)});
  }

  function download() {
    if (!secret) return;
    const blob = new Blob([JSON.stringify(secret.bytes)], {type: "application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rein-agent-${(draft!.label.trim() || "key").replace(/\W+/g, "-").toLowerCase()}.json`;
    a.click();
  }

  async function submit() {
    if (!checked.policy || !publicKey || !payer || !draft) return;
    const policy = checked.policy;
    setBusy(true);
    try {
      if (mode === "add") {
        const auth = parseAddress(authority.trim());
        if (!auth) {
          setStatus({tone: "bad", text: "Enter the public key the spender signs with."});
          return;
        }
        if (t.spenders?.some((s) => s.authority === auth && s.status !== "revoked")) {
          setStatus({tone: "bad", text: "That key is already a spender on this team. Edit its policy instead."});
          return;
        }
        setStatus({tone: "wait", text: `Granting ${draft.label.trim()} a policy…`});
        const sent = await send([ixs.addSpender({payer, owner: publicKey, authority: new PublicKey(auth), kind: agent ? "agent" : "person", label: draft.label.trim(), policy, services: draft.services})]);
        setStatus(sentStatus(sent, `${draft.label.trim()} can now pay under this policy.`));
        if (sent.status === "confirmed") {
          await t.refresh();
          if (!secret) router.push(agent ? `${t.base}/agents/${auth}` : `${t.base}/spenders`);
        }
      } else {
        setStatus({tone: "wait", text: `Updating ${editing!.label}…`});
        const sent = await send([ixs.setPolicy({owner: publicKey, spender: editing!.address, policy}), ixs.setServices({owner: publicKey, spender: editing!.address, services: draft.services})]);
        setStatus(sentStatus(sent, `${editing!.label}'s policy is updated. What it spent this period still counts.`));
        if (sent.status === "confirmed") {
          await t.refresh();
          router.push(editing!.kind === "agent" ? `${t.base}/agents/${editing!.authority}` : `${t.base}/spenders/${editing!.address}`);
        }
      }
    } catch (e) {
      setStatus({tone: "bad", text: errorText(e)});
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "edit" ? `Edit ${editing!.label}` : agent ? "Add agent" : "Add person";
  return (
    <div className={styles.section}>
      <PageHeader
        kind="spenders"
        title={title}
        description={
          agent
            ? "An agent is a keypair that holds no money. It signs pay against its own Spender account, and the program checks this policy every time."
            : "A teammate pays from their own Rein (Privy) wallet, under this policy. Only you can change it."
        }
      />
      {secret ? (
        <div className={styles.secret}>
          <p>
            <b>Agent key, shown once.</b> This keypair is the agent&apos;s only credential. It holds no money and no SOL; it can only sign pay against its own Spender
            account. Keep the file where your agent runs. Rein does not store it.
          </p>
          <p className={styles.mono}>public {secret.publicKey}</p>
          <div className={styles.actions}>
            <Button onClick={download}>Download key file</Button>
            <Button variant="ghost" onClick={() => setSecret(null)}>
              I saved it
            </Button>
          </div>
        </div>
      ) : null}
      {fromInvite ? (
        <p className={styles.notice}>
          <b>Filled in from an invite reply.</b> Check this address with the person before you grant a policy: whoever holds this wallet can spend what the policy
          allows. Nothing is sent until you press Grant policy.
        </p>
      ) : null}
      <div className={styles.form}>
        {mode === "add" ? (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{agent ? "The agent's public key" : "Their Solana wallet address"}</span>
            <input className={styles.input} value={authority} onChange={(e) => setAuthority(e.target.value.trim())} placeholder="base58 public key" spellCheck={false} />
            <span className={styles.fieldHint}>
              {agent ? (
                <>
                  No key yet?{" "}
                  <button type="button" className={styles.explorer} onClick={generate} style={{background: "none", border: 0, padding: 0, cursor: "pointer"}}>
                    Generate one in this browser
                  </button>
                  . The secret never leaves your machine.
                </>
              ) : (
                "Their address is in their account menu after they sign in. They sign their own payments; the vault pays."
              )}
            </span>
          </label>
        ) : null}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Label</span>
          <input className={styles.input} value={draft.label} maxLength={32} onChange={(e) => set({...draft, label: e.target.value})} placeholder={agent ? "Research agent" : "Ada, operations"} />
        </label>
        <div className={styles.row3}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Allowance (USDC)</span>
            <input className={styles.input} inputMode="decimal" value={draft.allowance} onChange={(e) => set({...draft, allowance: e.target.value})} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Per</span>
            <select className={styles.select} value={draft.periodSecs} onChange={(e) => set({...draft, periodSecs: Number(e.target.value)})}>
              {PERIODS.map((p) => (
                <option key={p.secs} value={p.secs}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Cap per payment</span>
            <input className={styles.input} inputMode="decimal" value={draft.cap} onChange={(e) => set({...draft, cap: e.target.value})} />
          </label>
        </div>
        <div className={styles.row3}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Payments per period</span>
            <input className={styles.input} inputMode="numeric" value={draft.maxPayments} onChange={(e) => set({...draft, maxPayments: e.target.value})} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Expires in (days)</span>
            <input className={styles.input} inputMode="numeric" value={draft.days} onChange={(e) => set({...draft, days: e.target.value})} />
          </label>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Services it may pay (up to {MAX_SERVICES})</span>
          <span className={styles.fieldHint}>From the on-chain registry. Anything else is filed for you to approve.</span>
          <div className={styles.checks}>
            {t.services === null ? <span className={styles.muted}>Could not read the service registry.</span> : null}
            {t.services
              ?.filter((s) => s.active)
              .map((s) => (
                <label key={s.address} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={draft.services.includes(s.address)}
                    onChange={(e) => set({...draft, services: e.target.checked ? [...draft.services, s.address] : draft.services.filter((x) => x !== s.address)})}
                  />
                  <span className={styles.mono}>{s.id}</span>
                  <span className={styles.muted}>
                    {s.label} · {usdc(s.price)}
                  </span>
                </label>
              ))}
          </div>
        </div>
        {checked.problems.length ? <p className={styles.problems}>Needs {checked.problems.join(", ")}.</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" busy={busy} onClick={() => void submit()} disabledReason={checked.policy ? undefined : "Fix the fields above first."}>
            {mode === "edit" ? "Save policy" : "Grant policy"}
          </Button>
          <Link href={mode === "edit" ? `${t.base}/spenders/${editing!.address}` : `${t.base}/spenders`} className={styles.sectionLink}>
            Cancel
          </Link>
        </div>
        <StatusLine status={status} />
      </div>
    </div>
  );
}
