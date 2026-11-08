import type {Metadata} from "next";
import {PageIntro} from "@/components/marketing/PageIntro";
import {Section} from "@/components/marketing/Section";
import {
  DEMO_TEAM_ADDRESS,
  Fact,
  Facts,
  HowToCheck,
  IntroNote,
  Ledger,
  LedgerRow,
  MINT_ADDRESS,
  OpenItem,
  OpenList,
  PROGRAM_ADDRESS,
  REGISTRY_ADDRESS,
  SPONSOR_ADDRESS,
  Totals,
  txEvidence,
} from "@/components/marketing/Provenance";

/* ===========================================================================
   /build: what was inherited, what is new, and what is verified on chain.

   The hackathon asks that what you show was built during the event. Rein
   carries rules from an earlier build and screens from another team's app, and
   the honest way to handle that is to say so in public rather than to hope
   nobody asks.

   THE RULE THIS FILE IS WRITTEN UNDER: every claim on this page points at a
   file, a test count, or a transaction on Solana devnet. A provenance page
   nobody can check is worse than no provenance page.

   Where the facts come from:
     docs/PROVENANCE.md   what was carried over and what was written here
     docs/CONSTANTS.md    every address, the deploy tx and the sponsor top-up
     docs/EVIDENCE.md     the five evidence transactions (2026-11-08 03:40 UTC)
     README.md            "Why it needs Solana", "Repository", "Still open"
     git log              the first commit, 2026-11-08 (afd778c)

   Counts, measured on 8 November 2026 rather than estimated:
     programs/rein/src/lib.rs   788 lines, 15 instructions
     tests/rein.ts              13 program tests (need a seeded validator; not re-run for this page)
     agent/                     16 source files, 1,568 lines; `pnpm test`: 42 passed, 0 failed
     scripts/                   seed.ts 186 lines, evidence.ts 147 lines
     web/lib/ (with server/)    1,273 lines; web/app/api/ 4 routes, 349 lines

   If any of these changes, change it here in the same commit. A stale count is
   a false claim, and it is the kind nobody notices because it used to be true.
   =========================================================================== */

export const metadata: Metadata = {
  title: "Build | Rein",
  description:
    "A line by line account of what Rein carried in from earlier work, what was written for Solana during the hackathon, and what has been verified on Solana devnet.",
};

/** A no-break space after the day, so a narrow column never strands "8" at the end of a line. */
const RUN_DATE = "8\u00a0November 2026";

/** The seven transactions this page cites, from docs/CONSTANTS.md and docs/EVIDENCE.md. */
const TX = {
  deploy: "2dGZ8Pw9sq9mVJ1q5dJtYtwqWZxWF4cHqv76khz8Cc2VoyxzxvMhsTjA21vo58ax4Ud82hJQsS5nAgQiD1h9o3Ju",
  sponsorTopUp: "61A8FczD5J4cvrgaEDzzogsimF1PeSEwttfxkjXAttjMV3UKe6jwx9QSDuoKew3x6hYZUxQB4s4KKEapKhuTsftz",
  paid: "4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6",
  filed: "w1VEqKk3icLuuBUgreeyafsHFQyyiXy9MuJVHETjr6edEnLSkWNjCchvfbJs3MBtm6CJUPgVTprC1ZZNAKoBDbo",
  settled: "3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa",
  unknownService: "5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA",
  wrongPayee: "4uZN8NEASQZjW1HyqTPHxaZQ7QfQjL5WeHC94Za8imDnJzpHbzQ2DgD4CNR3uNb4cVCqqhhuzmG9b8znkNo9uZnr",
} as const;

/** The vault of the demo team: the ATA of (test USDC mint, team PDA), from docs/CONSTANTS.md. */
const VAULT_ADDRESS = "FdPTBxs2FcN4L5bHHUuXpDi2x6aYcnn5q7bpDisnaJkK";

