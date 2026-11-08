import type {Metadata} from "next";
import {CreateTeam} from "@/components/app/screens/CreateTeam";

export const metadata: Metadata = {title: "Create a team | Rein"};

/**
 * Nuntio's /teams/new: where the gate sends a signed-in person whose wallet owns no team yet. The
 * same screen as /app/teams/new; once the team is confirmed it opens at /dashboard.
 */
export default function NewTeamPage() {
  return <CreateTeam openHref="/dashboard" />;
}
