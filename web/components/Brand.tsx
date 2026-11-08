import {MARK_PATH, MARK_VIEWBOX} from "./brand-mark";
import styles from "./Brand.module.css";

/**
 * The mark alone. Its colour is `--color-logo-mark`: the brand's ink on light surfaces and its
 * paper on dark ones (globals.css / theme-dark.css), so it is the real logo on either ground
 * without a second file. Decorative wherever the name sits beside it.
 */
export function BrandMark({className}: {className?: string}) {
  return (
    <svg className={className ? `${styles.mark} ${className}` : styles.mark} viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={MARK_PATH} fill="var(--color-logo-mark, currentColor)" fillRule="evenodd" />
    </svg>
  );
}

/** A shared wordmark, not an action. Its parent supplies the destination. */
export function Brand() {
  return <span className={styles.brand}>
    <BrandMark />
    <span>rein</span>
  </span>;
}
