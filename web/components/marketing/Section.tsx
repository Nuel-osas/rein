import type {ReactNode} from "react";
import styles from "./Section.module.css";

type SectionProps = {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  /** Drops the section onto the sunken surface, used to separate adjacent bands. */
  tone?: "canvas" | "sunken";
  align?: "center" | "left";
  className?: string;
};

/**
 * The shared band: gutter, measure, and a heading block.
 *
 * Every section on the page is an `<h2>` under the hero's `<h1>`, so the
 * document outline reads in order with no levels skipped.
 */
export function Section({id, eyebrow, title, lede, children, tone = "canvas", align = "center", className}: SectionProps) {
  const classes = [styles.section, tone === "sunken" ? styles.sunken : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} id={id} aria-labelledby={`${id}-title`}>
      <div className={styles.shell}>
        <header className={`${styles.head} ${align === "left" ? styles.left : ""}`}>
          <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
          <h2 className={`t-display ${styles.title}`} id={`${id}-title`}>
            {title}
          </h2>
          {lede ? <p className={styles.lede}>{lede}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}
