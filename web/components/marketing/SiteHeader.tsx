import {TestnetNote, TestnetStrip, TestnetTag} from "@/components/app/TestnetMark";
import {SiteHeaderBar} from "./SiteHeaderBar";
import styles from "./SiteHeader.module.css";

/**
 * The marketing header. A server component: the testnet marks (`[ TESTNET ]` beside the logo,
 * the phone strip, the one quiet line under the bar) depend only on the build's network, so they
 * are rendered here and handed to the interactive bar as slots. On a mainnet build each renders
 * nothing.
 */
export function SiteHeader() {
  return (
    <SiteHeaderBar
      strip={<TestnetStrip className={styles.testnetStrip} />}
      tag={<TestnetTag className={styles.testnetTag} />}
      note={<TestnetNote className={styles.testnetNote} />}
    />
  );
}
