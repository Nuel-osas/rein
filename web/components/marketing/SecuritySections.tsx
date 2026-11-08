import type {ReactNode} from "react";

import {PROGRAM_ID} from "@/lib/chain";
import {IconCheck, IconNotice, IconShield} from "./Icons";
import {Section} from "./Section";
import styles from "./SecuritySections.module.css";

/* ===========================================================================
   The three bands of the security page.

   THE RULE THIS FILE IS WRITTEN UNDER

   Every sentence below has to be traceable to a line of `programs/rein`, a file
   in this repository, or a transaction on Solana devnet. Not "designed to", not
   "will", not "industry standard". The page's only value is that a judge can
   open the thing it names and find it there, so a claim that cannot be pointed
   at is a claim that does not get written. That is also why there is no badge,
   no certification mark and no score: none of those would be backed by anything.

   The consequence is the third band. A page that lists what stops a payment and
   stops there is marketing; the same page with the unfinished half printed at
   the same size is a statement somebody can act on. So `LIMITS` is not a
   footnote, it is a band of its own, it sits last because it is what the reader
   should leave with, and its copy is not softened.

   WHY AMBER AND NOT RED

   Two different things wear amber here and neither is an error. A payment held
   for the owner is the program working, which is the whole argument of the
   product. A gap in what we have built is a fact about the project's stage
   rather than something that went wrong for the reader. Red would make the
   first read as a failure and the second as an emergency, and there is no
   warning triangle anywhere on this page for the same reason.

   THE EVIDENCE IS DEVNET, WHATEVER THIS BUILD POINTS AT

   The transactions below were mined on Solana devnet by `pnpm evidence` and are
   written down in docs/EVIDENCE.md. Their explorer links therefore name devnet
   explicitly rather than following the build's cluster: a local build linking
   them to a local validator would link nothing.
   =========================================================================== */

const PROGRAM = PROGRAM_ID.toBase58();
/** The deploy transaction, from docs/CONSTANTS.md. */
const DEPLOY_TX =
  "2dGZ8Pw9sq9mVJ1q5dJtYtwqWZxWF4cHqv76khz8Cc2VoyxzxvMhsTjA21vo58ax4Ud82hJQsS5nAgQiD1h9o3Ju";
/** The deployer's CLI wallet, the program's upgrade authority (docs/CONSTANTS.md). */
const UPGRADE_AUTHORITY = "DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk";
/** The test USDC mint's authority: a key the project holds, so this is not Circle USDC. */
const MINT_AUTHORITY = "9VUaEpHp4Bka2Yce6EtBxNGi5sb3pbd8SvkY75URQ2bx";

function devnet(kind: "address" | "tx", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
}

/**
 * An address, shown whole.
 *
 * Never truncated. A shortened address is exactly as long as a wrong one looks,
 * and the point of printing it is that somebody can paste it into an explorer.
 */
function Address({children}: {children: string}) {
  return <code className={styles.address}>{children}</code>;
}

/**
 * A transaction, linked. The text is the signature's first ten characters, the
 * way docs/EVIDENCE.md prints it; the whole signature is the link, so nothing
 * is lost by shortening what is read.
 */
function Tx({sig}: {sig: string}) {
  return (
    <a className={styles.link} href={devnet("tx", sig)} rel="noreferrer noopener" target="_blank">
      <code className={styles.address}>{sig.slice(0, 10)}…</code>
      <span aria-hidden="true"> ↗</span>
      <span className={styles.srOnly}> (opens the transaction on the Solana explorer, devnet)</span>
    </a>
  );
}

/* ---------------------------------------------------------------------------
   Band 1: the six checks.
   ------------------------------------------------------------------------- */

type Layer = {
  key: string;
  name: string;
  /** The mechanism in one line. This is the sentence a reader should remember. */
  claim: string;
  body: ReactNode;
  /** Where to look. Text rather than links: a path is something to open, not a page to visit. */
  where: readonly string[];
};

