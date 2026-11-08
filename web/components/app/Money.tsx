import type {Unread, Usd} from "@/lib/fixtures";
import {splitUsd, UNKNOWN, UNKNOWN_LABEL} from "./format";
import a11y from "./a11y.module.css";
import styles from "./Money.module.css";

type MoneySize = "hero" | "title" | "body" | "inline";
type MoneyTone = "default" | "in" | "out" | "muted";

interface MoneyProps {
  /** `null` means the read failed. It renders as an em dash, never as zero. */
  value: Unread<Usd>;
  size?: MoneySize;
  tone?: MoneyTone;
  /** Names the figure for a screen reader when it could not be read. */
  label?: string;
  className?: string;
}

/**
 * The only way a dollar amount reaches the screen.
 *
 * Two behaviours are the whole point of the component: it never prints a
 * number it was not given, and an unread value renders as an em dash with a
 * spoken equivalent rather than a precise, wrong `$0.00`.
 */
export function Money({value, size = "body", tone = "default", label, className}: MoneyProps) {
  const parts = splitUsd(value);
  const classes = ["figure", styles.money, styles[size]];
  if (tone !== "default") classes.push(styles[tone]);
  if (className) classes.push(className);

  if (!parts) {
    return (
      <span className={[...classes, styles.unknown].join(" ")}>
        <span aria-hidden="true">{UNKNOWN}</span>
        <span className={a11y.srOnly}>{label ? `${label}: ${UNKNOWN_LABEL}` : UNKNOWN_LABEL}</span>
      </span>
    );
  }

  return (
    <span className={classes.join(" ")}>
      {/* The decimal point stays in the accessible string so screen readers
          read "8,240 point 50" rather than two separate numbers. */}
      <span aria-hidden="true">{parts.dollars}</span>
      <span aria-hidden="true" className={styles.cents}>
        .{parts.cents}
      </span>
      <span className={a11y.srOnly}>{`${parts.dollars}.${parts.cents}`}</span>
    </span>
  );
}