export default function BuildPage() {
  return (
    <>
      <PageIntro
        eyebrow="Provenance"
        title={
          <>
            What we built, <span>and what we brought.</span>
          </>
        }
        lede="The hackathon asks that what you show was built during the event. This is the detailed answer, including the parts that are not finished."
      >
        <IntroNote>
          Every claim below names a file, a test count, or a transaction on
          Solana devnet. Counts were measured on {RUN_DATE}.
        </IntroNote>
      </PageIntro>

      <Section
        id="new"
        eyebrow="Written during the hackathon"
        title="The Solana program had nothing to inherit."
        lede="Rein’s program is new Rust written for Solana, not a translation of the NEAR contracts it follows. The repository’s first commit is dated 8 November 2026, and every row below was written after it."
      >
        <Ledger>
          <LedgerRow
            name="The Rein program"
            evidence={["programs/rein/src/lib.rs", "788 lines", "15 instructions", "13 program tests"]}
          >
            Teams, spenders, the service registry, and the payment path: pay,
            approve, decline, cancel. A team&rsquo;s vault is a token account
            owned by the team&rsquo;s PDA, so anyone can top it up and only the
            program can move money out. Each spender carries its own policy: an
            allowance per period, a cap on each payment, a limit on the number
            of payments, an expiry, and up to eight services it may pay.
          </LedgerRow>

          <LedgerRow
            name="Over a limit, the payment waits"
            evidence={["programs/rein/src/lib.rs", "pay, over_limits, approve", "24 hour pending window"]}
          >
            Over the cap, the allowance or the count, or outside the
            spender&rsquo;s services, <code>pay</code> does not revert. It files
            a Pending payment in the same transaction with every reason
            recorded, and the owner&rsquo;s approval settles it in one more. An
            approval waives a budget, never a stop: a spender revoked, re-granted
            or expired, a suspended service or a moved payee at approval time
            refuses it for good.
          </LedgerRow>

          <LedgerRow
            name="The service registry"
            evidence={["programs/rein/src/lib.rs", "register_service", "WrongPayee", "5 services on devnet"]}
          >
            <code>pay</code> takes a service, never an address. The payee token
            account must equal the one the registry holds for that service, or
            the program refuses with WrongPayee. A service nobody registered has
            no account, so a made-up name fails before the instruction runs.
            That is what makes a prompt-injected agent unable to name a payee.
          </LedgerRow>

          <LedgerRow
            name="Payments seeded by intent"
            evidence={["programs/rein/src/lib.rs", "seeds: payment, spender, intent"]}
          >
            Each payment record lives at an address derived from the spender and
            the intent the agent chose. A retried intent finds its address
            already taken, so the same purchase is paid or filed at most once,
            however many times an agent tries again.
          </LedgerRow>

          <LedgerRow
            name="The buying agent"
            evidence={["agent/src/", "16 files, 1,568 lines", "42 tests, all passing"]}
          >
            A Groq-hosted model, <code>openai/gpt-oss-120b</code>, with three
            tools: <code>list_services</code>, <code>check_budget</code> and{" "}
            <code>pay</code>. None of them takes an address. The agent holds a
            keypair with no money and no SOL, parses amounts in integer base
            units the way the program does, and reports only what the chain
            confirmed.
          </LedgerRow>

          <LedgerRow
            name="The sponsor"
            evidence={["web/app/api/sponsor/route.ts", "135 lines", "web/lib/server/"]}
          >
            Co-signs as the fee payer, so people and agents never hold SOL. It
            refuses any transaction with an instruction that is not one of
            Rein&rsquo;s own (or a compute-budget setting), and its key may sit
            only as the fee payer and as the payer of a new record. A request
            with a verified Privy session is limited per user; one without, per
            IP address.
          </LedgerRow>

          <LedgerRow
            name="The web app’s data layer"
            evidence={["web/lib/", "1,273 lines", "web/app/api/", "4 routes, 349 lines"]}
          >
            Reads teams, spenders and payments straight from the program, signs
            in with Google through Privy and an embedded Solana wallet, and runs
            the public demo&rsquo;s approvals and the test USDC faucet. A failed
            read is unknown, never zero, and money stays in integer base units
            until the moment it is displayed.
          </LedgerRow>

          <LedgerRow
            name="Seed and evidence scripts"
            evidence={["scripts/seed.ts", "186 lines", "scripts/evidence.ts", "147 lines"]}
          >
            <code>pnpm seed</code> sets up any cluster: a test USDC mint, the
            service registry and the Acme Research demo team.{" "}
            <code>pnpm evidence</code> proves the claims on chain with a
            throwaway team and prints an explorer link for each, which is where
            the transactions further down this page come from.
          </LedgerRow>
        </Ledger>

        <Totals>
          13 program tests in <code>tests/rein.ts</code>, run against a seeded
          local validator and not re-run for this page, and 42 agent tests
          across 7 files, all passing on {RUN_DATE}. Each rule the program
          enforces has a test that it holds and a test that the invalid case is
          refused.
        </Totals>
      </Section>

      <Section
        id="inherited"
        eyebrow="Carried in from earlier work"
        title="The rules came with us. The code did not."
        lede="Rein is the Solana version of Bursar, our NEAR build of the same rules. Here is what that gives Rein, stated as it stands today."
        tone="sunken"
      >
        <Ledger>
          <LedgerRow
            name="The product idea and its rules"
            evidence={["docs/PROVENANCE.md", "README.md"]}
          >
            Every spender, person or agent, pays under a policy the program
            enforces. <code>pay</code> takes a service, never an address. Over a
            limit, the owner decides. An approval waives a budget, never a stop.
            A failed read is unknown, never zero. These crossed over from Bursar
            as rules, and were written again here in Rust, against a different
            chain.
          </LedgerRow>

          <LedgerRow
            name="The screens and the visual design"
            evidence={["docs/PROVENANCE.md", "web/components/", "commit d746ac1"]}
          >
            The web app&rsquo;s screens, components and visual design were
            adapted from 71Labs&rsquo; web app, with its author&rsquo;s
            agreement. Names, logos and copy are Rein&rsquo;s, and everything
            behind the screens (the wallet, the chain reads, the transactions,
            the server routes) is new Solana code.
          </LedgerRow>

          <LedgerRow
            name="The workspace template"
            evidence={["commit afd778c", "Anchor 0.31"]}
          >
            The repository started from Anchor&rsquo;s 0.31 workspace template.
            That is its first commit, and nothing of the template&rsquo;s example
            program is left in <code>programs/rein</code>.
          </LedgerRow>

          <LedgerRow
            name="Third party code"
            evidence={["Anchor 0.31.1", "@solana/web3.js 1.98.4", "@solana/spl-token 0.4.14", "@privy-io/react-auth 3.42.0"]}
          >
            Used, not written. Anchor and the Solana web3.js and SPL Token
            libraries under their own licenses, and Privy for Google sign-in and
            the embedded wallet. Each is listed in its <code>package.json</code>{" "}
            or <code>Cargo.toml</code>.
          </LedgerRow>
        </Ledger>
      </Section>

      <Section
        id="verified"
        eyebrow="Verified on chain"
        title="Checked against Solana devnet, not only in tests."
        lede="Every address here is written down in docs/CONSTANTS.md with how it was verified, and every transaction opens on Solana Explorer."
      >
        <Facts>
          <Fact label="Rein program" address={PROGRAM_ADDRESS}>
            Deployed to devnet on 8 November 2026. <code>solana program show</code>{" "}
            reports 360,400 bytes, the size of the build from{" "}
            <code>programs/rein</code> at commit 7c66d98. The upgrade authority is
            still the deployer&rsquo;s CLI wallet.
          </Fact>
          <Fact label="Service registry" address={REGISTRY_ADDRESS}>
            The <code>[&quot;config&quot;]</code> account, written by{" "}
            <code>init_config</code> during <code>pnpm seed</code>. It names the
            test USDC mint, and five services are registered under it: web-search,
            llm-inference, market-data, gpu-hour and premium-dataset.
          </Fact>
          <Fact label="Demo team" address={DEMO_TEAM_ADDRESS}>
            Acme Research, at the PDA of its owner. Anyone can open it without a
            wallet. Its research agent may pay up to 5 USDC a payment, 20 USDC
            and 10 payments an hour.
          </Fact>
          <Fact label="Demo vault" address={VAULT_ADDRESS}>
            The team&rsquo;s test USDC account, owned by the team&rsquo;s PDA.
            Funded with 500 test USDC by <code>pnpm seed</code>.
          </Fact>
          <Fact label="Test USDC mint" address={MINT_ADDRESS}>
            Six decimals, and a mint Rein controls so the demo can top itself up.
            Not Circle USDC, and not real money.
          </Fact>
          <Fact label="Sponsor" address={SPONSOR_ADDRESS}>
            Pays every fee and the rent of each payment record, about 0.003 SOL
            a record. Topped up to 0.78 SOL on 8 November 2026.
          </Fact>
        </Facts>

        <Ledger>
          <LedgerRow
            name="The program is deployed"
            evidence={[txEvidence("Deploy 2dGZ8Pw9…", TX.deploy), "360,400 bytes"]}
          >
            The deploy transaction for the program above. Its id equals the
            address in <code>idl/rein.json</code> and the{" "}
            <code>declare_id!</code> in <code>lib.rs</code>.
          </LedgerRow>

          <LedgerRow
            name="The sponsor is funded"
            evidence={[txEvidence("Top-up 61A8Fcz…", TX.sponsorTopUp), "0.78 SOL"]}
          >
            The sponsor topped up so it can pay every fee. No spender in the
            evidence below holds any SOL.
          </LedgerRow>

          <LedgerRow
            name="An agent with 0 SOL pays inside its policy"
            evidence={[txEvidence("Paid 4Ygd81Xk…", TX.paid), "0.40 USDC", "web-search"]}
          >
            A throwaway agent with no SOL pays 0.40 USDC for web-search. It is
            inside its policy, so the payment settles in the same transaction,
            with the sponsor as fee payer.
          </LedgerRow>

          <LedgerRow
            name="Over its cap, a payment is filed, not refused"
            evidence={[txEvidence("Filed w1VEqKk3…", TX.filed), "9 USDC", "over_cap"]}
          >
            The same agent asks for 9 USDC of GPU time, over its 5 USDC cap. The
            program files it as Pending for the owner, with the reason recorded,
            and moves nothing.
          </LedgerRow>

          <LedgerRow
            name="The owner approves, and it settles"
            evidence={[txEvidence("Settled 3PTN2Q5C…", TX.settled), "9 USDC"]}
          >
            The owner approves the pending payment and the 9 USDC settles in the
            same transaction as the approval.
          </LedgerRow>

          <LedgerRow
            name="A made-up service is refused on chain"
            evidence={[txEvidence("Refused 5veVH6qr…", TX.unknownService), "AccountNotInitialized"]}
          >
            A prompt-injected agent tries a service called
            &ldquo;wallet-9xqe&rdquo;. Nobody registered it, so it has no account
            and the transaction fails before <code>pay</code> runs.
          </LedgerRow>

          <LedgerRow
            name="A swapped payee is refused on chain"
            evidence={[txEvidence("Refused 4uZN8NEA…", TX.wrongPayee), "WrongPayee"]}
          >
            The agent passes an attacker&rsquo;s token account as the web-search
            payee. It does not match the registry, so the program refuses it.
          </LedgerRow>
        </Ledger>

        <Totals>
          Seven transactions on Solana devnet: one deploy, one sponsor top-up,
          and five from the evidence run of {RUN_DATE} at 03:40 UTC. Of those
          five, one paid, one filed for the owner, one settled on approval, and
          two refused.
        </Totals>
      </Section>

      <Section
        id="open"
        eyebrow="Not done"
        title="What this page will not claim."
        lede="A provenance page that lists only the wins is not evidence of anything."
        tone="sunken"
      >
        <OpenList>
          <OpenItem
            title="Devnet only, with test USDC"
            evidence={["docs/CONSTANTS.md", "upgrade authority: a CLI wallet"]}
          >
            Nothing here is real money. Mainnet would use Circle USDC and hand the
            program&rsquo;s upgrade key to a multisig, or remove it, before any
            money moves. Neither is done.
          </OpenItem>

          <OpenItem
            title="The demo’s owner key lives on a server"
            evidence={["web/app/api/demo/route.ts", "docs/CONSTANTS.md"]}
          >
            The public demo&rsquo;s approvals are signed by the demo owner&rsquo;s
            key, held in the deployment&rsquo;s environment, so a visitor can
            approve without a wallet. The route checks first that the payment
            exists, belongs to the demo team and is Pending. A team somebody
            creates does not work this way: its owner signs every owner action
            with their own wallet.
          </OpenItem>

          <OpenItem
            title="The five services are stand-ins, not merchants"
            evidence={["scripts/seed.ts", "deploy/devnet.json"]}
          >
            Each payee is a fresh keypair made by <code>pnpm seed</code>, so five
            services are five recipients and a payment can tell them apart. No
            business is behind them. A payment proves the right recipient was
            resolved and paid, not that anything was delivered.
          </OpenItem>

          <OpenItem
            title="Payment records are never closed"
            evidence={["programs/rein/src/lib.rs", "about 0.003 SOL a record"]}
          >
            Every payment leaves a record on chain, and nothing closes it, so the
            sponsor&rsquo;s rent is not reclaimed.
          </OpenItem>

          <OpenItem
            title="Period rollover has no test"
            evidence={["tests/rein.ts", "shortest period: 60 seconds"]}
          >
            The allowance resets when a period ends, and no test waits for that to
            happen.
          </OpenItem>

          <OpenItem
            title="The sponsor’s rate limit is in memory"
            evidence={["web/lib/server/limit.ts"]}
          >
            It limits requests per Privy user or per IP address, on each server
            instance. A determined visitor could still spend its devnet SOL.
          </OpenItem>

          <OpenItem
            title="Nothing here has been independently audited"
            evidence={["13 program tests", "0 external reviews"]}
          >
            The program carries a test for each rule and for the case each rule is
            meant to refuse. That is not the same thing as review by somebody with
            no stake in the answer.
          </OpenItem>
        </OpenList>

        <HowToCheck>
          <h3>Checking this yourself</h3>
          <ul>
            <li>
              Run <code>pnpm test:rules</code> at the repository root against a
              local validator seeded with <code>pnpm seed</code> for the program
              tests, and <code>pnpm test</code> in <code>agent/</code> for the
              agent&rsquo;s.
            </li>
            <li>
              <code>REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence</code>{" "}
              re-runs the on-chain claims with a throwaway team and prints a link
              for each.
            </li>
            <li>
              <code>docs/CONSTANTS.md</code> is the single source for every
              address, with how each one was verified.{" "}
              <code>docs/PROVENANCE.md</code> is the in-repository version of this
              page, and <code>docs/EVIDENCE.md</code> holds the last evidence run.
            </li>
            <li>
              The commit history covers the whole build and carries the reasoning
              for each decision, including the ones that were later reversed.
            </li>
          </ul>
        </HowToCheck>
      </Section>
    </>
  );
}
