import type {ReactNode} from "react";
import styles from "./PageIntro.module.css";

/**
 * The opening block for every marketing page that is not the landing page.
 *
 * It exists so a second page inherits the hero's language instead of guessing
 * at it. The landing hero is a full-height cinematic panel with a diagonal
 * beam, 95svh tall, and it is right exactly once: it is the first thing anybody
 * sees and it has one sentence to land. Repeating it at the top of every page
 * would make each one claim to be the front door, and a reader who clicked
 * "Security" would have to scroll past a second billboard to reach the answer.
 *
 * So this is the same vocabulary at a lower volume. Same centred composition,
 * same eyebrow, same editorial scale one step down (`--nt-text-title` rather
 * than `--nt-text-hero`), same warm light, reduced to a glow at the top edge
 * rather than a beam across the frame. It reads as the same site and as a page
 * rather than a homepage.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  /** One or two sentences. Longer belongs in the page, not the masthead. */
  lede?: ReactNode;
  /** Optional actions or a note beneath the lede. */
  children?: ReactNode;
}) {
  return (
    <section className={styles.intro} aria-labelledby="page-title">
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.copy}>
        <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
        <h1 className={styles.title} id="page-title">
          {title}
        </h1>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
        {children ? <div className={styles.extra}>{children}</div> : null}
      </div>
    </section>
  );
}
