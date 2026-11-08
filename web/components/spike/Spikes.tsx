"use client";

// Nuntio's /spike/* pages, ported. Nuntio's spikes render its screens' states from fixtures, for
// review without signing in. Rein's render the real screens against real chain data (the demo team,
// or the whole program), and a state that needs a backend Rein does not have says "not on Rein yet".
// No figure on these pages is invented. They are unlinked from the app, like Nuntio's.

import Link from "next/link";
import {usePathname, useSearchParams} from "next/navigation";
import {useEffect, useState, type ReactNode} from "react";
import {PublicKey} from "@solana/web3.js";
import {Brand} from "@/components/Brand";
import {DEMO_TEAM, PROGRAM_ID, connection, parseAddress, short, usdc} from "@/lib/chain";
import {OUTCOMES, OUTCOME_TEXT, outcomeOf, summarize, type Outcome} from "@/lib/metrics";
import {readProgramStats, type ProgramStats} from "@/lib/program-stats";
import {reasonsOf, type Payment} from "@/lib/rein";
import {useTeam} from "@/lib/team";
import {AppFrame} from "../app/AppFrame";
import {PageHeader} from "../app/PageHeader";
import {ContentLoading, EmptyState, StatusPill} from "../app/ui";
import {ApprovalsList} from "../app/rein/ApprovalsList";
import {PaymentPill, serviceName, spenderName} from "../app/rein/bits";
import {TeamScope} from "../app/rein/context";
import {Activity} from "../app/screens/Activity";
import {Assistant} from "../app/screens/Assistant";
import {Compute} from "../app/screens/Compute";
import {Dashboard} from "../app/screens/Dashboard";
import {GlobalScreen} from "../app/screens/Global";
import {Metrics} from "../app/screens/Metrics";
import {Pay} from "../app/screens/Pay";
import {Receipt} from "../app/screens/Receipt";
import {ServiceList} from "../app/screens/Services";
import global from "../app/pages/global.module.css";
import styles from "./spike.module.css";

const LINKS: [string, string][] = [
  ["/spike/approvals", "Approvals"],
  ["/spike/caller", "Caller"],
  ["/spike/dashboard", "Dashboard"],
  ["/spike/flows", "Flows"],
  ["/spike/stats", "Stats"],
  ["/spike/stats/load-test", "Load test"],
  ["/spike/workspace", "Workspace"],
];

/** The team a spike reads: ?team=<address>, else the demo team. Null when neither is a valid address. */
function useSpikeTeam(): string | null {
  const q = useSearchParams();
  return parseAddress(q?.get("team")) ?? DEMO_TEAM;
}

function Frame({title, description, children}: {title: string; description: ReactNode; children: ReactNode}) {
  const pathname = usePathname();
  return (
    <div className={styles.frame} data-theme="dark" data-app="">
      <header className={styles.bar}>
        <Link href="/" className={styles.brand} aria-label="Rein home">
          <Brand />
          <span className={styles.tag}>spike</span>
        </Link>
        <ul className={styles.links} aria-label="Spikes">
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </header>
      <main className={styles.main}>
        <div className={styles.head}>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </main>
    </div>
  );
}

function State({name, note, children}: {name: string; note?: ReactNode; children: ReactNode}) {
  return (
    <section className={styles.state} aria-label={name}>
      <div className={styles.stateHead}>
        <h2 className={styles.stateName}>{name}</h2>
        {note ? <p className={styles.stateNote}>{note}</p> : null}
      </div>
      <div className={styles.stage}>{children}</div>
    </section>
  );
}

function NoTeam() {
  return <EmptyState title="No team to read" body="Set NEXT_PUBLIC_DEMO_TEAM, or add ?team=<team address> to this page's URL." />;
}

/** A frame like the global pages': a feature Nuntio has and Rein does not, said plainly. */
function NotYet({label, title, line}: {label: string; title: string; line: string}) {
  return (
    <section className={global.frame} aria-label={label}>
      <h2 className={global.label}>{label}</h2>
      <div className={global.status}>
        <StatusPill tone="neutral" label="Not on Rein yet" />
      </div>
      <p className={global.offerTitle}>{title}</p>
      <p className={global.line}>{line}</p>
    </section>
  );
}

