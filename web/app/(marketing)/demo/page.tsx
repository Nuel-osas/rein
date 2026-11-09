import type {Metadata} from "next";
import "@/components/app/theme.css";
import {ActionLink} from "@/components/marketing/ActionLink";
import {DemoLive} from "@/components/marketing/DemoLive";
import {PageIntro} from "@/components/marketing/PageIntro";
import {DEMO_TEAM} from "@/lib/chain";

export const metadata: Metadata = {
  title: "Live demo | Rein",
  description: "A seeded Rein team on Solana devnet. Watch an AI agent's overspend wait on chain, then approve it without a wallet and see it settle in under a second.",
};

export const dynamic = "force-dynamic";

/** The page for somebody who will not connect a wallet: the real team, read from chain, with server-signed owner actions. */
export default function DemoPage() {
  return (
    <>
      <PageIntro
        eyebrow="Live on Solana devnet"
        title={
          <>
            An agent overspends.
            <br />
            <span>The money waits for you.</span>
          </>
        }
        lede="This is a real team on chain: Acme Research, with an AI agent and a person. Its agent buys real AI runs on 0G: chat, image and voice inside its policy. When it asks for something its policy does not allow, such as Claude, which is not on its list, the program files the payment and holds the USDC. Press Approve and it settles in one transaction."
      >
        {DEMO_TEAM ? (
          <ActionLink href={`/app/${DEMO_TEAM}`}>
            Open the full team view <span aria-hidden="true">↗</span>
          </ActionLink>
        ) : null}
      </PageIntro>
      <DemoLive />
    </>
  );
}
