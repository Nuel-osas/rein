"use client";

// Recipients, as Rein has them. Nuntio pays people a team adds by wallet address; Rein pays only
// services in the on-chain registry, and `pay` takes a Service account, never an address. So the
// "recipients" here are the registry: every team sees the same list, and the figures beside each
// service are this team's, summed from its Payment accounts. Nothing on these pages adds a payee,
// because a team being unable to add one is the safety property.

import Link from "next/link";
import {PROGRAM_ID, ago, short, usdc} from "@/lib/chain";
import {groupBy} from "@/lib/metrics";
import {LABEL_MAX, pda, type Service, type Spender} from "@/lib/rein";
import {ButtonLink} from "../Button";
import {PageHeader} from "../PageHeader";
import {Avatar, ContentLoading, EmptyState, StatusPill} from "../ui";
import list from "../ListView.module.css";
import {Explorer, Fact, PaymentPill, initials, spenderName} from "../rein/bits";
import {useTeamPage} from "../rein/context";
import rein from "../rein/rein.module.css";
import styles from "../pages/services.module.css";

const SERVICE_ID_MAX = 32; // programs/rein/src/lib.rs SERVICE_ID_MAX

/** Spenders whose own list holds this service: they pay it without asking, inside their limits. */
function payersOf(service: Service, spenders: Spender[] | null): Spender[] | null {
  return spenders ? spenders.filter((s) => s.status !== "revoked" && s.services.includes(service.address)) : null;
}

function ActivePill({active}: {active: boolean}) {
  // A span of its own, so a grid cell (a Fact) does not stretch the tag across the column.
  return <span style={{justifySelf: "start"}}>{active ? <StatusPill tone="settled" label="Active" /> : <StatusPill tone="neutral" label="Suspended" />}</span>;
}

