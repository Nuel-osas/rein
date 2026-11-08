"use client";

import type {ReactNode} from "react";
import {formatCount} from "./format";
import styles from "./ListView.module.css";

/* ===========================================================================
   The grammar every list page shares (Agents, Spenders, Activity, Approvals).

   The page header, then one bar: filter tabs on the left, the page's tools on
   the right. Then one white card holding the rows, a hairline under the column
   heads and between rows. Anything else (a template grid, a quiet line about
   how complete the list is) sits below the card.

   Only the pieces with behaviour are components. The card and its rows are
   classes in `ListView.module.css`, because each page lays its own columns out.
   =========================================================================== */

export interface TabOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label. Null is unknown and shows nothing, never zero. */
  count?: number | null;
}

/**
 * Filter tabs: real buttons with `aria-pressed` in a labelled group, so each
 * says whether it is on and the group says what it filters. Not a tablist: the
 * list below is the same list filtered, not a different panel.
 */
export function FilterTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className={styles.tabs} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.tab}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count === undefined || option.count === null ? null : <span className={styles.tabCount}>{formatCount(option.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Tabs on the left, the page's tools on the right; on a phone the tools wrap under the tabs. */
export function ListBar({children, end}: {children?: ReactNode; end?: ReactNode}) {
  return (
    <div className={styles.bar}>
      {children ? <div className={styles.barStart}>{children}</div> : null}
      {end ? <div className={styles.barEnd}>{end}</div> : null}
    </div>
  );
}

/** A section under the list ("Start from a template"): a quiet title and its content. */
export function ListSection({id, title, children}: {id: string; title: string; children: ReactNode}) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 className={styles.sectionTitle} id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}
