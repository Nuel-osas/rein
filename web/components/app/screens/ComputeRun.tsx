"use client";

import Link from "next/link";
import {isComputeIntent} from "@/lib/compute-client";
import {PageHeader} from "../PageHeader";
import {ContentLoading, EmptyState} from "../ui";
import {useTeamPage} from "../rein/context";
import {ComputeResultView} from "../rein/ComputeCards";
import rein from "../rein/rein.module.css";
import styles from "../pages/compute.module.css";

export function ComputeRun({intent}: {intent: string}) {
  const t = useTeamPage();
  if (!isComputeIntent(intent)) return <EmptyState as="h1" title="Not a compute run" body="A run link ends in its intent: a c followed by 31 letters, digits, - or _." action={<Link href={`${t.base}/compute`}>AI compute</Link>} />;
  if (t.at === 0) return <ContentLoading label="Reading the run's payment from chain…" rows={2} />;
  return (
    <div className={styles.page}>
      <PageHeader kind="compute" title="Compute run" description="Price, payment, run and delivery for one purchase. The payment is read from chain; the answer comes from the compute gateway." />
      <ComputeResultView t={t} intent={intent} />
      <Link href={`${t.base}/compute`} className={rein.sectionLink}>
        ← AI compute
      </Link>
    </div>
  );
}
