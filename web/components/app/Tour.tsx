"use client";

// The first-visit tour: the page dims behind a spotlight on one thing at a time, the thing gets a
// dashed outline, and a card beside it says what it is in plain words, with a trace line from the
// card to it. Steps whose target is not laid out when the tour starts are dropped (a phone has no
// sidebar, a viewer has no claim card), so the count is what this screen actually has.
//
// No library: the spotlight and the card are placed with getBoundingClientRect and re-placed on
// resize and scroll. Esc closes it, focus moves into the card and stays there, and motion is off
// under prefers-reduced-motion.

import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState} from "react";
import a11y from "./a11y.module.css";
import styles from "./Tour.module.css";

/** `side` is where the card would rather sit, when it fits there; otherwise the roomiest side. */
export type TourStep = {target: string; title: string; body: string; side?: Side};

/** Rein's tour, in order. `target` is the `data-tour` attribute it points at. */
export const REIN_TOUR: TourStep[] = [
  {target: "claim", title: "Claim your $0.30", body: "Free devnet test USDC to try Rein, once per account. It lands in your team's vault."},
  {target: "vault", title: "Your team's vault", body: "Money only leaves through a payment, your approval, or your withdraw."},
  {target: "team", title: "Add people and agents", body: "Each one gets its own spending rules: how much, how often, and what it can pay for."},
  {target: "compute", title: "Let your AI agent work", body: "It buys AI runs from the vault, inside the budget you set."},
  {target: "approvals", title: "Approve what goes over", body: "Anything over a limit waits here for one tap. Nothing moves until you say so."},
  {target: "activity", title: "See every payment", body: "Each payment has a receipt and a link to the chain."},
  {target: "settings", title: "One switch stops everything", body: "Pause the whole team, or withdraw to your wallet."},
  // Below the "?", not beside it: beside it the line would run across the network note.
  {target: "help", title: "Lost?", body: "Replay this tour any time.", side: "below"},
];

type Rect = {x: number; y: number; w: number; h: number};
type Point = {x: number; y: number};
export type Side = "right" | "left" | "below" | "above";

/** Space between the spotlight's edge and the target. */
const PAD = 6;
const EDGE = 12;

/**
 * The first element for `target` that is laid out: the sidebar row on a laptop, the bottom-bar
 * link on a phone. Below the fold still counts (the step scrolls to it); hidden or off-canvas does not.
 */
export function findTarget(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right <= 0 || r.left >= window.innerWidth) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    return el;
  }
  return null;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return {x: r.left, y: r.top, w: r.width, h: r.height};
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where the card goes and where its line runs: on the side of the target with the most room that
 * fits the card, else inside the target's lower edge with no line (a target as big as the screen).
 */
function layout(r: Rect, vw: number, vh: number, cw: number, ch: number, prefer?: Side): {card: Point; side: Side | null; from: Point; to: Point} {
  const gap = vw < 640 ? 44 : 64;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const x = (v: number) => clamp(v, EDGE, Math.max(EDGE, vw - cw - EDGE));
  const y = (v: number) => clamp(v, EDGE, Math.max(EDGE, vh - ch - EDGE));
  const room: Record<Side, number> = {right: vw - (r.x + r.w), left: r.x, below: vh - (r.y + r.h), above: r.y};
  const fits = (s: Side) => (s === "left" || s === "right" ? room[s] >= cw + gap + EDGE : room[s] >= ch + gap + EDGE);
  const side = prefer && fits(prefer) ? prefer : ((Object.keys(room) as Side[]).sort((a, b) => room[b] - room[a]).find(fits) ?? null);
  if (side === "right" || side === "left") {
    const card = {x: side === "right" ? r.x + r.w + gap : r.x - gap - cw, y: y(cy - ch / 2)};
    const fromY = clamp(cy, card.y + 24, card.y + ch - 24);
    return {card, side, from: {x: side === "right" ? card.x : card.x + cw, y: fromY}, to: {x: side === "right" ? r.x + r.w + PAD + 3 : r.x - PAD - 3, y: cy}};
  }
  if (side === "below" || side === "above") {
    const card = {x: x(cx - cw / 2), y: side === "below" ? r.y + r.h + gap : r.y - gap - ch};
    const fromX = clamp(cx, card.x + 24, card.x + cw - 24);
    return {card, side, from: {x: fromX, y: side === "below" ? card.y : card.y + ch}, to: {x: cx, y: side === "below" ? r.y + r.h + PAD + 3 : r.y - PAD - 3}};
  }
  const card = {x: x(cx - cw / 2), y: y(r.y + r.h - ch - 24)};
  return {card, side: null, from: card, to: card};
}

