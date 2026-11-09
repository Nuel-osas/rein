import type {Metadata} from "next";
import {Compute} from "@/components/app/screens/Compute";

export const metadata: Metadata = {title: "AI compute | Rein"};

/** AI compute: pick a 0G service, let the team's Rein agent buy one run under its policy, and see this team's purchases (its Payment accounts). */
export default function ComputePage() {
  return <Compute />;
}
