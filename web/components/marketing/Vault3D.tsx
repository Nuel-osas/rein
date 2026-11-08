"use client";

import {useEffect, useRef} from "react";
import styles from "./Vault3D.module.css";
import {build, DEG, H, opacity, type Pose, REST, W} from "./vaultGeometry";

/* ===========================================================================
   The vault in the dark call to action, as a real wireframe object.

   A safe on a base, its thick door hung on two hinges and standing a few
   degrees open, three bolts on the door's edge, a handle wheel with three
   spokes, a combination dial, and inside a shelf, a drawer and the core box,
   all in line: nothing in it is filled or lit.

   It is built in 3D and seen through a perspective camera, and drawn the way a
   technical drawing is: an edge in view is a solid line, brighter the nearer
   it is; an edge the solid hides is a fine dashed line; anything inside the
   closed walls is dotted. Which is which is worked out every frame from the
   faces either side of the edge, so it stays true as the vault turns.

   The server renders the rest pose, so the drawing is whole without
   JavaScript and for anyone who asked for reduced motion. In motion, one
   requestAnimationFrame writes the paths' attributes directly (no React state):
   the vault turns, a full turn every 34 seconds, and leans toward the pointer;
   the wheel and the dial turn; and the first time it is scrolled into view its
   lines come up base first while the door swings open and settles. The loop runs only while the
   vault is on screen, the tab is visible and the page's motion is not paused.
   =========================================================================== */


const RESTING = build(REST);

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Decoration: hidden from assistive technology, never focusable, never a target. */
export function Vault3D({className, paused = false}: {className?: string; paused?: boolean}) {
  const svg = useRef<SVGSVGElement>(null);
  const pausedRef = useRef(paused);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    pausedRef.current = paused;
    wake.current();
  }, [paused]);

  useEffect(() => {
    const el = svg.current;
    if (!el || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    const paths = [...el.querySelectorAll<SVGPathElement>("[data-seg]")];

    // Below the fold at hydration: start closed and undrawn, and play the entrance on first sight.
    // Already on screen: no entrance, just carry on from the rest pose.
    const rect = el.getBoundingClientRect();
    let intro = rect.top > window.innerHeight * 0.9 ? 0 : Infinity;
    let started = intro === Infinity;
    let clock = 0, last = 0, raf = 0, visible = false;
    // The pointer, eased: where it is, and where the vault is leaning.
    const aim = {x: 0, y: 0}, lean = {x: 0, y: 0};

    const draw = (pose: Pose, fadeAt: (i: number) => number) => {
      const {segs} = build(pose);
      segs.forEach((s, i) => {
        const p = paths[i];
        if (!p) return;
        p.setAttribute("d", s.d);
        if (p.dataset.k !== s.k) p.dataset.k = s.k;
        p.setAttribute("stroke-opacity", opacity(s, fadeAt(i)));
      });
    };

    const poseAt = (t: number, opening: number): Pose => {
      // An underdamped spring: the door swings a little past its rest and settles there.
      const swing = opening === Infinity ? 1 : 1 - Math.exp(-2.6 * opening) * (Math.cos(4.4 * opening) + (2.6 / 4.4) * Math.sin(4.4 * opening));
      return {
        // One full turn every 34 seconds, always moving.
        yaw: REST.yaw + (2 * Math.PI * t) / 34 + lean.x * 9 * DEG,
        pitch: REST.pitch + 2.5 * DEG * Math.sin((2 * Math.PI * t) / 37 + 1.3) + lean.y * 5 * DEG,
        door: REST.door * swing,
        wheel: REST.wheel + 46 * DEG * Math.sin((2 * Math.PI * t) / 16),
        dial: 150 * DEG * Math.sin((2 * Math.PI * t) / 21) + 35 * DEG * Math.sin((2 * Math.PI * t) / 8.5),
      };
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      if (intro !== Infinity) intro += dt;
      lean.x += (aim.x - lean.x) * Math.min(1, dt * 2.2);
      lean.y += (aim.y - lean.y) * Math.min(1, dt * 2.2);
      // The entrance: lines come up in order over about a second and a half, the door opening
      // under them. Indices run base, body, door, inside, so it builds outside in.
      const fadeAt = intro === Infinity ? () => 1 : (i: number) => Math.min(1, Math.max(0, (intro - i * 0.011) / 0.45));
      draw(poseAt(clock, intro === Infinity ? Infinity : Math.max(0, intro - 0.5)), fadeAt);
      if (intro > 4) intro = Infinity;
      schedule();
    };
    const running = () => visible && started && !document.hidden && !pausedRef.current;
    const schedule = () => {
      if (!raf && running()) raf = requestAnimationFrame(tick);
      if (!running()) last = 0;
    };
    wake.current = schedule;

    if (!started) {
      // Hidden until it is first seen: closed door, no lines.
      draw({...REST, door: 0}, () => 0);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible && !started) started = true;
        schedule();
      },
      {rootMargin: "0px 0px -15% 0px", threshold: 0.2},
    );
    observer.observe(el);

    // Lean toward the pointer, on devices that have one.
    const host = el.closest("section") ?? el;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      aim.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.9)));
      aim.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 0.9)));
    };
    const onLeave = () => {
      aim.x = 0;
      aim.y = 0;
    };
    if (fine) {
      host.addEventListener("pointermove", onMove as EventListener, {passive: true});
      host.addEventListener("pointerleave", onLeave);
    }
    document.addEventListener("visibilitychange", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", schedule);
      host.removeEventListener("pointermove", onMove as EventListener);
      host.removeEventListener("pointerleave", onLeave);
      wake.current = () => {};
    };
  }, []);

  return (
    <svg ref={svg} className={[styles.vault, className].filter(Boolean).join(" ")} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" fill="none" data-loop="">
      <g stroke="#ffffff" strokeLinecap="butt" strokeLinejoin="round">
        {RESTING.segs.map((s, i) => (
          <path key={i} data-seg="" data-k={s.k} d={s.d} strokeOpacity={opacity(s)} className={styles.seg} />
        ))}
      </g>
    </svg>
  );
}
