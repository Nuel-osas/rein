import type {Metadata} from "next";
import {ComputeRun} from "@/components/app/screens/ComputeRun";

export const metadata: Metadata = {title: "Compute run | Rein"};

/** One compute run: its payment from chain and its result (or refund) from the gateway. */
export default async function ComputeRunPage({params}: {params: Promise<{intent: string}>}) {
  const {intent} = await params;
  return <ComputeRun intent={decodeURIComponent(intent)} />;
}
