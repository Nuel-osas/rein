import type {Metadata} from "next";
import {Suspense} from "react";
import {ApprovalsSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Approval states | Rein spike"};

export default function ApprovalsSpikePage() {
  return (
    <Suspense>
      <ApprovalsSpike />
    </Suspense>
  );
}
