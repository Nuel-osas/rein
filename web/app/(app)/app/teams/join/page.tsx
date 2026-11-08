import type {Metadata} from "next";
import {AppFrame} from "@/components/app/AppFrame";
import {JoinByLink} from "@/components/app/screens/Invite";

export const metadata: Metadata = {title: "Join a team | Rein"};

/** How someone joins a Rein team (the owner adds them by address), and a field for an invite link. */
export default function JoinTeamPage() {
  return (
    <AppFrame team={null}>
      <JoinByLink />
    </AppFrame>
  );
}