const LAYERS: readonly Layer[] = [
  {
    key: "registry",
    name: "The registry",
    claim: "A payee the registry does not name cannot be paid.",
    body: (
      <>
        <code>pay</code> takes an intent, an amount and a memo, and the service as an account. It
        takes no address. The service account is found by its id, so an id nobody registered has no
        account and the transaction fails before the program runs (<code>AccountNotInitialized</code>).
        The payee token account must be the one the registry recorded, or the program refuses with{" "}
        <code>WrongPayee</code>. A prompt-injected agent has nowhere to put an address.
      </>
    ),
    where: ["programs/rein/src/lib.rs · Pay", "agent/src/tools.ts"],
  },
  {
    key: "policy",
    name: "The policy",
    claim: "A stop refuses outright. A limit sends the payment to the owner.",
    body: (
      <>
        Before anything moves, <code>pay</code> refuses a paused team (<code>TeamPaused</code>), a
        paused or revoked spender (<code>NotActive</code>), an expired policy (<code>Expired</code>)
        and a suspended service (<code>ServiceSuspended</code>). Then it measures the payment against
        the cap, the allowance for the period, the number of payments and the allowed services.
        Inside all four it settles in the same transaction; over any of them it is filed as Pending,
        with every reason recorded, and nothing moves.
      </>
    ),
    where: ["programs/rein/src/lib.rs · pay, over_limits"],
  },
  {
    key: "approval",
    name: "The approval",
    claim: "An approval waives a budget, never a stop.",
    body: (
      <>
        <code>approve</code> checks the stops again, as they stand at approval. A spender paused,
        revoked or re-granted since the payment was filed (its generation changed), a policy that has
        expired, a suspended service or a payee that no longer matches: the payment is marked
        Refused, for good, and nothing moves. A paused team refuses the approval itself, and a
        pending payment can only be approved for 24 hours (<code>RequestExpired</code>).
      </>
    ),
    where: ["programs/rein/src/lib.rs · approve"],
  },
  {
    key: "intent",
    name: "The intent",
    claim: "One intent is paid or filed at most once.",
    body: (
      <>
        Every payment record lives at an address derived from the spender and an intent string, and{" "}
        <code>pay</code> creates it fresh. A retry of the same intent finds the record already there
        and fails, so an agent that times out and tries again cannot pay twice. The agent draws a new
        intent, with 72 random bits, for every payment it proposes.
      </>
    ),
    where: ["programs/rein/src/lib.rs · Pay (payment seeds)", "agent/src/intent.ts"],
  },
  {
    key: "owner",
    name: "The owner’s key",
    claim: "Only the owner approves, declines, withdraws or changes a policy.",
    body: (
      <>
        Every owner instruction finds the team at the address derived from the signer and requires
        that signer to be its owner. The spender that filed a pending payment may cancel it, and
        nobody else but the owner (<code>NotOwnerOrFiler</code>). A spender’s key moves money only
        through <code>pay</code>, under its own policy, and holds no money and no SOL of its own.
      </>
    ),
    where: ["programs/rein/src/lib.rs · OwnerTeam, OwnerSpender, Approve, Withdraw, Cancel"],
  },
  {
    key: "sponsor",
    name: "The sponsor",
    claim: "It pays the fees, and signs for nothing else.",
    body: (
      <>
        The relay co-signs a browser wallet’s transaction as its fee payer only after checking it:
        Rein’s program and twelve of its instructions, compute-budget settings within a ceiling, and
        one create-if-missing of the signer’s own test-USDC account, nothing else. The sponsor key
        may sit only as fee payer and as the <code>payer</code> of <code>pay</code>,{" "}
        <code>create_team</code> or <code>add_spender</code>, and every other signature must already
        be present and valid. It never reads a policy; the program does.
      </>
    ),
    where: ["web/app/api/sponsor/route.ts", "web/lib/server/privy.ts"],
  },
];

