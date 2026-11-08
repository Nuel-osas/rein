import type {Metadata} from "next";
import {AppFrame} from "@/components/app/AppFrame";
import {CreateTeam} from "@/components/app/screens/CreateTeam";

export const metadata: Metadata = {title: "Create a team | Rein"};

export default function NewTeamPage() {
  return (
    <AppFrame team={null}>
      <CreateTeam />
    </AppFrame>
  );
}
