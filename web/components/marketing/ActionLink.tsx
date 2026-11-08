import type {ReactNode} from "react";
import styles from "./ActionLink.module.css";

type Variant = "primary" | "secondary";

type ActionLinkProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  /** Opens in a new tab and carries the usual rel guard. */
  external?: boolean;
  className?: string;
};

/**
 * A link that looks like a control.
 *
 * It is an `<a>` and never a `<button>`, because every action on this page is a
 * navigation. A plain anchor loads the app fresh, so its color scheme is
 * resolved at the document boundary without prefetching the wallet bundle.
 *
 * Two variants. A third, quiet text-link variant existed and was never used at
 * a single call site, so it is gone: an unused variant is a decision nobody has
 * had to defend yet.
 */
export function ActionLink({
  href,
  children,
  variant = "primary",
  external = false,
  className,
}: ActionLinkProps) {
  const classes = [styles.base, styles[variant], className].filter(Boolean).join(" ");

  return (
    <a
      className={classes}
      href={href}
      {...(external ? {target: "_blank", rel: "noreferrer noopener"} : {})}
    >
      {children}
    </a>
  );
}