/** A trace from the card to the target: an S-bend that runs straight when the two line up, and an arrowhead. */
function trace(from: Point, to: Point, side: Side): {d: string; head: string} {
  const f = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const flat = side === "left" || side === "right";
  const mid = flat ? (from.x + to.x) / 2 : (from.y + to.y) / 2;
  const c1 = flat ? {x: mid, y: from.y} : {x: from.x, y: mid};
  const c2 = flat ? {x: mid, y: to.y} : {x: to.x, y: mid};
  const dir = {right: {x: -1, y: 0}, left: {x: 1, y: 0}, below: {x: 0, y: -1}, above: {x: 0, y: 1}}[side];
  const s = 7;
  const a = {x: to.x - dir.x * s - dir.y * s * 0.7, y: to.y - dir.y * s - dir.x * s * 0.7};
  const b = {x: to.x - dir.x * s + dir.y * s * 0.7, y: to.y - dir.y * s + dir.x * s * 0.7};
  return {d: `M ${f(from)} C ${f(c1)} ${f(c2)} ${f(to)}`, head: `M ${f(a)} L ${f(to)} L ${f(b)}`};
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Tour({steps, onClose}: {steps: TourStep[]; onClose: () => void}) {
  // Filtered once, at the start: the count must not change under the reader's feet.
  const [list] = useState(() => steps.filter((s) => findTarget(s.target)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState(() => ({w: window.innerWidth, h: window.innerHeight}));
  const [cardH, setCardH] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = list[index] ?? null;
  const last = index === list.length - 1;

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    const r = el ? rectOf(el) : null;
    setRect((p) => (p && r && p.x === r.x && p.y === r.y && p.w === r.w && p.h === r.h ? p : r));
    setView((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : {w: window.innerWidth, h: window.innerHeight}));
    if (card.current) setCardH(card.current.offsetHeight);
  }, [step]);

  // A new step: bring its target on screen if it is above or below the fold, then place the card.
  useLayoutEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < EDGE || r.bottom > window.innerHeight - EDGE) el.scrollIntoView({block: "center", behavior: reducedMotion() ? "auto" : "smooth"});
    }
    measure();
  }, [step, measure]);

  // The card's own height decides where it fits, so measure again once it has drawn.
  useLayoutEffect(() => {
    if (card.current && card.current.offsetHeight !== cardH) setCardH(card.current.offsetHeight);
  });

  useEffect(() => {
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", soon);
    window.addEventListener("scroll", soon, true);
    // Data that loads above a target moves it without a resize or a scroll.
    const timer = setInterval(measure, 700);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", soon);
      window.removeEventListener("scroll", soon, true);
      clearInterval(timer);
    };
  }, [measure]);

  // Focus goes into the card on open and on every step, and back where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before && before.isConnected) before.focus({preventScroll: true});
    };
  }, []);
  useEffect(() => {
    next.current?.focus({preventScroll: true});
  }, [index]);

  const go = useCallback((n: number) => setIndex(clamp(n, 0, Math.max(0, list.length - 1))), [list.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((n) => Math.min(list.length - 1, n + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((n) => Math.max(0, n - 1));
      } else if (e.key === "Tab" && card.current) {
        // Keep Tab inside the card while the page behind it is dimmed.
        const items = Array.from(card.current.querySelectorAll<HTMLElement>("button"));
        if (!items.length) return;
        const first = items[0];
        const end = items[items.length - 1];
        const inside = card.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && (document.activeElement === end || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [list.length, onClose]);

  // Nothing on this screen to point at: close rather than leave an invisible dialog open.
  useEffect(() => {
    if (!list.length) onClose();
  }, [list.length, onClose]);

  if (!step) return null;

  const cw = Math.min(320, view.w - EDGE * 2);
  const ch = cardH || 200;
  const placed = rect ? layout(rect, view.w, view.h, cw, ch, step.side) : null;
  const pos = placed ? placed.card : {x: (view.w - cw) / 2, y: Math.max(EDGE, (view.h - ch) / 2)};
  const line = placed && placed.side ? trace(placed.from, placed.to, placed.side) : null;
  const advance = () => (last ? onClose() : go(index + 1));

  return (
    <div className={styles.tour} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      <div className={styles.backdrop} onClick={advance} aria-hidden="true" data-plain={rect ? undefined : ""} />
      {rect ? (
        <div
          className={styles.spot}
          aria-hidden="true"
          style={{left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2}}
        />
      ) : null}
      {line ? (
        <svg className={styles.line} aria-hidden="true" key={`line-${index}`}>
          <path d={line.d} pathLength={1} className={styles.trace} />
          <path d={line.head} className={styles.head} />
          <rect x={placed!.from.x - 2.5} y={placed!.from.y - 2.5} width={5} height={5} className={styles.datum} />
        </svg>
      ) : null}
      <div
        ref={card}
        className={styles.card}
        style={{left: pos.x, top: pos.y, width: cw, maxHeight: view.h - EDGE * 2}}
        data-ready={cardH ? "" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.top}>
          <span className={styles.count}>
            {index + 1} / {list.length}
          </span>
          <button type="button" className={styles.skip} onClick={onClose}>
            Skip tour
          </button>
        </div>
        <h2 className={styles.title} id={titleId}>
          {step.title}
        </h2>
        <p className={styles.body} id={bodyId}>
          {step.body}
        </p>
        <div className={styles.foot}>
          <span className={styles.dots} aria-hidden="true">
            {list.map((s, n) => (
              <span key={s.target} className={styles.dot} data-on={n === index ? "" : undefined} />
            ))}
          </span>
          {index > 0 ? (
            <button type="button" className={styles.back} onClick={() => go(index - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" ref={next} className={styles.next} onClick={advance}>
            {last ? "Done" : "Next →"}
          </button>
        </div>
        <p className={a11y.srOnly} aria-live="polite">{`Step ${index + 1} of ${list.length}: ${step.title}`}</p>
      </div>
    </div>
  );
}
