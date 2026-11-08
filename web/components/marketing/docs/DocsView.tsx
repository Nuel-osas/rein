import Link from "next/link";

import {IconArrowLeft, IconArrowRight} from "@/components/app/Icons";
import {type DocPage, docsNav} from "@/lib/docs";
import {DocsBlocks} from "./DocsArticle";
import styles from "./Docs.module.css";

/**
 * One docs page: the table of contents on the left (a disclosure on a phone), the page in a
 * reading measure, "On this page" on wide screens, and the previous and next pages at the foot.
 * A server component: the menu is a native <details>, so the docs ship no JavaScript of their own
 * beyond Next's links.
 */
export function DocsView({page}: {page: DocPage}) {
  const nav = docsNav();
  const toc = page.toc;
  const navList = (
    <nav aria-label="Documentation" className={styles.nav}>
      {nav.map((group, g) => (
        <div key={g} className={styles.navGroup}>
          {group.title ? <p className={styles.navTitle}>{group.title}</p> : null}
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link className={styles.navLink} href={item.href} aria-current={item.href === page.href ? "page" : undefined}>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className={styles.shell} data-docs="">
      <aside className={styles.sidebar}>{navList}</aside>

      <div className={styles.main}>
        {/* Keyed by page, so the menu is closed again on the page a link in it opens. */}
        <details key={page.href} className={styles.mobileNav}>
          <summary>
            <span className={styles.mobileNavLabel}>Docs</span>
            <span className={styles.mobileNavCurrent}>{page.title}</span>
          </summary>
          {navList}
        </details>

        <article className={styles.article}>
          <header className={styles.head}>
            <p className={styles.crumb}>
              <Link href="/docs">Docs</Link>
              {page.group ? (
                <>
                  <span aria-hidden="true"> / </span>
                  {page.group}
                </>
              ) : null}
            </p>
            <h1 className={styles.title}>{page.title}</h1>
            {page.description ? <p className={styles.lead}>{page.description}</p> : null}
          </header>

          <div className={styles.body}>
            <DocsBlocks blocks={page.blocks} />
          </div>

          <nav className={styles.pager} aria-label="Previous and next page">
            {page.prev ? (
              <Link className={styles.pagerLink} href={page.prev.href} data-dir="prev">
                <span className={styles.pagerLabel}>
                  <IconArrowLeft size="nav" />
                  Previous
                </span>
                <span className={styles.pagerTitle}>{page.prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {page.next ? (
              <Link className={styles.pagerLink} href={page.next.href} data-dir="next">
                <span className={styles.pagerLabel}>
                  Next
                  <IconArrowRight size="nav" />
                </span>
                <span className={styles.pagerTitle}>{page.next.title}</span>
              </Link>
            ) : null}
          </nav>
        </article>
      </div>

      {toc.length > 1 ? (
        <aside className={styles.toc} aria-label="On this page">
          <p className={styles.navTitle}>On this page</p>
          <ul>
            {toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.text}</a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
