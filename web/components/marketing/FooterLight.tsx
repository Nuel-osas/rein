"use client";

import {type CSSProperties, useEffect, useRef} from "react";
import styles from "./SiteFooter.module.css";

/* Seven columns across the width, tallest just right of centre, each a share of the band's height. */
const BEAMS = [0.3, 0.54, 0.8, 1, 0.86, 0.6, 0.34] as const;

/* How high the light stands before the footer is reached, as a share of each column's full height. */
const FLOOR = 0.16;

/**
 * The end of the page: light rising in columns out of its foot, each column ruled by a dotted
 * line, standing higher the further down you scroll and at full height on the last pixel.
 *
 * Decoration only. The server renders it at full height (`--rise: 1`), which is also what a
 * reader who asked for reduced motion keeps. One passive scroll listener, attached only while
 * the band is near the screen, writes `--rise` once a frame; nothing else re-renders.
 */
export function FooterLight() {
  const band = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = band.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const box = el.getBoundingClientRect();
      // 0 as the band's top enters at the foot of the screen, 1 when its foot meets the foot of the screen.
      const reached = Math.min(1, Math.max(0, (window.innerHeight - box.top) / box.height));
      const eased = 1 - (1 - reached) ** 2;
      el.style.setProperty("--rise", (FLOOR + (1 - FLOOR) * eased).toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    let listening = false;
    const listen = (on: boolean) => {
      if (on === listening) return;
      listening = on;
      if (on) {
        window.addEventListener("scroll", onScroll, {passive: true});
        window.addEventListener("resize", onScroll);
      } else {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    };

    update();
    // A margin below the screen, so the light is already low when the band scrolls into view.
    const observer = new IntersectionObserver(
      ([entry]) => {
        listen(Boolean(entry?.isIntersecting));
        update();
      },
      {rootMargin: "0px 0px 50% 0px"},
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      listen(false);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={band} className={styles.light} aria-hidden="true">
      {BEAMS.map((height, i) => (
        <span key={i} className={styles.column} style={{"--h": height} as CSSProperties}>
          <span className={styles.beam} />
        </span>
      ))}
    </div>
  );
}
