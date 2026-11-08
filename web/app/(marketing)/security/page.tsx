import type {Metadata} from "next";

import {PageIntro} from "@/components/marketing/PageIntro";
import {RefusalFlow} from "@/components/marketing/RefusalFlow";
import {SecurityEvidence, SecurityLayers, SecurityLimits} from "@/components/marketing/SecuritySections";

/**
 * The page somebody opens to answer two questions: what actually stops a bad
 * payment, and what have you not done.
 *
 * The shell, the tokens, the header and the footer come from
 * `(marketing)/layout.tsx`. This file is only what is on this page.
 *
 * THE ORDER IS THE ARGUMENT:
 *
 *   1  the masthead names the page and the standard it holds itself to
 *   2  the six checks, each with the place in the repository that implements it
 *   3  the same checks in place on the path a payment takes, end to end
 *   4  what has actually been run on devnet, with the transactions
 *   5  what is not true yet
 *
 * The diagram comes AFTER the checks rather than opening the page, because it
 * is a picture of five stages and only means anything once a reader knows which
 * of them can refuse. The unfinished half comes last rather than being buried
 * in the middle, which is the placement that decides whether the page is a
 * disclosure or a hedge.
 *
 * On the light marketing ground like /demo and the legal pages, so the
 * header, the PageIntro and the footer's fade read the same on every page.
 */

export const metadata: Metadata = {
  title: "Security | Rein",
  description:
    "What stops a payment in Rein: the on-chain service registry, the spender's policy, approvals that never override a stop, intent-seeded payment records and the fee sponsor's checks. With the devnet transactions, and what has not been done yet.",
};

export default function SecurityPage() {
  return (
    <>
      <PageIntro
        eyebrow="Security"
        title={
          <>
            What stops a payment. <span>And what we have not done.</span>
          </>
        }
        lede="The agent proposes a payment; only the program authorizes it. Everything below names the line of code or the devnet transaction behind it, so you can go and disagree with us."
      />

      <SecurityLayers />
      <RefusalFlow />
      <SecurityEvidence />
      <SecurityLimits />
    </>
  );
}
