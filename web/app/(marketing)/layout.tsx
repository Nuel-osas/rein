import type {ReactNode} from "react";
import {SiteHeader} from "@/components/marketing/SiteHeader";
import {SiteFooter} from "@/components/marketing/SiteFooter";
import styles from "./page.module.css";

/**
 * The marketing shell, extracted so a second page costs a file rather than a
 * copy of the chrome.
 *
 * It used to live inside `page.tsx`, which was right while there was one page
 * and wrong the moment there were two. The `.page` element is not decoration:
 * it declares the editorial type scale, the shell width, the ring tokens and
 * the marketing canvas, all scoped so they cannot reach the product. A second
 * page written without it would silently fall back to the app's four-size
 * system and look like a different site, and a second page written WITH it by
 * copy would be two places to keep in step.
 *
 * So every route in this group gets the tokens, the skip link, the header and
 * the footer by existing, and a page is only its content. "Same UX" becomes a
 * property of the directory rather than something each page has to remember.
 */
export default function MarketingLayout({children}: {children: ReactNode}) {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main className={styles.main} id="main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
