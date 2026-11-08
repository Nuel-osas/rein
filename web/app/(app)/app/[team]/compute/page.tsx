import type {Metadata} from "next";
import {Compute} from "@/components/app/screens/Compute";

export const metadata: Metadata = {title: "AI compute | Rein"};

/** The agent's compute purchases (llm-inference, gpu-hour), read from this team's Payment accounts. */
export default function ComputePage() {
  return <Compute />;
}