/* --- /spike/approvals ------------------------------------------------------------------------ */

export function ApprovalsSpike() {
  const team = useSpikeTeam();
  const t = useTeam(team, 4000);
  const now = useClock();
  const examples = new Map<Outcome, Payment>();
  for (const p of t.payments ?? []) {
    const o = outcomeOf(p, now);
    if (!examples.has(o)) examples.set(o, p);
  }
  return (
    <Frame
      title="Approval states"
      description="Every state one payment can be in, each shown with a real payment from the team's Payment accounts. A state with no payment on chain says so instead of being made up. Read-only: nothing here signs."
    >
      {!team ? (
        <NoTeam />
      ) : t.at === 0 ? (
        <ContentLoading label="Reading payments from chain…" rows={3} />
      ) : (
        <>
          <State name="Waiting for the owner" note="ApprovalsList as the owner sees it, rendered read-only (no owner, no demo signing).">
            <ApprovalsList team={t.team} payments={t.payments} spenders={t.spenders} services={t.services} isOwner={false} demo={false} now={now} onChange={() => void t.refresh()} limit={3} base={`/app/${team}`} />
          </State>
          <State name="Every outcome" note={`Team ${short(team, 4)}. Newest example of each.`}>
            {t.payments === null ? (
              <EmptyState title="Could not read payments" body="A network problem, not an empty history. No state is shown rather than a guessed one." />
            ) : (
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">State</th>
                      <th scope="col">As the app shows it</th>
                      <th scope="col">Example on chain</th>
                      <th scope="col" className={styles.numeric}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OUTCOMES.map((o) => {
                      const p = examples.get(o);
                      return (
                        <tr key={o}>
                          <th scope="row">{OUTCOME_TEXT[o]}</th>
                          <td>{p ? <PaymentPill p={p} now={now} /> : <span className={styles.muted}>—</span>}</td>
                          <td>
                            {p ? (
                              <>
                                <Link href={`/app/${team}/activity/${p.address}`}>#{p.number.toString()}</Link> {spenderName(p.spender, t.spenders)} → {serviceName(p.service, t.services)}
                                {p.reasons ? <div className={styles.muted}>{reasonsOf(p.reasons).join(", ")}</div> : null}
                              </>
                            ) : (
                              <span className={styles.muted}>No payment in this state on chain right now.</span>
                            )}
                          </td>
                          <td className={styles.numeric}>{p ? usdc(p.amount) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </State>
        </>
      )}
    </Frame>
  );
}

function useClock(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* --- /spike/dashboard ------------------------------------------------------------------------ */

export function DashboardSpike() {
  const team = useSpikeTeam();
  return (
    <Frame
      title="Dashboard states"
      description="The team home outside the app frame, in the states a reviewer most needs to see. Each one is the real screen reading the real chain; none is a fixture."
    >
      <State name="Loading" note="What shows before the first read lands.">
        <ContentLoading label="Reading the team from chain…" rows={3} />
      </State>
      <State name="Not a Rein team" note={`The program's own address, ${short(PROGRAM_ID.toBase58(), 4)}, is an account but not a team.`}>
        <TeamScope team={PROGRAM_ID.toBase58()}>
          <Dashboard />
        </TeamScope>
      </State>
      <State name="Live" note={team ? `Team ${short(team, 4)}` : undefined}>
        {team ? (
          <TeamScope team={team}>
            <Dashboard />
          </TeamScope>
        ) : (
          <NoTeam />
        )}
      </State>
    </Frame>
  );
}

/* --- /spike/flows ------------------------------------------------------------------------------ */

export function FlowsSpike() {
  const team = useSpikeTeam();
  const t = useTeam(team, 4000);
  const latest = t.payments?.[0] ?? null;
  return (
    <Frame
      title="Flow states"
      description="New payment, Activity, a receipt and the assistant, the real screens against the team's chain data. New payment shows what a visitor sees: it asks to sign in, and nothing here can sign for you."
    >
      {!team ? (
        <NoTeam />
      ) : (
        <TeamScope team={team}>
          <State name="New payment" note="Signed out, or signed in without a Spender account, it says why it cannot pay.">
            <Pay />
          </State>
          <State name="Activity" note="Every Payment account of the team, newest first.">
            <Activity />
          </State>
          <State name="Receipt" note={latest ? `The newest payment, #${latest.number.toString()}.` : "Needs one payment on chain."}>
            {latest ? <Receipt id={latest.address} /> : t.at === 0 ? <ContentLoading label="Reading payments…" rows={2} /> : <EmptyState title="No payment to show" body={t.payments === null ? "Could not read payments." : "This team has no payments yet."} />}
          </State>
          <State name="Assistant" note="The buying agent. Only the demo team can run it.">
            <Assistant />
          </State>
        </TeamScope>
      )}
    </Frame>
  );
}

/* --- /spike/stats -------------------------------------------------------------------------------- */

export function StatsSpike() {
  const [stats, setStats] = useState<ProgramStats | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true);
    readProgramStats(connection())
      .then(setStats)
      .finally(() => setBusy(false));
  };
  useEffect(load, []);
  const now = Math.floor((stats?.at ?? Date.now()) / 1000);
  const s = stats?.payments ? summarize(stats.payments, now) : null;
  const paidByTeams = stats?.teams ? stats.teams.reduce((a, x) => a + x.paidTotal, 0n) : null;
  const sp = stats?.spenders ?? null;
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US"));

  return (
    <Frame
      title="Stats"
      description={
        <>
          The whole Rein program on this cluster, read from chain: every Team, Spender, Payment and Service account of program{" "}
          <span className={styles.mono}>{short(PROGRAM_ID.toBase58(), 6)}</span>. Unknown reads show a dash. Test USDC only.
        </>
      }
    >
      {!stats ? (
        <ContentLoading label="Reading every program account…" rows={3} />
      ) : (
        <>
          <State name="Program" note={`Read at ${new Date(stats.at).toLocaleTimeString("en-GB", {timeZone: "UTC"})} UTC`}>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <tbody>
                  <tr><th scope="row">Teams</th><td className={styles.numeric}>{n(stats.teams?.length)}</td><td className={styles.muted}>{stats.teams ? `${stats.teams.filter((x) => x.paused).length} paused` : "could not read"}</td></tr>
                  <tr><th scope="row">Spenders</th><td className={styles.numeric}>{n(sp?.length)}</td><td className={styles.muted}>{sp ? `${sp.filter((x) => x.kind === "person").length} people · ${sp.filter((x) => x.kind === "agent").length} agents · ${sp.filter((x) => x.status === "revoked").length} revoked` : "could not read"}</td></tr>
                  <tr><th scope="row">Services in the registry</th><td className={styles.numeric}>{n(stats.services?.length)}</td><td className={styles.muted}>{stats.services ? `${stats.services.filter((x) => x.active).length} active` : "could not read"}{stats.config ? ` · Config says ${stats.config.services}` : ""}</td></tr>
                  <tr><th scope="row">Payments filed</th><td className={styles.numeric}>{n(s?.count)}</td><td className={styles.muted}>{s ? `${s.paidCount} left a vault` : "could not read"}</td></tr>
                  <tr><th scope="row">USDC paid, from Payment accounts</th><td className={styles.numeric}>{s ? usdc(s.paid) : "—"}</td><td className={styles.muted}>paid inside a policy, or approved and settled</td></tr>
                  <tr><th scope="row">USDC paid, from Team counters</th><td className={styles.numeric}>{usdc(paidByTeams)}</td><td className={styles.muted}>{s && paidByTeams !== null ? (s.paid === paidByTeams ? "matches the line above" : "differs from the line above: one read is older") : ""}</td></tr>
                  <tr><th scope="row">Held for owners now</th><td className={styles.numeric}>{s ? usdc(s.held) : "—"}</td><td className={styles.muted}>{s ? `${s.counts.waiting} waiting` : ""}</td></tr>
                </tbody>
              </table>
            </div>
          </State>
          <State name="By outcome" note="Each payment in exactly one row.">
            {s ? (
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th scope="col">Outcome</th><th scope="col" className={styles.numeric}>Payments</th><th scope="col" className={styles.numeric}>USDC asked</th></tr>
                  </thead>
                  <tbody>
                    {OUTCOMES.map((o) => (
                      <tr key={o}><th scope="row">{OUTCOME_TEXT[o]}</th><td className={styles.numeric}>{s.counts[o]}</td><td className={styles.numeric}>{usdc(s.amounts[o])}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Could not read payments" body="A network problem, not a program with no payments." />
            )}
          </State>
          <p className={styles.muted}>
            <button type="button" onClick={load} disabled={busy} style={{font: "inherit", color: "inherit", background: "none", border: "1px solid var(--app-control-edge)", padding: ".5rem .875rem", cursor: "pointer"}}>
              {busy ? "Reading…" : "Read again"}
            </button>{" "}
            Nuntio&apos;s /stats renders invented figures here; this one reads the chain, so it shows exactly what is there.
          </p>
        </>
      )}
    </Frame>
  );
}

export function LoadTestSpike() {
  return (
    <Frame title="Load test" description="Nuntio lists every transaction of a scripted load test here, from its history index.">
      <NotYet
        label="Load test"
        title="No load test has been run on Rein"
        line="It would be many agent keys paying through the program on devnet at once, with every transaction and what the program decided listed here, read from chain. Nothing is shown because nothing was run."
      />
    </Frame>
  );
}

/* --- /spike/caller ------------------------------------------------------------------------------ */

type Seen = {payment: Payment; signature: string | null; feePayer: string | null; signers: string[] | null; error?: string};

/**
 * Nuntio's caller spike asked what a contract sees as msg.sender when Privy sponsors the gas. On
 * Solana the question is which key the program authorizes when the sponsor pays the fee. This reads
 * the transaction that filed each recent payment and compares its fee payer, its signers and the
 * Payment's recorded authority.
 */
async function inspect(p: Payment): Promise<Seen> {
  const conn = connection();
  try {
    const sigs = await conn.getSignaturesForAddress(new PublicKey(p.address), {limit: 20}, "confirmed");
    const first = sigs.length ? sigs[sigs.length - 1].signature : null; // oldest: the pay that created it
    if (!first) return {payment: p, signature: null, feePayer: null, signers: null, error: "no transaction history on this RPC"};
    const tx = await conn.getTransaction(first, {maxSupportedTransactionVersion: 0, commitment: "confirmed"});
    if (!tx) return {payment: p, signature: first, feePayer: null, signers: null, error: "transaction not found"};
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
    const n = tx.transaction.message.header.numRequiredSignatures;
    return {payment: p, signature: first, feePayer: keys[0] ?? null, signers: keys.slice(0, n)};
  } catch (e) {
    return {payment: p, signature: null, feePayer: null, signers: null, error: String((e as Error)?.message ?? e).slice(0, 120)};
  }
}

export function CallerSpike() {
  const team = useSpikeTeam();
  const t = useTeam(team, 10_000);
  const [seen, setSeen] = useState<Seen[] | null>(null);
  const recent = t.payments?.slice(0, 5) ?? null;
  const key = recent?.map((p) => p.address).join(",") ?? "";
  useEffect(() => {
    if (!recent) return;
    let stop = false;
    Promise.all(recent.map(inspect)).then((r) => !stop && setSeen(r));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const sponsored = seen?.filter((x) => x.feePayer && x.feePayer !== x.payment.authority) ?? [];
  const authorized = seen?.filter((x) => x.signers?.includes(x.payment.authority)) ?? [];

  return (
    <Frame
      title="Who the program sees"
      description="When a sponsor pays the fee, which key does Rein authorize? This reads the transaction that filed each of the team's newest payments and compares the fee payer, the signers and the authority the Payment account recorded."
    >
      {!team ? (
        <NoTeam />
      ) : !seen ? (
        <ContentLoading label="Reading transactions…" rows={3} />
      ) : seen.length === 0 ? (
        <EmptyState title="No payments to inspect" body="This team has no Payment accounts yet. Make one payment and reload." />
      ) : (
        <>
          <div className={styles.verdict} data-tone={authorized.length === seen.length ? undefined : "warn"}>
            <b>
              {authorized.length === seen.length
                ? "The spender's key is the signer the program checks"
                : "Inconclusive for some payments"}
            </b>
            <p>
              In {authorized.length} of {seen.length} payments the recorded authority signed the transaction; in {sponsored.length} of them someone else paid the fee. pay
              requires the Spender&apos;s authority as a signer and treats the fee payer only as the payer of rent and fees, so a sponsor never gains the right to spend.
            </p>
          </div>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Payment</th>
                  <th scope="col">Authority (recorded)</th>
                  <th scope="col">Fee payer</th>
                  <th scope="col">Signers</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {seen.map((x) => (
                  <tr key={x.payment.address}>
                    <th scope="row">
                      <Link href={`/app/${team}/activity/${x.payment.address}`}>#{x.payment.number.toString()}</Link>
                      <div className={styles.muted}>{spenderName(x.payment.spender, t.spenders)}</div>
                    </th>
                    <td className={styles.mono}>{short(x.payment.authority, 6)}</td>
                    <td className={styles.mono}>{x.feePayer ? `${short(x.feePayer, 6)}${x.feePayer === x.payment.authority ? " (same)" : ""}` : "—"}</td>
                    <td className={styles.mono}>{x.signers ? x.signers.map((k) => short(k, 4)).join(", ") : "—"}</td>
                    <td className={styles.mono}>{x.signature ? short(x.signature, 8) : <span className={styles.muted}>{x.error ?? "—"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Frame>
  );
}

/* --- /spike/workspace ----------------------------------------------------------------------------- */

const SCREENS = ["home", "metrics", "services", "compute", "global", "assistant", "keys", "ramp"] as const;
type Screen = (typeof SCREENS)[number];

export function WorkspaceSpike() {
  const team = useSpikeTeam();
  const q = useSearchParams();
  const raw = q?.get("screen");
  const screen: Screen = (SCREENS as readonly string[]).includes(raw ?? "") ? (raw as Screen) : "home";
  const href = (s: Screen) => `/spike/workspace?screen=${s}${q?.get("team") ? `&team=${q.get("team")}` : ""}`;

  if (!team) {
    return (
      <Frame title="Workspace shell" description="The app frame with a real screen inside.">
        <NoTeam />
      </Frame>
    );
  }
  let body: ReactNode;
  if (screen === "metrics") body = <Metrics />;
  else if (screen === "services") body = <ServiceList />;
  else if (screen === "compute") body = <Compute />;
  else if (screen === "global") body = <GlobalScreen page="account" />;
  else if (screen === "assistant") body = <Assistant />;
  else if (screen === "keys")
    body = (
      <div className={global.page}>
        <PageHeader kind="compute" title="API keys" description="Nuntio sells AI API keys paid from the account." />
        <NotYet label="API keys" title="Rein sells no API keys" line="On Rein a key would be an agent's Spender with its own policy, so every call it pays for meets the same cap, allowance and owner approval." />
      </div>
    );
  else if (screen === "ramp")
    body = (
      <div className={global.page}>
        <PageHeader kind="money" title="Naira" description="Nuntio adds money from a Nigerian bank and cashes out to one." />
        <NotYet label="Naira ramp" title="Rein has no bank ramp" line="On Rein it would move bank money into the team vault as USDC and back, with the owner approving anything over a limit." />
      </div>
    );
  else body = <Dashboard />;

  return (
    <div data-theme="dark">
      <nav className={styles.screens} aria-label="Screens">
        <span className={styles.tag}>spike · workspace</span>
        {SCREENS.map((s) => (
          <Link key={s} href={href(s)} aria-current={s === screen ? "page" : undefined}>
            {s}
          </Link>
        ))}
      </nav>
      <AppFrame team={team}>
        <TeamScope team={team}>{body}</TeamScope>
      </AppFrame>
    </div>
  );
}
