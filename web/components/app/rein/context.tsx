"use client";

// The team every screen under /app/<team> reads. One shared poller per team (lib/team.ts), so the
// sidebar badge, the page and the agent panel never disagree.

import {createContext, useContext, type ReactNode} from "react";
import {DEMO_TEAM} from "@/lib/chain";
import {useNow, useTeam} from "@/lib/team";
import {useWallet} from "@/lib/wallet";

const Ctx = createContext<string | null>(null);

export function TeamScope({team, children}: {team: string; children: ReactNode}) {
  return <Ctx.Provider value={team}>{children}</Ctx.Provider>;
}

export function useTeamPage() {
  const team = useContext(Ctx);
  if (!team) throw new Error("useTeamPage outside TeamScope");
  return useTeamView(team);
}

/**
 * The same view of any team by address, with no TeamScope needed, for components a route outside
 * /app/<team> renders (the signed-in user's own /compute, for one). Shares the one poller per team.
 */
export function useTeamView(team: string) {
  const t = useTeam(team, 1500);
  const {address} = useWallet();
  const now = useNow();
  const isOwner = !!address && t.team?.owner === address;
  const me = (address && t.spenders?.find((s) => s.authority === address && s.status !== "revoked")) || null;
  return {...t, address: team, base: `/app/${team}`, wallet: address, isOwner, me, demo: team === DEMO_TEAM, now};
}

export type TeamPage = ReturnType<typeof useTeamPage>;
