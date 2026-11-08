"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {type ReactNode, useEffect, useRef, useState} from "react";
import {Brand} from "@/components/Brand";
import {ArrowGlyph} from "./Drawings";
import {MobileMenu} from "./MobileMenu";
import {APP_HREF} from "./routes";
import styles from "./SiteHeader.module.css";

/**
 * Absolute rather than bare fragments, so the header works on every page in the
 * group rather than only on the one that owns the sections. `#faq` from
 * `/security` scrolls to nothing; `/#faq` goes home and then scrolls, and on `/`
 * itself Next still treats it as a same-route hash.
 */
const LINKS = [
  {href: "/#how-it-works", label: "How it works"},
  {href: "/#features", label: "Agents"},
  {href: "/#trust", label: "Security"},
  {href: "/demo", label: "Live demo"},
  {href: "/#faq", label: "FAQ"},
] as const;

type Tone = "dark" | "light";

/**
 * The tone of whatever the header is floating over: a section marks itself
 * `data-tone="dark"` or `"light"`, and the header reads the one under its own
 * middle. Read on scroll (once a frame at most) and on navigation. The home
 * page opens on the dark hero, so that is the server's first guess there.
 */
function useSurfaceTone(header: React.RefObject<HTMLElement | null>, pathname: string) {
  const [tone, setTone] = useState<Tone>(pathname === "/" ? "dark" : "light");
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const bar = header.current;
    if (!bar) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setScrolled(window.scrollY > 24);
      const y = bar.getBoundingClientRect().height / 2;
      let next: Tone = "light";
      for (const el of document.elementsFromPoint(window.innerWidth / 2, y)) {
        if (bar.contains(el)) continue;
        const host = el.closest<HTMLElement>("[data-tone]");
        if (host) {
          next = host.dataset.tone === "dark" ? "dark" : "light";
          break;
        }
      }
      setTone(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, {passive: true});
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [header, pathname]);
  return {tone, scrolled};
}

/**
 * The header's interactive part: the tone it floats over, the scrolled state, the phone menu.
 *
 * The testnet marks arrive as rendered slots from `SiteHeader` (a server component) rather than
 * being imported here, so the network constants they read (and the SDK and viem behind them) stay
 * on the server instead of in every marketing page's JavaScript.
 */
export function SiteHeaderBar({strip, tag, note}: {strip?: ReactNode; tag?: ReactNode; note?: ReactNode}) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  const {tone, scrolled} = useSurfaceTone(ref, pathname);
  return (
    <header ref={ref} className={styles.header} data-on={tone} data-scrolled={scrolled}>
      {/* Testnet, on a phone: one slim line across the top instead of the tag and the note. */}
      {strip}
      <div className={styles.bar}>
        {/* The tag sits beside the logo, outside the home link, so the link's name stays "Rein home". */}
        <div className={styles.brandRow}>
          <Link className={styles.wordmark} href="/" aria-label="Rein home">
            <Brand />
          </Link>
          {tag}
        </div>
        <nav className={styles.nav} aria-label="Sections">
          {LINKS.map((link) => (
            <a className={styles.tile} href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <MobileMenu links={LINKS} />
        {/* A plain anchor: the app loads fresh, without prefetching the wallet bundle here. */}
        <a className={styles.app} href={APP_HREF}>
          <span className={styles.appLabel}>Open the app</span>
          <span className={styles.appTile}>
            <ArrowGlyph />
          </span>
        </a>
      </div>
      {/* Testnet only: one quiet line under the bar, gone once the page moves so it never sits on the content. */}
      {note}
    </header>
  );
}
