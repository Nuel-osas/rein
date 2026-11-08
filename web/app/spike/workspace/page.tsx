import type {Metadata} from "next";
import {Suspense} from "react";
import {WorkspaceSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Workspace shell | Rein spike"};

export default function WorkspaceSpikePage() {
  return (
    <Suspense>
      <WorkspaceSpike />
    </Suspense>
  );
}
