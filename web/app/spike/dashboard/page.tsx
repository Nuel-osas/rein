import type {Metadata} from "next";
import {Suspense} from "react";
import {DashboardSpike} from "@/components/spike/Spikes";

export const metadata: Metadata = {title: "Dashboard states | Rein spike"};

export default function DashboardSpikePage() {
  return (
    <Suspense>
      <DashboardSpike />
    </Suspense>
  );
}
