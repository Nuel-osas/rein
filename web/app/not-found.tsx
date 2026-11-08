import type {Metadata} from "next";
import Link from "next/link";
import {BrandMark} from "@/components/Brand";
import styles from "./not-found.module.css";

export const metadata: Metadata = {title: "Page not found | Rein"};

/**
 * Any address nothing answers. One traced frame in the site's own look instead of the framework's
 * default page, and two ways back: the public site, and the app for someone who was signed in.
 */
export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <BrandMark className={styles.mark} />
        <p className={styles.label}>[ 404 ]</p>
        <h1 className={styles.title}>This page does not exist</h1>
        <p className={styles.body}>The link may be old or mistyped. Nothing about your account has changed.</p>
        <div className={styles.links}>
          <Link href="/" className={styles.primary}>
            Go to the home page
          </Link>
          <Link href="/app" className={styles.secondary}>
            Open the app
          </Link>
        </div>
      </div>
    </main>
  );
}
