import type {ReactNode} from "react";
import Link from "next/link";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {PROGRAM_ID, explorer} from "@/lib/chain";
import type {ApprovalSplit, LatestPayment, StatsSnapshot} from "@/lib/stats/read-stats";
import {CountUp} from "./CountUp";
import {Bracketed, LinkArrow, TracedPage} from "./Traced";
import {UNKNOWN_MARK, baseUnitsToCents, formatCount, formatUsdc, plural, sinceText} from "./format";
import {UpdatedAgo} from "./UpdatedAgo";
import styles from "./Stats.module.css";

/* ===========================================================================
   /stats: what Rein has actually done, read live from the Rein program on
   Solana, set in the marketing site's drawing (hairline frames, bracketed
   monospace labels, datum crosses at the corners, square everything).

   Presentational only: the route reads the snapshot (`lib/stats/read-stats`)
   and passes it here.

   An unknown figure is a dash AND a sentence saying why. A dash alone reads as
   a rule, and a zero would be a claim.
   =========================================================================== */

const CHAIN_WHY = `We could not read these accounts from ${NETWORK_NAME} just now. This is not a zero; the page tries again within a minute.`;

/** The page's masthead and ground. The figures go inside, streamed when they are read. */
export function StatsFrame({children}: {children: ReactNode}) {
  return (
    <TracedPage
      label={`Live on ${NETWORK_NAME}`}
      titleId="stats-title"
      title={
        <>
          Rein,
          <br />
          in numbers
        </>
      }
      lede={
        <>
          <p>Read from the Rein program on {NETWORK_NAME}, account by account, each time this page is rendered. Test USDC, not real money.</p>
          <p>
            <Link className={styles.control} href="/stats/load-test">
              Load test
              <LinkArrow />
            </Link>
          </p>
        </>
      }
    >
      {children}
    </TracedPage>
  );
}

/* --- Figures ------------------------------------------------------------------- */

type Figure = {kind: "count"; value: number} | {kind: "usdc"; baseUnits: string};

interface TileSpec {
  id: string;
  label: string;
  /** Null: not known, and `unknown` says why. */
  figure: Figure | null;
  unknown?: string;
  /** One short line under the figure. */
  sub?: string | null;
  note: string;
  /** A labelled fact that is not ours (the network's). */
  fact?: string;
}

/** The figure itself. Its heading, just above it, says what it counts. */
function FigureValue({figure}: {figure: Figure}) {
  if (figure.kind === "usdc") {
    const text = formatUsdc(figure.baseUnits);
    const cents = baseUnitsToCents(figure.baseUnits);
    return cents === null ? <>{text}</> : <CountUp value={cents} kind="cents" text={text} label={text} />;
  }
  const text = formatCount(figure.value);
  return <CountUp value={figure.value} kind="count" text={text} label={text} />;
}

function Tile({tile}: {tile: TileSpec}) {
  return (
    <li className={`${styles.tile} ${styles.frame}`}>
      <h3 className={styles.label} id={`${tile.id}-label`}>
        <Bracketed>{tile.label}</Bracketed>
      </h3>
      <p className={styles.figure} data-unknown={tile.figure === null || undefined}>
        {tile.figure ? (
          <FigureValue figure={tile.figure} />
        ) : (
          <>
            <span aria-hidden="true">{UNKNOWN_MARK}</span>
            <span className={styles.srOnly}>Not known.</span>
          </>
        )}
      </p>
      {tile.figure === null && tile.unknown ? <p className={styles.unknown}>{tile.unknown}</p> : null}
      <div className={styles.tileFoot}>
        {tile.sub ? <p className={styles.sub}>{tile.sub}</p> : null}
        <p className={styles.note}>{tile.note}</p>
        {tile.fact ? <p className={styles.fact}>{tile.fact}</p> : null}
      </div>
    </li>
  );
}

/** The six figures, in the order a judge asks: who, how much, and does it work on its own. */
export function statTiles(stats: StatsSnapshot): TileSpec[] {
  const {spenders, payments, services} = stats;
  return [
    {
      id: "teams",
      label: "Teams",
      figure: stats.teams === null ? null : {kind: "count", value: stats.teams},
      unknown: CHAIN_WHY,
      note: "Team accounts on the Rein program, each with its own USDC vault. The demo team is one of them.",
    },
    {
      id: "spenders",
      label: "With a spending policy",
      figure: spenders.total === null ? null : {kind: "count", value: spenders.total},
      unknown: CHAIN_WHY,
      sub: spenders.people === null || spenders.agents === null ? null : `${plural(spenders.people, "person", "people")} · ${plural(spenders.agents, "agent")}`,
      note: "Spender accounts: one person or AI agent on one team, under a policy the program enforces.",
    },
    {
      id: "payments",
      label: "Payments settled",
      figure: payments.settled === null ? null : {kind: "count", value: payments.settled},
      unknown: CHAIN_WHY,
      sub: payments.viaApproval ? `${formatCount(payments.viaApproval)} after the owner approved them` : null,
      note: "Each one cleared its spender's onchain policy at once, or settled when the owner approved it.",
    },
    {
      id: "paid",
      label: "USDC paid",
      figure: payments.amount === null ? null : {kind: "usdc", baseUnits: payments.amount},
      unknown: CHAIN_WHY,
      note: "Test USDC on devnet, the sum of each settled payment record's amount. Not real money.",
    },
    {
      id: "agents",
      label: "Paid by agents",
      figure: payments.byAgents === null ? null : {kind: "count", value: payments.byAgents},
      unknown: CHAIN_WHY,
      sub: payments.records === null ? null : `${plural(payments.records, "payment record")} in all, any status`,
      note: "Signed by an agent's own key, which holds no SOL: the sponsor paid the fee.",
    },
    {
      id: "services",
      label: "Services in the registry",
      figure: services.total === null ? null : {kind: "count", value: services.total},
      unknown: CHAIN_WHY,
      sub: services.active === null || services.active === services.total ? null : `${formatCount(services.active)} active`,
      note: "The only payees a spender can reach. A payment names a service, never an address.",
      fact: "Network fact, not our measurement: Solana targets a new slot about every 400 milliseconds.",
    },
  ];
}

