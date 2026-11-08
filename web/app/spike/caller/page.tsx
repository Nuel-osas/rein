import type {Metadata} from "next";
import {Suspense} from "react";
import {CallerSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Who the program sees | Rein spike"};

export default function CallerSpikePage() {
  return (
    <Suspense>
      <CallerSpike />
    </Suspense>
  );
}
