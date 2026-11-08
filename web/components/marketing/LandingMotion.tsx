"use client";

import {type CSSProperties, createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState} from "react";
import {GlassField} from "./GlassField";
import {Vault3D} from "./Vault3D";
import styles from "./LandingPage.module.css";

/* ===========================================================================
   Everything on the landing page that runs in the browser, and nothing else.

   The page itself (`LandingPage.tsx`) is a server component: its copy, its
   drawings, the org chart and the network-dependent answers are rendered once
   on the server and never shipped as JavaScript. What is left here is motion:
   the reveals, the draw-ins, the active capability row, the statement's words,
   the moving glass, the turning vault, and the one control that stops them all.

   Every motion is opt-in after hydration and skipped for anyone who asked for
   reduced motion: the server HTML is the whole page, fully visible.
   =========================================================================== */

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Stagger index for a revealed group. Read by the CSS as a transition delay. */
const order = (i: number) => ({"--i": i}) as CSSProperties;

const money = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});

/* --- One stop for every loop on the page (WCAG 2.2.2) ------------------------ */

interface Motion {
  paused: boolean;
  toggle: () => void;
}

const MotionContext = createContext<Motion>({paused: false, toggle: () => {}});

/**
 * The page's root: owns the pause, and runs the scroll-driven motion over
 * whatever the server rendered inside it.
 */
export function LandingMotion({className, children}: {className?: string; children: ReactNode}) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useReveal(root);
  useDrawings(root);
  useActiveRow(root);
  const motion = useMemo(() => ({paused, toggle: () => setPaused((p) => !p)}), [paused]);
  return (
    <MotionContext.Provider value={motion}>
      <div className={className} ref={root} data-landing="" data-paused={paused || undefined}>
        {children}
      </div>
    </MotionContext.Provider>
  );
}

/** For keyboard users (WCAG 2.2.2), shown only while focused. Reduced motion stops it all without this. */
export function MotionToggle({className}: {className?: string}) {
  const {paused, toggle} = useContext(MotionContext);
  return (
    <button type="button" className={className} aria-pressed={paused} onClick={toggle}>
      {paused ? "Play animations" : "Pause animations"}
    </button>
  );
}

/** The hero's moving glass, stopped with the rest of the page. */
export function LandingGlass({className}: {className?: string}) {
  const {paused} = useContext(MotionContext);
  return <GlassField variant="hero" paused={paused} className={className} />;
}

/** The call to action's turning vault, stopped with the rest of the page. */
export function LandingVault({className}: {className?: string}) {
  const {paused} = useContext(MotionContext);
  return <Vault3D className={className} paused={paused} />;
}

/* --- Motion hooks ------------------------------------------------------------ */

/**
 * Reveal-on-scroll, once, for anything marked `data-reveal`.
 *
 * Rendered visible and only hidden here, after hydration, and only if it is
 * still below the fold. So the page is whole without JavaScript, whole for
 * anyone who asked for reduced motion, and never blinks out content that is
 * already on screen.
 */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scope = root.current;
    if (!scope || !("IntersectionObserver" in window) || prefersReducedMotion()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          observer.unobserve(entry.target);
        }
      },
      {rootMargin: "0px 0px -10% 0px", threshold: 0.1},
    );
    const fold = window.innerHeight * 0.9;
    for (const target of scope.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (target.getBoundingClientRect().top < fold) continue;
      target.dataset.reveal = "waiting";
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, [root]);
}

/** Sets or clears a presence-only data attribute, as React renders `data-x={true | undefined}`. */
function mark(el: HTMLElement, key: string, on: boolean) {
  if (on) el.dataset[key] = "true";
  else delete el.dataset[key];
}

/**
 * Which capability row is in the middle of the viewport. Until a row first
 * reaches the middle, nothing is marked, which the CSS reads as "every row at
 * full contrast", and that stays so for anyone who asked for reduced motion.
 *
 * Written straight to the server's markup (`data-row` rows, `data-fact` facts):
 * the list `data-live`, the row in the middle `data-active`, and only its fact
 * `data-on` (every fact is `data-on` as served).
 */
function useActiveRow(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scope = root.current;
    if (!scope || !("IntersectionObserver" in window) || prefersReducedMotion()) return;
    const rows = [...scope.querySelectorAll<HTMLElement>("[data-row]")];
    const facts = [...scope.querySelectorAll<HTMLElement>("[data-fact]")];
    const list = rows[0]?.parentElement;
    if (!list) return;
    const show = (active: number) => {
      mark(list, "live", true);
      rows.forEach((row, i) => mark(row, "active", i === active));
      facts.forEach((fact, i) => mark(fact, "on", i === active));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) show(rows.indexOf(entry.target as HTMLElement));
        }
      },
      {rootMargin: "-42% 0px -42% 0px"},
    );
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [root]);
}

