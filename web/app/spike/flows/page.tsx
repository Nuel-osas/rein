import type {Metadata} from "next";
import {Suspense} from "react";
import {FlowsSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Flow states | Rein spike"};

export default function FlowsSpikePage() {
  return (
    <Suspense>
      <FlowsSpike />
    </Suspense>
  );
}
