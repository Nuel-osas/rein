"use client";

import {useRef} from "react";
import styles from "./SiteHeader.module.css";

type Props = {links: ReadonlyArray<{href: string; label: string}>};

/** Native disclosure works before hydration; JS adds dismissal after navigation. */
export function MobileMenu({links}: Props) {
  const ref = useRef<HTMLDetailsElement>(null);

  return (
    <details
      ref={ref}
      className={styles.mobileMenu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="Page navigation">Menu</summary>
      <nav aria-label="Mobile sections">
        {links.map((link) => (
          <a
            className={styles.tile}
            href={link.href}
            key={link.href}
            onClick={() => {
              if (ref.current) ref.current.open = false;
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </details>
  );
}
