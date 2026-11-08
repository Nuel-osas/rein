// A client component so `onClick` and `useId` are both available. Server
// components may still render it; they simply pass no handler.
"use client";

import Link from "next/link";
import type {ButtonHTMLAttributes, ReactNode} from "react";
import {useId} from "react";
import styles from "./Button.module.css";
import {Spinner} from "./Progress";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface CommonProps {
  variant?: Variant;
  small?: boolean;
  block?: boolean;
  className?: string;
  children: ReactNode;
}

function classesFor({variant = "secondary", small, block, className}: CommonProps) {
  const classes = [styles.button, styles[variant]];
  if (small) classes.push(styles.small);
  if (block) classes.push(styles.block);
  if (className) classes.push(className);
  return classes.join(" ");
}

interface ButtonProps extends CommonProps {
  busy?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  onClick?: () => void;
  /**
   * Why this control cannot be used right now. Setting it renders the reason
   * in visible text beside the button and marks the button `aria-disabled`
   * rather than `disabled`, so the explanation stays reachable by keyboard.
   * A disabled control with no stated reason is worse than an enabled one
   * that fails.
   */
  disabledReason?: string;
  "aria-label"?: string;
}

export function Button({
  type = "button",
  onClick,
  disabledReason,
  busy = false,
  "aria-label": ariaLabel,
  ...common
}: ButtonProps) {
  const reasonId = useId();
  const unavailable = Boolean(disabledReason) || busy;

  const button = (
    <button
      type={type}
      className={`${classesFor(common)}${unavailable ? ` ${styles.unavailable}` : ""}`}
      onClick={(event) => { if (unavailable) { event.preventDefault(); return; } onClick?.(); }}
      aria-disabled={unavailable || undefined}
      aria-busy={busy || undefined}
      aria-describedby={disabledReason ? reasonId : undefined}
      aria-label={ariaLabel}
    >
      {busy ? <Spinner /> : null}{common.children}
    </button>
  );

  if (!disabledReason) return button;

  return (
    <span className={styles.wrap}>
      {button}
      <p className={styles.reason} id={reasonId}>
        {disabledReason}
      </p>
    </span>
  );
}

interface ButtonLinkProps extends CommonProps {
  href: string;
  "aria-label"?: string;
}

export function ButtonLink({href, "aria-label": ariaLabel, ...common}: ButtonLinkProps) {
  return (
    <Link href={href} className={classesFor(common)} aria-label={ariaLabel}>
      {common.children}
    </Link>
  );
}