/** CSS's cubic-bezier() as a function of progress, so a script can keep time with a stylesheet. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number) => (t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const x = curve(x1, x2), y = curve(y1, y2);
  return (progress: number) => {
    let lo = 0, hi = 1, t = progress;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (x(t) < progress) lo = t;
      else hi = t;
    }
    return y(t);
  };
}

/** The chart's reveal: the same curve as the drawings' (`--ease-draw`). */
const DRAW_EASE = cubicBezier(0.65, 0, 0.35, 1);
const WIPE_DELAY = 350;
const WIPE_TIME = 2400;

/**
 * The drawings: draw-in on scroll, loops only while they are seen.
 *
 * Every `[data-draw]` element is finished and still in the server HTML. After
 * hydration, one below the fold becomes `waiting` (its strokes masked out) and
 * then `in` when it is scrolled into view, which draws it and starts its idle
 * loop; one already on screen becomes `live` (loop only). `[data-loop]` marks
 * an element with loops but no draw-in (the hero's trace, the vault). Every one
 * of them carries `data-visible`, which the stylesheets read to pause their
 * loops off screen. Nothing here runs for anyone who asked for reduced motion.
 *
 * The chart card draws in from a script instead, because its figure counts
 * along with the line: the wipe, the scan line and the figure share one clock
 * and one curve, so the figure is always the value under the scan line.
 */
function useDrawings(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scope = root.current;
    if (!scope || !("IntersectionObserver" in window) || prefersReducedMotion()) return;
    const frames = new Set<number>();

    const counter = (el: HTMLElement) => {
      const count = el.querySelector<HTMLElement>("[data-count]");
      const series = count?.dataset.count?.split(" ").map(Number) ?? [];
      return {
        count,
        at: (p: number) => {
          const x = p * (series.length - 1), i = Math.min(series.length - 2, Math.floor(x));
          return series[i]! + (series[i + 1]! - series[i]!) * (x - i);
        },
      };
    };

    const playChart = (el: HTMLElement) => {
      const wipe = el.querySelector<SVGElement>("[data-wipe]");
      const scan = el.querySelector<SVGElement>("[data-scan]");
      const width = Number(scan?.dataset.scan ?? 0);
      const {count, at} = counter(el);
      if (!wipe || !count) return;
      let begin = 0;
      const step = (now: number) => {
        begin ||= now;
        const linear = Math.min(1, Math.max(0, (now - begin - WIPE_DELAY) / WIPE_TIME));
        const p = DRAW_EASE(linear);
        wipe.style.transform = `scaleX(${p.toFixed(4)})`;
        if (scan) {
          scan.style.transform = `translateX(${(p * width).toFixed(2)}px)`;
          scan.style.opacity = linear > 0 && linear < 1 ? String(Math.min(1, (1 - linear) * 6, linear * 12)) : "0";
        }
        count.textContent = money.format(Math.round(at(p) * 100) / 100);
        if (linear < 1) frames.add(requestAnimationFrame(step));
      };
      frames.add(requestAnimationFrame(step));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          el.dataset.visible = String(entry.isIntersecting);
          if (entry.isIntersecting && el.dataset.draw === "waiting") {
            el.dataset.draw = "in";
            if (el.querySelector("[data-wipe]")) playChart(el);
          }
        }
      },
      {rootMargin: "0px 0px -12% 0px", threshold: 0.15},
    );
    const fold = window.innerHeight * 0.88;
    for (const el of scope.querySelectorAll<HTMLElement>("[data-draw], [data-loop]")) {
      if (el.hasAttribute("data-draw")) {
        const r = el.getBoundingClientRect();
        const seen = r.top < fold && r.bottom > 0;
        el.dataset.draw = seen ? "live" : "waiting";
        const {count} = counter(el);
        if (!seen && count) count.textContent = money.format(0);
      }
      observer.observe(el);
    }

    // A hidden tab draws nothing anyway; this also holds the loops' place.
    const tab = () => {
      if (document.hidden) scope.dataset.tab = "hidden";
      else delete scope.dataset.tab;
    };
    document.addEventListener("visibilitychange", tab);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", tab);
      frames.forEach((f) => cancelAnimationFrame(f));
    };
  }, [root]);
}

/** Splits the statement into words whose contrast follows the scroll. */
export function RevealText({text, className}: {text: string; className: string}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = text.split(" ");
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const start = window.innerHeight * 0.88;
      const end = window.innerHeight * 0.3;
      const progress = (start - r.top) / (start - end + r.height * 0.6);
      el.style.setProperty("--p", Math.min(1, Math.max(0, progress)).toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    el.dataset.live = "true";
    update();
    window.addEventListener("scroll", schedule, {passive: true});
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <p ref={ref} className={className} style={{"--n": words.length} as CSSProperties}>
      <span className={styles.srOnly}>{text}</span>
      <span aria-hidden="true">
        {words.map((word, i) => (
          <span key={i} style={order(i)}>
            {word}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </p>
  );
}
