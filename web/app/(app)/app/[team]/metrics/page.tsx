import type {Metadata} from "next";
import {Metrics} from "@/components/app/screens/Metrics";

export const metadata: Metadata = {title: "Metrics | Rein"};

export default function MetricsPage() {
  return <Metrics />;
}