export function ServiceList() {
  const t = useTeamPage();
  if (t.at === 0) return <ContentLoading label="Reading the service registry from chain…" rows={3} />;
  const totals = t.payments ? new Map(groupBy(t.payments, (p) => p.service, t.now).map((g) => [g.key, g])) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        kind="recipients"
        title="Services"
        description="Who this team can pay. Rein pays only services in the on-chain registry, never a typed address, so the list is the same for every team. The figures are this team's."
        action={<ButtonLink href={`${t.base}/recipients/new`}>How a service is listed</ButtonLink>}
      />

      <div className={`${list.card} ${styles.table}`}>
        <div className={list.head} aria-hidden="true">
          <span>Service</span>
          <span>Payee</span>
          <span className={list.headNumeric}>List price</span>
          <span className={list.headNumeric}>This team paid</span>
          <span>Status</span>
        </div>
        {t.services === null ? (
          <div className={list.empty}>
            <p>Could not read the service registry from chain. This is a network problem, not an empty registry.</p>
          </div>
        ) : t.services.length === 0 ? (
          <div className={list.empty}>
            <p>No services are registered on this cluster yet. The registry admin lists them; see how a service is listed.</p>
          </div>
        ) : (
          <ul className={list.rows} aria-label="Registered services">
            {t.services.map((s) => {
              const g = totals?.get(s.address);
              return (
                <li key={s.address}>
                  <Link href={`${t.base}/recipients/${encodeURIComponent(s.id)}`} className={list.row}>
                    <span className={list.who}>
                      <Avatar initials={initials(s.id.replace(/-/g, " "))} kind="person" small />
                      <span className={list.cell}>
                        <span className={`${list.main} ${rein.mono}`}>{s.id}</span>
                        <span className={list.sub}>{s.label}</span>
                      </span>
                    </span>
                    <span className={list.cell}>
                      <span className={styles.code} title={s.payee}>
                        {short(s.payee, 4)}
                      </span>
                      <span className={list.sub}>payee wallet</span>
                    </span>
                    <span className={`${list.cell} ${list.numeric}`}>
                      <span className={list.text}>{usdc(s.price)}</span>
                      <span className={list.sub}>list price</span>
                    </span>
                    <span className={`${list.cell} ${list.numeric}`}>
                      <span className={list.text}>{totals === null ? "—" : usdc(g?.paid ?? 0n)}</span>
                      <span className={list.sub}>{totals === null ? "could not read payments" : `${g?.paidCount ?? 0} paid${g?.waiting ? ` · ${g.waiting} waiting` : ""}`}</span>
                    </span>
                    <span className={list.cell}>
                      <ActivePill active={s.active} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className={list.quiet}>
        {t.config ? `${t.config.services} services registered. ` : ""}
        The registry admin is <span className={rein.mono}>{t.config ? short(t.config.admin, 6) : "—"}</span>. <Explorer id={pda.config().toBase58()}>Config account</Explorer>
      </p>
    </div>
  );
}

export function ServiceDetail({id}: {id: string}) {
  const t = useTeamPage();
  if (t.at === 0) return <ContentLoading label="Reading the service from chain…" rows={2} />;
  if (t.services === null) {
    return <EmptyState as="h1" title="Could not read the registry" body="This is a problem reaching the network. The service may well exist; try again in a moment." />;
  }
  const s = t.services.find((x) => x.id === id || x.address === id) ?? null;
  if (!s) {
    return (
      <EmptyState
        as="h1"
        title="No such service"
        body={`"${id}" is not in this cluster's registry. Rein can pay only registered services.`}
        action={<Link href={`${t.base}/recipients`}>All services</Link>}
      />
    );
  }
  const mine = t.payments ? t.payments.filter((p) => p.service === s.address) : null;
  const g = mine ? groupBy(mine, () => s.address, t.now)[0] : null;
  const payers = payersOf(s, t.spenders);
  const canPay = !!t.me && t.me.status === "active" && s.active;

  return (
    <div className={styles.page}>
      <Link href={`${t.base}/recipients`} className={styles.back}>
        <span aria-hidden="true">←</span> Services
      </Link>
      <PageHeader
        kind="recipients"
        title={s.label}
        description={
          <>
            <span className={rein.mono}>{s.id}</span> · listed in the Rein registry. A payment names this service; the program reads the payee from it.
          </>
        }
        action={canPay ? <ButtonLink href={`${t.base}/pay?service=${encodeURIComponent(s.id)}`} variant="primary">Pay {s.id}</ButtonLink> : undefined}
      />

      <dl className={rein.facts}>
        <Fact label="Service id">
          <span className={rein.mono}>{s.id}</span>
        </Fact>
        <Fact label="List price" note="Shown to agents. Not a limit: each spender's policy is.">
          {usdc(s.price)}
        </Fact>
        <Fact label="Status" note={s.active ? "Can be paid and settled" : "Suspended by the registry admin: no payment or settlement can reach it"}>
          <ActivePill active={s.active} />
        </Fact>
        <Fact label="Payee wallet" note={<Explorer id={s.payee}>Explorer</Explorer>}>
          <span className={rein.mono}>{short(s.payee, 6)}</span>
        </Fact>
        <Fact label="Payee token account" note={<Explorer id={s.payeeToken}>Explorer</Explorer>}>
          <span className={rein.mono}>{short(s.payeeToken, 6)}</span>
        </Fact>
        <Fact label="Service account" note={<Explorer id={s.address}>Explorer</Explorer>}>
          <span className={rein.mono}>{short(s.address, 6)}</span>
        </Fact>
      </dl>

      <section className={rein.section} aria-labelledby="who-pays">
        <div className={rein.sectionHead}>
          <h2 className={rein.sectionTitle} id="who-pays">Who here pays it without asking</h2>
          <Link href={`${t.base}/spenders`} className={rein.sectionLink}>Spenders →</Link>
        </div>
        <p className={rein.panelNote}>
          Spenders with {s.id} on their list pay it inside their limits. Anyone else on the team can still file a payment to it; the program holds that one for the owner.
        </p>
        <div className={`${list.card} ${styles.payers}`}>
          {payers === null ? <div className={list.empty}><p>Could not read this team&apos;s spenders.</p></div> : null}
          {payers?.length === 0 ? <div className={list.empty}><p>No one on this team has {s.id} on their list yet.{t.isOwner ? " Edit a spender's policy to add it." : ""}</p></div> : null}
          {payers?.length ? (
            <ul className={list.rows} aria-label={`Spenders who may pay ${s.id}`}>
              {payers.map((sp) => (
                <li key={sp.address}>
                  <Link href={sp.kind === "agent" ? `${t.base}/agents/${sp.authority}` : `${t.base}/spenders/${sp.address}`} className={list.row}>
                    <span className={list.who}>
                      <Avatar initials={initials(sp.label)} kind={sp.kind} small />
                      <span className={list.cell}>
                        <span className={list.main}>{sp.label}</span>
                        <span className={list.sub}>{sp.kind === "agent" ? "Agent" : "Person"}{sp.status !== "active" ? ` · ${sp.status}` : ""}</span>
                      </span>
                    </span>
                    <span className={list.cell}>
                      <span className={list.text}>cap {usdc(sp.policy.cap)}</span>
                      <span className={list.sub}>per payment</span>
                    </span>
                    <span className={`${list.cell} ${list.numeric}`}>
                      <span className={list.sub}>{t.isOwner ? "Change →" : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className={rein.section} aria-labelledby="team-payments">
        <div className={rein.sectionHead}>
          <h2 className={rein.sectionTitle} id="team-payments">This team&apos;s payments to {s.id}</h2>
          <span className={rein.panelNote}>{g ? `${usdc(g.paid)} paid in ${g.paidCount}${g.waiting ? ` · ${g.waiting} waiting` : ""}` : mine === null ? "—" : "None yet"}</span>
        </div>
        <div className={`${list.card} ${styles.payments}`}>
          {mine === null ? <div className={list.empty}><p>Could not read this team&apos;s payments. This is not an empty history.</p></div> : null}
          {mine?.length === 0 ? <div className={list.empty}><p>This team has not paid {s.id} yet.</p></div> : null}
          {mine?.length ? (
            <ul className={list.rows} aria-label={`Payments to ${s.id}`}>
              {mine.map((p) => (
                <li key={p.address}>
                  <Link href={`${t.base}/activity/${p.address}`} className={list.row}>
                    <span className={list.cell}>
                      <span className={list.main}>{spenderName(p.spender, t.spenders)}</span>
                      <span className={list.sub}>
                        #{p.number.toString()} · {ago(p.decidedAt || p.createdAt, t.now * 1000)}
                        {p.memo ? ` · ${p.memo}` : ""}
                      </span>
                    </span>
                    <span className={list.cell}>
                      <PaymentPill p={p} now={t.now} />
                    </span>
                    <span className={`${list.cell} ${list.numeric}`}>
                      <span className={list.text}>{usdc(p.amount)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ServiceNew() {
  const t = useTeamPage();
  const admin = t.config?.admin ?? null;
  const youAreAdmin = !!t.wallet && t.wallet === admin;
  const snippet = `// Signed by the registry admin (Config.admin). Teams cannot sign this.
await program.methods
  .registerService("translate", "Translation API", new BN(750_000)) // id, label, price in base units ($0.75)
  .accounts({
    admin: admin.publicKey,
    payeeToken, // a test-USDC token account the payee owns (Config.mint)
  })
  .rpc();

// Later, to stop payments and settlements to it:
await program.methods.setServiceActive(false)
  .accounts({ admin: admin.publicKey, service })
  .rpc();`;

  return (
    <div className={styles.page}>
      <Link href={`${t.base}/recipients`} className={styles.back}>
        <span aria-hidden="true">←</span> Services
      </Link>
      <PageHeader
        kind="recipients"
        title="Add a service"
        description="A team cannot add a payee, and that is the point. Only the registry admin lists services, so no person, agent or owner on a team can send its vault's USDC to an address of their choosing."
      />

      {youAreAdmin ? (
        <p className={rein.notice}>
          <b>You are signed in as the registry admin.</b> Listing a service from the browser is not built; use the program call below from the admin&apos;s CLI wallet.
        </p>
      ) : null}

      <section className={rein.section} aria-labelledby="why">
        <h2 className={rein.sectionTitle} id="why">Why a team cannot add one</h2>
        <ul className={rein.checksList}>
          <li>
            <span className={rein.tick} aria-hidden="true">✓</span>
            <span>
              <b>pay takes a Service account, never an address</b>
              <small>The instruction reads the payee token account from the Service and refuses any other destination.</small>
            </span>
          </li>
          <li>
            <span className={rein.tick} aria-hidden="true">✓</span>
            <span>
              <b>A Service is a PDA only register_service can write</b>
              <small>Seeds [&quot;service&quot;, id], and the instruction requires the signature of Config.admin.</small>
            </span>
          </li>
          <li>
            <span className={rein.tick} aria-hidden="true">✓</span>
            <span>
              <b>The payee account must hold the registry&apos;s USDC</b>
              <small>register_service checks the payee token account against Config.mint, so a service cannot be paid in another token.</small>
            </span>
          </li>
        </ul>
      </section>

      <section className={rein.section} aria-labelledby="how">
        <h2 className={rein.sectionTitle} id="how">How the admin lists one</h2>
        <ol className={styles.steps}>
          <li>
            <div>
              <b>Ask the admin</b>
              <p>
                The registry admin on this cluster is <span className={rein.mono}>{admin ?? "—"}</span>
                {admin ? <> (<Explorer id={admin}>Explorer</Explorer>)</> : " (could not read the Config account)"}.
              </p>
            </div>
          </li>
          <li>
            <div>
              <b>Give a payee token account</b>
              <p>A token account of the registry&apos;s test USDC, owned by whoever should be paid. It is the only place payments to this service can land.</p>
            </div>
          </li>
          <li>
            <div>
              <b>The admin calls register_service</b>
              <p>
                With an id of up to {SERVICE_ID_MAX} lowercase letters, digits or dashes, a label of up to {LABEL_MAX} bytes, and a list price in USDC base units.
              </p>
              <pre className={styles.pre}>{snippet}</pre>
            </div>
          </li>
          <li>
            <div>
              <b>The owner adds it to a spender&apos;s list</b>
              <p>
                Once listed it shows under Services for every team. An owner then puts it on a spender&apos;s list in their policy; until then, a payment to it waits for the owner.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <p className={list.quiet}>
        Program <Explorer id={PROGRAM_ID.toBase58()}>{short(PROGRAM_ID.toBase58(), 6)}</Explorer>. The services on this cluster were listed by the seed script with the same
        call.
      </p>
    </div>
  );
}
