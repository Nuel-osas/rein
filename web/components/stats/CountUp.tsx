"use client";

import {useEffect, useRef} from "react";
import {centsToDollars, formatCount} from "./format";
import styles from "./Stats.module.css";

/**
 * A figure that counts up from zero once, the first time it is on screen.
 *
 * THE SERVER HTML HAS THE REAL NUMBER. `text` is rendered as it is, so a reader
 * without JavaScript, a crawler, or anybody who asked for reduced motion gets
 * the figure and nothing else. The visible copy is hidden from assistive
 * technology and the real figure is read once from `label`, so a screen reader
 * never hears a number mid-count.
 *
 * NO FLASH OF THE WRONG NUMBER. Where the browser runs scripts and allows
 * motion, the CSS keeps the figure invisible (`data-count="pending"`) until
 * this component starts counting it. If the script never arrives, a delayed
 * CSS animation shows the real figure anyway after 2.5 s; a figure that became
 * visible that way and is on screen is then left alone rather than reset to 0.
 */
export function CountUp({value, kind, text, label}: {value: number; kind: "count" | "cents"; text: string; label: string}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React's own text node, rewritten in place, so a later render still finds the node it made.
    const write = (s: string) => {
      const node = el.firstChild;
      if (node && node.nodeType === Node.TEXT_NODE) node.nodeValue = s;
      else el.textContent = s;
    };
    const finish = () => {
      write(text);
      el.dataset.count = "done";
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value <= 0 || !("IntersectionObserver" in window)) return finish();

    const inView = () => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    };
    // The fallback already showed the real figure, on screen: counting from 0 now would be a jump.
    if (getComputedStyle(el).opacity !== "0" && inView()) return finish();

    let frame = 0;
    const show = (n: number) => {
      write(kind === "cents" ? centsToDollars(n) : formatCount(n));
    };
    const run = () => {
      el.dataset.count = "running";
      const duration = 1_100;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        show(Math.round(value * eased));
        if (t < 1) frame = requestAnimationFrame(step);
        else finish();
      };
      show(0);
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        run();
      },
      {threshold: 0},
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, kind, text]);

  return (
    <>
      <span className={styles.srOnly}>{label}</span>
      <span ref={ref} className={styles.count} data-count="pending" aria-hidden="true">
        {text}
      </span>
    </>
  );
}
