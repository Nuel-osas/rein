import type {ReactNode} from "react";
import styles from "./LegalDocument.module.css";

export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

/**
 * A plain document: numbered headings, one reading measure, nothing else. Used by the privacy
 * and terms pages, which have to be read rather than scanned.
 */
export function LegalDocument({updated, sections}: {updated: string; sections: LegalSection[]}) {
  return (
    <div className={styles.shell}>
      <article className={styles.document}>
        <p className={styles.updated}>Last updated <time dateTime={updated}>{new Date(`${updated}T00:00:00Z`).toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"})}</time></p>
        {sections.map((section, index) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className={styles.section}>
            <h2 id={`${section.id}-title`} className={styles.heading}>
              <span className={styles.number}>{index + 1}</span>
              {section.heading}
            </h2>
            <div className={styles.body}>{section.body}</div>
          </section>
        ))}
      </article>
    </div>
  );
}
