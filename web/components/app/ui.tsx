import type {ReactNode} from "react";
import type {SpenderKind, Unread, Usd} from "@/lib/fixtures";
import type {Tone} from "./copy";
import {UNKNOWN, UNKNOWN_LABEL, usedFraction} from "./format";
import a11y from "./a11y.module.css";
import styles from "./ui.module.css";
import {SkeletonPulse} from "./Progress";

/* --- Status pill ---------------------------------------------------------- */

const TONE_CLASS: Record<Tone, string> = {
  settled: styles.toneSettled,
  blocked: styles.toneBlocked,
  pending: styles.tonePending,
  failed: styles.toneFailed,
  neutral: styles.toneNeutral,
};

/**
 * Status is a word on a tint. Colour carries the tone, the word carries the meaning, so nothing
 * depends on colour alone; the icon that used to sit in front of every word added noise, not
 * meaning (facelift, 4 Oct).
 */
export function StatusPill({tone, label}: {tone: Tone; label: string}) {
  return <span className={`${styles.pill} ${TONE_CLASS[tone]}`}>{label}</span>;
}

/* --- Avatar --------------------------------------------------------------- */

export function Avatar({
  initials,
  kind,
  small = false,
}: {
  initials: string;
  kind: SpenderKind;
  small?: boolean;
}) {
  const classes = [styles.avatar];
  if (kind === "agent") classes.push(styles.avatarAgent);
  if (small) classes.push(styles.avatarSmall);
  return (
    <span className={classes.join(" ")} aria-hidden="true">
      {initials}
    </span>
  );
}

/* --- Meter ---------------------------------------------------------------- */

/**
 * Decorative on purpose. Every meter sits next to a sentence that states the
 * same thing in figures, so announcing it twice would only add noise. When the
 * spend total did not load the track is striped rather than empty, because an
 * empty track is a claim that nothing was spent.
 */
export function Meter({spent, allowance}: {spent: Unread<Usd>; allowance: Usd}) {
  const fraction = usedFraction(spent, allowance);
  if (fraction === null) {
    return <div className={`${styles.meter} ${styles.meterUnknown}`} aria-hidden="true" />;
  }
  const tight = fraction >= 0.85;
  return (
    <div className={`${styles.meter} ${tight ? styles.meterTight : ""}`} aria-hidden="true">
      <span
        className={styles.meterFill}
        style={{inlineSize: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%`}}
      />
    </div>
  );
}

/* --- Skeleton ------------------------------------------------------------- */

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius,
}: {
  width?: string;
  height?: string;
  radius?: string;
}) {
  return (
    <SkeletonPulse
      style={{inlineSize: width, blockSize: height, borderRadius: radius}}
    />
  );
}

/** Wraps a set of skeletons and tells assistive tech that something is coming. */
export function Loading({label, children}: {label: string; children: ReactNode}) {
  return (
    <div role="status">
      <span className={a11y.srOnly}>{label}</span>
      {children}
    </div>
  );
}

/** Same card / row geometry as the content, without inventing account figures. */
export function ContentLoading({label, rows = 3}: {label: string; rows?: number}) {
  return <Loading label={label}>
    <div className={styles.loadingCard} aria-busy="true">
      <div className={styles.loadingHeading}><Skeleton width="38%" height="1.25rem" /><Skeleton width="22%" /></div>
      {Array.from({length: rows}, (_, i) => <div className={styles.loadingRow} key={i}>
        <Skeleton width="2.75rem" height="2.75rem" radius="12px" />
        <div className={styles.loadingLines}><Skeleton width="65%" /><Skeleton width="85%" height=".75rem" /></div>
        <Skeleton width="18%" />
      </div>)}
    </div>
  </Loading>;
}

/* --- Empty state ---------------------------------------------------------- */

/**
 * Orients the reader and offers one next action. Never a bare "No results".
 *
 * `as` exists for the case where the empty state IS the page: a not-found route
 * renders nothing else, so its title has to be the document's `h1` rather than
 * a paragraph. Leaving it a paragraph gave those routes no heading at all, and
 * a page with no h1 gives a screen reader nothing to land on. Inside a section
 * that already has a heading, the default paragraph stays correct — promoting
 * it there would put a second h1 on the page.
 */
export function EmptyState({
  title,
  body,
  action,
  as = "p",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  as?: "p" | "h1";
}) {
  const Title = as;

  return (
    <div className={styles.empty}>
      <Title className={`${as === "h1" ? "t-title" : "t-heading"} ${styles.emptyTitle}`}>
        {title}
      </Title>
      <p className={`t-body ${styles.emptyBody}`}>{body}</p>
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

/* --- Unknown -------------------------------------------------------------- */

/**
 * A value we could not read: the em dash on screen, words for a screen reader, which would
 * otherwise announce the dash as nothing at all. Never a zero (convention 1).
 */
export function Unknown() {
  return (
    <>
      <span aria-hidden="true">{UNKNOWN}</span>
      <span className={a11y.srOnly}>{UNKNOWN_LABEL}</span>
    </>
  );
}

/* --- Chip ----------------------------------------------------------------- */

export function Chip({children}: {children: ReactNode}) {
  return <span className={styles.chip}>{children}</span>;
}
