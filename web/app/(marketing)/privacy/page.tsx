import type {Metadata} from "next";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {LegalDocument, type LegalSection} from "@/components/marketing/LegalDocument";
import {PageIntro} from "@/components/marketing/PageIntro";

export const metadata: Metadata = {
  title: "Privacy | Rein",
  description: "What Rein keeps, what it sends to the services it relies on, and what is public on Solana.",
};

/* Every statement here is checked against the code as of the date below: sign-in and the wallet
   (lib/wallet.tsx), the server's session check (lib/server/privy.ts), the in-memory rate limits
   (lib/server/limit.ts), the fee sponsor (app/api/sponsor), the demo agent (app/api/agent and the
   agent package, agent/src/groq.ts and agent/src/agent.ts), the faucet and demo routes
   (app/api/faucet, app/api/demo), and the absence of a database, analytics or cookies of Rein's
   own. Change the code, change this page. */
const SECTIONS: LegalSection[] = [
  {
    id: "short",
    heading: "The short version",
    body: (
      <>
        <p>
          Rein runs on {NETWORK_NAME} with test USDC, which is not real money. You sign in with
          Google, and Rein gives you a Solana wallet. Rein has no database: it keeps nothing about
          you on its own servers, it does not sell anything, and there are no ads or analytics
          trackers on this site.
        </p>
        <p>
          <strong>What a team does is public.</strong> Team names, spender names, policies, every
          payment, its amount, the service it paid and its note are written to the chain, can be
          read by anyone and cannot be deleted.
        </p>
      </>
    ),
  },
  {
    id: "sign-in",
    heading: "Signing in",
    body: (
      <>
        <p>
          Sign-in is Google only, handled for Rein by Privy. When you continue with Google, Privy
          verifies you and creates an embedded Solana wallet for you. Your browser receives your
          wallet address and the name and email address on your Google account, and shows them to
          you. Rein&rsquo;s servers do not receive your name or email address, and Rein never writes
          them to the chain.
        </p>
        <p>
          Privy keeps you signed in with its own session storage in your browser. When you act, your
          browser sends Privy&rsquo;s access token with the transaction, and Rein&rsquo;s server
          checks it with Privy to learn your Privy user id. That id is used only to rate-limit your
          requests and is not stored.
        </p>
      </>
    ),
  },
  {
    id: "stored",
    heading: "What Rein stores",
    body: (
      <ul>
        <li>
          <strong>No account records.</strong> Rein has no database. Your team, its spenders and its
          payments live in accounts on the chain, owned by Rein&rsquo;s program, not in a store we
          keep.
        </li>
        <li>
          <strong>Short-lived rate limits.</strong> To stop one visitor draining the fee sponsor,
          each server instance counts requests in memory, by Privy user id when you are signed in
          and by IP address otherwise. A count lasts a minute to ten minutes, is never written to
          disk, and is gone when the instance restarts.
        </li>
        <li>
          <strong>No cookies of our own.</strong> Rein sets none. The only thing kept in your
          browser is Privy&rsquo;s sign-in session.
        </li>
      </ul>
    ),
  },
  {
    id: "public",
    heading: "What is public on the chain",
    body: (
      <p>
        Your wallet address, the name you give your team, the names and policies an owner gives
        each spender, every payment, its amount, the service it paid, its reasons for waiting and
        its note are recorded on {NETWORK_NAME}. That record is public and permanent. Please do not
        put personal information in team names, spender names or payment notes.
      </p>
    ),
  },
  {
    id: "owners",
    heading: "What team owners see",
    body: (
      <p>
        If you are a spender on a team, its owner sees your wallet address, the name they gave you,
        your policy, what you have spent and every payment you filed. So does anybody else who
        opens the team&rsquo;s public view: it reads the same chain.
      </p>
    ),
  },
  {
    id: "services",
    heading: "Services we rely on",
    body: (
      <ul>
        <li>
          <strong>Privy</strong> for Google sign-in and the embedded Solana wallet it creates for
          you. Your Google account details are handled by Privy and Google under their own policies.
        </li>
        <li>
          <strong>Groq</strong> hosts the model behind the demo agent (openai/gpt-oss-120b). When you
          run the agent, the task you choose or type (up to 500 characters), the demo team&rsquo;s
          name, and the results of the agent&rsquo;s tools (the service list and its budget) are sent
          to Groq. Rein does not store what you typed. Only the demo team runs the agent.
        </li>
        <li>
          <strong>Vercel</strong> hosts the site and its server routes; like any host it keeps
          request logs, which include IP addresses.
        </li>
        <li>
          <strong>Solana devnet RPC endpoints</strong> are used to read the chain and to send
          transactions, so they see the transactions you sign and your IP address.
        </li>
      </ul>
    ),
  },
  {
    id: "choices",
    heading: "Your choices",
    body: (
      <p>
        You can stop using Rein at any time by signing out. Rein holds nothing about you to remove
        beyond the short-lived counts above. Your Privy account is managed with Privy. We cannot
        remove anything that is already on the chain. Questions go to Veltri Labs, through the MLH
        Solana Hackathon submission where you found Rein.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <PageIntro
        eyebrow="Privacy"
        title={
          <>
            What we keep. <span>And what the chain keeps.</span>
          </>
        }
        lede={`Rein is a hackathon build on ${NETWORK_NAME}. This page says plainly what it stores, what it sends to the services it relies on, and what is public by design.`}
      />
      <LegalDocument updated="2026-11-08" sections={SECTIONS} />
    </>
  );
}
