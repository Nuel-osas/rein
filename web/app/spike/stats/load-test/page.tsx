import type {Metadata} from "next";
import {Suspense} from "react";
import {LoadTestSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Load test | Rein spike"};

export default function LoadTestSpikePage() {
  return (
    <Suspense>
      <LoadTestSpike />
    </Suspense>
  );
}
