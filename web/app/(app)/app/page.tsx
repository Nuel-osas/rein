import type {Metadata} from "next";
import {AppFrame} from "@/components/app/AppFrame";
import {TeamsHome} from "@/components/app/screens/TeamsHome";

export const metadata: Metadata = {title: "Your teams | Rein"};

export default function TeamsPage() {
  return (
    <AppFrame team={null}>
      <TeamsHome />
    </AppFrame>
  );
}
