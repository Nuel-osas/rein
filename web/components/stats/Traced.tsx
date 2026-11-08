import type {ReactNode} from "react";
import styles from "./Stats.module.css";

/* ===========================================================================
   The pieces of the marketing site's drawing that /stats and /stats/load-test
   share: the bracketed label, the dotted column guides, and the masthead.
   =========================================================================== */

/** A label in the drawing's style: `[ TEAMS ]`. The brackets are drawing, not words. */
export function Bracketed({children}: {children: ReactNode}) {
  return (
    <>
      <span className={styles.bracket} aria-hidden="true">
        [
      </span>
      {children}
      <span className={styles.bracket} aria-hidden="true">
        ]
      </span>
    </>
  );
}

/** The three column guides of the drawing, dotted, behind the content. */
function Guides() {
  return (
    <div className={styles.guides} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

/** A masthead and ground in the drawing: the bracketed label, the title, and a lede beside it. */
export function TracedPage({label, title, lede, titleId, children}: {label: string; title: ReactNode; lede: ReactNode; titleId: string; children: ReactNode}) {
  return (
    <section className={styles.stats} data-tone="light" aria-labelledby={titleId}>
      <Guides />
      <div className={styles.inner}>
        <div className={styles.rule} aria-hidden="true" />
        <header className={styles.head}>
          <div className={styles.headTitle}>
            <p className={styles.label}>
              <Bracketed>{label}</Bracketed>
            </p>
            <h1 id={titleId}>{title}</h1>
          </div>
          <div className={styles.lede}>{lede}</div>
        </header>
        {children}
      </div>
    </section>
  );
}

const ARROWS = {
  /** Out of the site, to the explorer. */
  external: "M3.5 2.5h6v6M9.5 2.5l-7 7",
  forward: "M2 6h8M6.5 2.5 10 6l-3.5 3.5",
  back: "M10 6H2M5.5 2.5 2 6l3.5 3.5",
} as const;

/** The arrow a link in the drawing carries. Decoration: the link's words say where it goes. */
export function LinkArrow({kind = "forward"}: {kind?: keyof typeof ARROWS}) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d={ARROWS[kind]} />
    </svg>
  );
}
