import type {Metadata} from "next";
import {JoinByLink} from "@/components/app/screens/Invite";

export const metadata: Metadata = {title: "Join a team | Rein"};

/** Nuntio's /teams/join: reachable with a team or without one. The same screen as /app/teams/join. */
export default function JoinTeamPage() {
  return <JoinByLink back={{href: "/dashboard", label: "Back to Home"}} />;
}
