import type {Metadata} from "next";
import {LoadTestEmpty, LoadTestFrame} from "@/components/stats/LoadTest";

/**
 * Where a load test's transactions would be listed, apart from real use. None has been run on
 * Rein, so the page says that and shows no figures.
 */
export const metadata: Metadata = {
  title: "Load test | Rein",
  description: "No load test has been run on Rein yet. This page will list a load test's transactions, apart from real use, once one is run.",
};

export default function LoadTestRoute() {
  return (
    <LoadTestFrame>
      <LoadTestEmpty />
    </LoadTestFrame>
  );
}