export function SecurityLayers() {
  return (
    <Section
      id="layers"
      eyebrow="The six checks"
      title="Six refusals, and no two of them are the same check."
      lede="One check that fails closed is one bug away from failing open. Five of these run inside the program that holds the money and one in front of it. They refuse for different reasons, and passing one earns nothing at the next."
    >
      {/* `role="list"` restores the semantics `list-style: none` removes in
          Safari. The visible numbering is decorative and hidden. */}
      <ol className={styles.layers} role="list">
        {LAYERS.map((layer, index) => (
          <li className={styles.layer} key={layer.key}>
            <span className={`eyebrow figure ${styles.layerIndex}`} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className={styles.layerName}>{layer.name}</h3>
            <p className={styles.layerClaim}>{layer.claim}</p>
            <p className={styles.layerBody}>{layer.body}</p>
            <p className={styles.where}>
              <span className={styles.whereLabel}>In the repository</span>
              {layer.where.map((path) => (
                <code className={styles.path} key={path}>
                  {path}
                </code>
              ))}
            </p>
          </li>
        ))}
      </ol>

      <p className={styles.note}>
        <IconShield />
        <span>
          No check trusts the answer of the one before it. The app showing a service’s payee, or the
          agent reading its own budget, is a convenience that makes a clearer screen, never a
          permission: the program reads the registry and the policy again in the transaction that
          moves the money.
        </span>
      </p>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
   Band 2: what has actually been run.
   ------------------------------------------------------------------------- */

type Finding = {
  key: string;
  term: string;
  body: ReactNode;
  /** Where the record lives, so a reader can go and read it rather than this summary. */
  source: string;
};

const FINDINGS: readonly Finding[] = [
  {
    key: "program",
    term: "The program is deployed",
    body: (
      <>
        On Solana devnet at <Address>{PROGRAM}</Address>. The deployed program is{" "}
        <span className="figure">360,400</span> bytes, the size of the build from{" "}
        <code>programs/rein</code> at commit <code>7c66d98</code>.{" "}
        <a className={styles.link} href={devnet("address", PROGRAM)} rel="noreferrer noopener" target="_blank">
          Open the program
        </a>{" "}
        · deploy <Tx sig={DEPLOY_TX} />
      </>
    ),
    source: "docs/CONSTANTS.md",
  },
  {
    key: "paid",
    term: "An agent with no SOL paid inside its policy",
    body: (
      <>
        A fresh agent holding <span className="figure">0</span> SOL paid{" "}
        <span className="figure">0.40</span> test USDC for <code>web-search</code>. The sponsor paid
        the fee and the payment record’s rent; the USDC came from the team’s vault. <Tx sig="4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6" />
      </>
    ),
    source: "docs/EVIDENCE.md",
  },
  {
    key: "held",
    term: "Over its cap, the payment waited",
    body: (
      <>
        The same agent asked for <span className="figure">9</span> USDC of GPU time against a{" "}
        <span className="figure">5</span> USDC cap. The program filed it as Pending with the reason{" "}
        <code>over_cap</code>, and nothing moved. <Tx sig="w1VEqKk3icLuuBUgreeyafsHFQyyiXy9MuJVHETjr6edEnLSkWNjCchvfbJs3MBtm6CJUPgVTprC1ZZNAKoBDbo" />
      </>
    ),
    source: "docs/EVIDENCE.md",
  },
  {
    key: "approved",
    term: "The owner’s approval settled it in one transaction",
    body: (
      <>
        The owner approved, and the <span className="figure">9</span> USDC left the vault for the
        registry’s payee in the same transaction as the approval. <Tx sig="3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa" />
      </>
    ),
    source: "docs/EVIDENCE.md",
  },
  {
    key: "unknown",
    term: "A made-up service was refused on chain",
    body: (
      <>
        A prompt-injected agent tried a service called <code>wallet-9xqe</code>, which nobody
        registered. The transaction was mined and failed with <code>AccountNotInitialized</code>, so
        the refusal has a signature anyone can look up. <Tx sig="5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA" />
      </>
    ),
    source: "docs/EVIDENCE.md",
  },
  {
    key: "payee",
    term: "An attacker’s payee was refused on chain",
    body: (
      <>
        The agent passed a token account of its own choosing as the <code>web-search</code> payee.
        The program refused it with <code>WrongPayee</code>, because the registry names a different
        account. <Tx sig="4uZN8NEASQZjW1HyqTPHxaZQ7QfQjL5WeHC94Za8imDnJzpHbzQ2DgD4CNR3uNb4cVCqqhhuzmG9b8znkNo9uZnr" />
      </>
    ),
    source: "docs/EVIDENCE.md",
  },
  {
    key: "tests",
    term: "The suite, and what it is for",
    body: (
      <>
        <span className="figure">13</span> program tests, written to run against a local validator
        with <code>pnpm test:rules</code>: one or more for every rule and stop, including “pays an
        intent at most once” and “an approval waives a budget, never a stop”. Each refusal is asserted
        by its error name, so a test cannot pass by failing for the wrong reason.
      </>
    ),
    source: "tests/rein.ts",
  },
];

export function SecurityEvidence() {
  return (
    <Section
      id="verified"
      eyebrow="Checked, not asserted"
      title="What has been run against the chain."
      lede="Each of these was run on Solana devnet on 8 November 2026 by the evidence script and written down at the time. Open any of them on the explorer and read the program’s own log rather than this summary of it."
      tone="sunken"
    >
      <dl className={styles.findings}>
        {FINDINGS.map((finding) => (
          <div className={styles.finding} key={finding.key}>
            <dt className={styles.findingTerm}>
              <IconCheck />
              {finding.term}
            </dt>
            <dd className={styles.findingBody}>
              <span>{finding.body}</span>
              <code className={styles.path}>{finding.source}</code>
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
   Band 3: what is not true yet.
   ------------------------------------------------------------------------- */

type Limit = {
  key: string;
  name: string;
  body: ReactNode;
};

const LIMITS: readonly Limit[] = [
  {
    key: "audit",
    name: "Nobody outside this project has reviewed it",
    body: (
      <>
        There has been no third-party security review and none is booked. The tests were written
        beside the program by the people who wrote the program, which is the arrangement least likely
        to find the thing the author did not think of. Read it as unaudited work, because that is
        what it is.
      </>
    ),
  },
  {
    key: "devnet",
    name: "Devnet only, and the money is not money",
    body: (
      <>
        Everything runs on Solana devnet. The payments are real transactions against the deployed
        program, and the balance behind them is a test USDC mint this project controls (mint
        authority <Address>{MINT_AUTHORITY}</Address>), not Circle USDC. Nothing here should ever
        receive real funds. Mainnet would use Circle USDC.
      </>
    ),
  },
  {
    key: "upgrade",
    name: "One CLI wallet can replace the program",
    body: (
      <>
        The program’s upgrade authority is the deployer’s own wallet,{" "}
        <Address>{UPGRADE_AUTHORITY}</Address>. Whoever holds that key can deploy different code to
        the same address. Before real money it would move to a multisig or be removed. That has not
        been done.
      </>
    ),
  },
  {
    key: "demo-owner",
    name: "The demo team’s owner key is on the server",
    body: (
      <>
        So that anybody can press Approve on the public demo without a wallet, the demo team’s owner
        key and its agent’s key are held by the server. They own the demo team and nothing else. A
        team you create is owned by your own embedded wallet, and only that wallet can approve for it.
      </>
    ),
  },
  {
    key: "records",
    name: "Payment records are never closed",
    body: (
      <>
        Each payment record costs about <span className="figure">0.003</span> SOL of rent, paid by the
        sponsor, and no instruction closes a record, so that rent is never reclaimed.
      </>
    ),
  },
  {
    key: "rollover",
    name: "Period rollover has no test",
    body: (
      <>
        <code>roll</code> moves a spender’s period forward on schedule from the grant and resets what
        it has spent. The shortest period is <span className="figure">60</span> seconds, and no test
        waits for one to end, so that path is unexercised.
      </>
    ),
  },
  {
    key: "rate",
    name: "The sponsor’s rate limit lives in memory",
    body: (
      <>
        A signed-in caller is limited per Privy user and an anonymous one per IP, and a session token
        that fails verification is refused. The windows are kept in each server instance’s memory, not
        shared, so a determined visitor could still spend the sponsor’s devnet SOL.
      </>
    ),
  },
];

export function SecurityLimits() {
  return (
    <Section
      id="not-yet"
      eyebrow="Stated plainly"
      title="What is not true yet."
      lede="This is the half that usually gets left off. It is here at the same size as everything above it, because a page about what stops a payment is not worth reading if it is quiet about what does not."
    >
      <ul className={styles.limits} role="list">
        {LIMITS.map((limit) => (
          <li className={styles.limit} key={limit.key}>
            <IconNotice className={styles.limitMark} size="card" />
            <h3 className={styles.limitName}>{limit.name}</h3>
            <p className={styles.limitBody}>{limit.body}</p>
          </li>
        ))}
      </ul>

      <p className={styles.closing}>
        If a claim on this page is not backed by a line of the program you can open or a transaction
        you can look up, it should not be here. Report a security issue to the Veltri Labs team where
        you found this project.
      </p>
    </Section>
  );
}
