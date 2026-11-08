"use client";

// The team every screen under /app/<team> reads. One shared poller per team (lib/team.ts), so the
// sidebar badge, the page and the agent panel never disagree. The same screens also render at the
// top-level routes (/dashboard, /spenders, …) for the signed-in person's own team; there `base` is
// "" so every link a screen builds stays on those routes.

import {createContext, useContext, useMemo, type ReactNode} from "react";
import {DEMO_TEAM} from "@/lib/chain";
import {useNow, useTeam} from "@/lib/team";
import {useWallet} from "@/lib/wallet";

const Ctx = createContext<{team: string; base: string} | null>(null);

/** `base` is the prefix of every link inside the team: /app/<team> by default, "" for one's own team. */
export function TeamScope({team, base, children}: {team: string; base?: string; children: ReactNode}) {
  const value = useMemo(() => ({team, base: base ?? `/app/${team}`}), [team, base]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTeamPage() {
  const scope = useContext(Ctx);
  if (!scope) throw new Error("useTeamPage outside TeamScope");
  return useTeamView(scope.team, scope.base);
}

/**
 * The same view of any team by address, with no TeamScope needed, for components a route outside
 * /app/<team> renders (the signed-in user's own /compute, for one). Shares the one poller per team.
 * `base` prefixes the links a screen builds: /app/<team> by default, "" for one's own team.
 */
export function useTeamView(team: string, base: string = `/app/${team}`) {
  const t = useTeam(team, 1500);
  const {address} = useWallet();
  const now = useNow();
  const isOwner = !!address && t.team?.owner === address;
  const me = (address && t.spenders?.find((s) => s.authority === address && s.status !== "revoked")) || null;
  return {...t, address: team, base, wallet: address, isOwner, me, demo: team === DEMO_TEAM, now};
}

export type TeamPage = ReturnType<typeof useTeamPage>;
