import type {Metadata} from "next";
import {Suspense} from "react";
import {StatsSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Stats | Rein spike"};

export default function StatsSpikePage() {
  return (
    <Suspense>
      <StatsSpike />
    </Suspense>
  );
}
