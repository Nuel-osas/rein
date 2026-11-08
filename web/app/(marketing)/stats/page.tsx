import type {Metadata} from "next";
import {Suspense} from "react";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {StatsBody, StatsBodyFallback, StatsFrame} from "@/components/stats/StatsPage";
import {networkStats} from "@/lib/stats/read-stats";

/**
 * Rein, in numbers: public, no sign-in, every figure read from the program's accounts.
 *
 * Rendered per request, never at build time: a build must not reach the chain, and a figure
 * frozen into the build would be a figure from the day it was built. The reads are cached a
 * minute per server instance (`lib/stats/read-stats.ts`), so a busy page is one read a minute.
 *
 * The masthead streams first; the figures follow inside Suspense and arrive as server HTML.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stats | Rein",
  description: `Live figures from the Rein program on ${NETWORK_NAME}: teams, people and agents with a spending policy, payments settled, test USDC paid, and the payments the rules held for an owner.`,
};

/** The figures and the moment they are rendered against. Outside the component, so render stays pure. */
async function readForPage() {
  const stats = await networkStats();
  return {stats, now: Date.now()};
}

async function LiveStats() {
  const {stats, now} = await readForPage();
  return <StatsBody stats={stats} now={now} />;
}

export default function StatsRoute() {
  return (
    <StatsFrame>
      <Suspense fallback={<StatsBodyFallback />}>
        <LiveStats />
      </Suspense>
    </StatsFrame>
  );
}