/* --- Held for the owner ------------------------------------------------------------ */

function HeldForApproval({approvals}: {approvals: ApprovalSplit | null}) {
  const stopped = approvals ? approvals.declined + approvals.refused : 0;
  const undecided = approvals ? approvals.waiting + approvals.expired + approvals.cancelled : 0;
  return (
    <section className={`${styles.held} ${styles.frame}`} aria-labelledby="held-title">
      <div className={styles.heldLead}>
        <h2 className={styles.label} id="held-title">
          <Bracketed>Held for the owner</Bracketed>
        </h2>
        <p className={styles.note}>
          Over a limit, <code>pay</code> does not revert: it files a Pending payment record with every reason, and the owner decides. A payment the program
          refused outright left no record, so it is not counted here.
        </p>
      </div>
      <div className={styles.heldBody}>
        {approvals === null ? (
          <>
            <p className={styles.statement}>We could not count the payments the rules held.</p>
            <p className={styles.unknown}>{CHAIN_WHY}</p>
          </>
        ) : approvals.filed === 0 ? (
          <p className={styles.statement}>No payment has been held for an owner yet.</p>
        ) : (
          <>
            <p className={styles.statement}>
              Rules held{" "}
              <strong>
                <CountUp value={approvals.filed} kind="count" text={formatCount(approvals.filed)} label={formatCount(approvals.filed)} />
              </strong>{" "}
              {approvals.filed === 1 ? "payment" : "payments"} until the owner decided.
            </p>
            <div className={styles.bar} aria-hidden="true">
              {approvals.settled > 0 ? <span data-part="approved" style={{flexGrow: approvals.settled}} /> : null}
              {stopped > 0 ? <span data-part="declined" style={{flexGrow: stopped}} /> : null}
              {undecided > 0 ? <span data-part="undecided" style={{flexGrow: undecided}} /> : null}
            </div>
            <ul className={styles.legend}>
              <li>
                <span className={styles.swatch} data-part="approved" aria-hidden="true" />
                <span>Approved and settled</span>
                <strong>{formatCount(approvals.settled)}</strong>
              </li>
              <li>
                <span className={styles.swatch} data-part="declined" aria-hidden="true" />
                <span>Declined or refused</span>
                <strong>{formatCount(stopped)}</strong>
                {approvals.refused > 0 ? <small>{formatCount(approvals.refused)} refused by a stop at approval</small> : null}
              </li>
              <li>
                <span className={styles.swatch} data-part="undecided" aria-hidden="true" />
                <span>No decision</span>
                <strong>{formatCount(undecided)}</strong>
                {undecided > 0 ? (
                  <small>
                    {[
                      approvals.waiting > 0 ? `${formatCount(approvals.waiting)} waiting` : null,
                      approvals.expired > 0 ? `${formatCount(approvals.expired)} ran out of time` : null,
                      approvals.cancelled > 0 ? `${formatCount(approvals.cancelled)} withdrawn` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </small>
                ) : null}
              </li>
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/* --- Latest payments ----------------------------------------------------------------- */

const SPENDER_WORD = {agent: "Agent", person: "Person"} as const;

function PaymentRow({payment, now}: {payment: LatestPayment; now: number}) {
  const when = payment.at > 0 ? sinceText(payment.at, now) : null;
  const detail = [SPENDER_WORD[payment.kind], payment.team, payment.viaApproval ? "approved by the owner" : null].filter(Boolean).join(" · ");
  return (
    <tr>
      <th scope="row">
        <span className={styles.service}>{payment.service ?? "Unnamed service"}</span>
        <span className={styles.detail}>{detail}</span>
        {when ? <span className={styles.whenInline}>{when}</span> : null}
      </th>
      <td className={styles.amount}>{formatUsdc(payment.amount)}</td>
      <td className={styles.when}>{when ?? UNKNOWN_MARK}</td>
      <td className={styles.link}>
        <a href={explorer("address", payment.address)} target="_blank" rel="noreferrer">
          Record
          <span className={styles.srOnly}> (opens this payment record on the Solana explorer in a new tab)</span>
          <LinkArrow kind="external" />
        </a>
      </td>
    </tr>
  );
}

function LatestPayments({latest, now}: {latest: LatestPayment[] | null; now: number}) {
  return (
    <section className={styles.latest} aria-labelledby="latest-title">
      <h2 className={styles.label} id="latest-title">
        <Bracketed>Latest payments</Bracketed>
      </h2>
      {latest === null ? (
        <p className={`${styles.unknown} ${styles.frame} ${styles.empty}`}>{CHAIN_WHY}</p>
      ) : latest.length === 0 ? (
        <p className={`${styles.frame} ${styles.empty}`}>No payment has settled on a Rein team yet.</p>
      ) : (
        <div className={`${styles.tableFrame} ${styles.frame}`}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>The newest settled payments on Rein teams, newest first, each read from its payment record.</caption>
            <thead>
              <tr>
                <th scope="col">Payment</th>
                <th scope="col" className={styles.amount}>
                  Amount
                </th>
                <th scope="col" className={styles.when}>
                  When
                </th>
                <th scope="col" className={styles.link}>
                  <span className={styles.srOnly}>Payment record</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {latest.map((payment) => (
                <PaymentRow key={payment.address} payment={payment} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --- The body ---------------------------------------------------------------------- */

const SOURCES: ReadonlyArray<[string, string]> = [
  [
    "Teams, spenders, payments, services",
    "getProgramAccounts on the Rein program, filtered by each account type's 8-byte Anchor discriminator and decoded with the program's IDL. Nothing is indexed or stored by us.",
  ],
  ["USDC paid", "The amount on every payment record whose status is Paid or Settled, added up in integer base units and formatted only for display."],
  ["People and agents", "The kind recorded on each Spender account when the owner added it."],
  ["Unknown figures", "A read that fails, or a record that will not decode, makes that figure a dash with the reason. It is never shown as zero."],
];

function Coverage({stats}: {stats: StatsSnapshot}) {
  const read = [stats.teams, stats.spenders.total, stats.payments.records, stats.services.total].filter((v) => v !== null).length;
  if (read === 4) return <>Every figure read from {NETWORK_NAME}</>;
  if (read === 0) return <>Nothing could be read from {NETWORK_NAME} just now</>;
  return <>Some figures could not be read from {NETWORK_NAME} just now</>;
}

export function StatsBody({stats, now}: {stats: StatsSnapshot; now: number}) {
  const ageSeconds = Math.max(0, (now - stats.readAt) / 1000);
  const allUnknown = stats.teams === null && stats.spenders.total === null && stats.payments.records === null && stats.services.total === null;
  return (
    <div className={styles.body}>
      <div className={styles.figures}>
        <p className={styles.meta}>
          <span className={styles.metaBlock}>
            {stats.slot !== null && !allUnknown ? <Bracketed>At slot {formatCount(stats.slot)}</Bracketed> : <Bracketed>Chain not read</Bracketed>}
          </span>
          <UpdatedAgo readAt={stats.readAt} ageSeconds={ageSeconds} />
        </p>
        {allUnknown ? (
          <p className={styles.notice} role="note">
            {CHAIN_WHY}
          </p>
        ) : null}

        <section aria-labelledby="figures-title">
          <h2 className={styles.srOnly} id="figures-title">
            The figures
          </h2>
          <ul className={styles.grid}>
            {statTiles(stats).map((tile) => (
              <Tile key={tile.id} tile={tile} />
            ))}
          </ul>
        </section>
      </div>

      <HeldForApproval approvals={stats.approvals} />
      <LatestPayments latest={stats.latest} now={now} />

      <footer className={styles.foot}>
        <p className={styles.coverage}>
          <Coverage stats={stats} />, program{" "}
          <a href={explorer("address", PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            {PROGRAM_ID.toBase58().slice(0, 4)}…{PROGRAM_ID.toBase58().slice(-4)}
          </a>
          . <UpdatedAgo readAt={stats.readAt} ageSeconds={ageSeconds} />.
        </p>
        <details className={styles.method}>
          <summary>How these are counted</summary>
          <dl>
            {SOURCES.map(([term, text]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      </footer>
    </div>
  );
}

/** What shows while a cold server reads the figures: the same frames, no numbers. */
export function StatsBodyFallback() {
  const labels = ["Teams", "With a spending policy", "Payments settled", "USDC paid", "Paid by agents", "Services in the registry"];
  return (
    <div className={`${styles.body} ${styles.figures}`}>
      <p className={styles.meta} role="status">
        <span className={styles.metaBlock}>
          <Bracketed>Reading the chain</Bracketed>
        </span>
      </p>
      <ul className={styles.grid} aria-hidden="true">
        {labels.map((label) => (
          <li key={label} className={`${styles.tile} ${styles.frame}`}>
            <p className={styles.label}>
              <Bracketed>{label}</Bracketed>
            </p>
            <span className={styles.placeholder} />
          </li>
        ))}
      </ul>
    </div>
  );
}
