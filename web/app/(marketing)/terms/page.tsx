import type {Metadata} from "next";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {LegalDocument, type LegalSection} from "@/components/marketing/LegalDocument";
import {PageIntro} from "@/components/marketing/PageIntro";

export const metadata: Metadata = {
  title: "Terms | Rein",
  description: `The terms for using Rein on ${NETWORK_NAME}: test USDC only, not audited, a hackathon build provided as is.`,
};

/* Checked against the code as of the date below: the test USDC mint and its authority
   (docs/CONSTANTS.md), the faucet and the public demo (app/api/faucet, app/api/demo), the fee
   sponsor (app/api/sponsor), the demo agent (app/api/agent, agent/), and the program's rules
   (programs/rein/src/lib.rs). Change the code, change this page. */
const SECTIONS: LegalSection[] = [
  {
    id: "testnet",
    heading: "Test USDC only",
    body: (
      <>
        <p>
          Rein runs on {NETWORK_NAME}. Every balance and payment uses a test USDC token that Veltri
          Labs mints for the demo. It is not Circle&rsquo;s USDC, it has no value, and it cannot be
          exchanged for real money.
        </p>
        <p>
          <strong>Never send real funds</strong>, or tokens from Solana mainnet or any other network,
          to an address you see in Rein. They will not arrive where you expect and cannot be
          returned.
        </p>
      </>
    ),
  },
  {
    id: "as-is",
    heading: "A hackathon build, provided as is",
    body: (
      <p>
        Rein is built for the MLH Solana Hackathon, November 2026. Its program has not been
        independently audited, and its upgrade key is held by the team that deployed it, so the
        rules can change. It is provided as is, without warranties of any kind. It may change, be
        reset, run slowly or stop without notice, and test balances, teams, policies or history may
        be lost when it does.
      </p>
    ),
  },
  {
    id: "faucet",
    heading: "Test USDC, the sponsor and the demo",
    body: (
      <ul>
        <li>
          The faucet adds up to 100 test USDC to a team at a time, and only a few times in ten
          minutes from one address.
        </li>
        <li>
          A sponsor pays the network fees and the rent of each payment record, so you never need
          SOL. It co-signs only Rein&rsquo;s own instructions, within rate limits, and may refuse or
          stop at any time.
        </li>
        <li>
          The demo team is shared. Anybody can approve or decline its waiting payments, run its
          agent, or top its vault back up, so what you see there may change while you look.
        </li>
      </ul>
    ),
  },
  {
    id: "payments",
    heading: "Payments cannot be undone",
    body: (
      <p>
        A payment is a transaction on the chain. Once it settles it cannot be reversed. The services
        in the registry are demonstrations: they are not real businesses, their payee accounts are
        held by Veltri Labs, and test USDC sent to them is not returned.
      </p>
    ),
  },
  {
    id: "agents",
    heading: "Agents and the rules",
    body: (
      <p>
        An AI agent proposes payments; only the program authorizes them. The agent can be wrong, can
        misread a task, and can be told things in a task that it should not follow. The rules an
        owner sets are what hold it, so set them with that in mind. On this site the agent runs only
        for the demo team.
      </p>
    ),
  },
  {
    id: "use",
    heading: "Using Rein fairly",
    body: (
      <ul>
        <li>Do not automate sign-ups, faucet requests or sponsored transactions, and do not try to drain the sponsor, overload or attack the service.</li>
        <li>Do not put personal information, or anything you would not publish, in team names, spender names or payment notes. They are public and permanent.</li>
        <li>Do not use Rein to break the law or to harm anyone.</li>
      </ul>
    ),
  },
  {
    id: "advice",
    heading: "Not a bank, and not advice",
    body: (
      <p>
        Rein is not a bank or a money transmitter and does not hold real money for anyone. A
        team&rsquo;s vault is a token account owned by the program, not by Veltri Labs. Nothing in
        Rein is financial, legal or tax advice.
      </p>
    ),
  },
  {
    id: "ownership",
    heading: "Ownership",
    body: (
      <p>
        Rein, its name and logo belong to Veltri Labs. Its interface is adapted, with its
        author&rsquo;s agreement, from an earlier product by another team. Using the service does
        not give you any rights in them.
      </p>
    ),
  },
  {
    id: "liability",
    heading: "Liability",
    body: (
      <p>
        To the fullest extent the law allows, Veltri Labs is not liable for any loss arising from
        your use of Rein. Because it only handles test USDC, there is no real money at stake.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes and contact",
    body: (
      <p>
        We may update these terms; the date above changes when we do. Questions go to Veltri Labs,
        through the MLH Solana Hackathon submission where you found Rein.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Terms"
        title={
          <>
            Test USDC only. <span>Provided as is.</span>
          </>
        }
        lede={`The short terms for using Rein while it runs on ${NETWORK_NAME}.`}
      />
      <LegalDocument updated="2026-11-08" sections={SECTIONS} />
    </>
  );
}
