import Link from "next/link";
import type {ReactNode} from "react";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {Bracketed, LinkArrow, TracedPage} from "./Traced";
import styles from "./Stats.module.css";

/* ===========================================================================
   /stats/load-test, in the same drawing as /stats.

   No load test has been run against Rein, so this page shows none: no figures,
   no ledger and no placeholder numbers. It says so, says what the evidence
   that does exist is, and points back to the live figures. When a load test is
   run, its transactions belong here, counted apart from real use.
   =========================================================================== */

/** The page's masthead: what this is, and the way back. */
export function LoadTestFrame({children}: {children: ReactNode}) {
  return (
    <TracedPage
      label="Load test, not real use"
      titleId="load-test-title"
      title="No load test yet"
      lede={
        <>
          <p>Rein has not been load-tested. When it is, every transaction the runner makes will be listed here, apart from real use.</p>
          <p>
            <Link className={styles.control} href="/stats">
              <LinkArrow kind="back" />
              Back to stats
            </Link>
          </p>
        </>
      }
    >
      {children}
    </TracedPage>
  );
}

/** What has been run instead, said plainly. */
export function LoadTestEmpty() {
  return (
    <div className={styles.body}>
      <section className={`${styles.held} ${styles.frame}`} aria-labelledby="no-load-test">
        <div className={styles.heldLead}>
          <h2 className={styles.label} id="no-load-test">
            <Bracketed>Not run</Bracketed>
          </h2>
          <p className={styles.note}>Nothing on this page is measured, so nothing on it is a number.</p>
        </div>
        <div className={styles.heldBody}>
          <p className={styles.statement}>No load test has been run on Rein yet.</p>
          <p className={styles.note}>
            What has been run on {NETWORK_NAME}: the evidence script, which proves each rule once with a real transaction (a payment inside the policy, one held
            over the cap, the owner&apos;s approval, and two refused payees), and the program&apos;s rule tests against a local validator. Neither measures
            throughput, and neither is presented as a load test.
          </p>
          <p>
            <Link className={styles.control} href="/security">
              The evidence transactions
              <LinkArrow />
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
