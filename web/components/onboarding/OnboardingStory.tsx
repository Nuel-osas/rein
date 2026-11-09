"use client";

import Link from "next/link";
import {useEffect, useRef, useState} from "react";
import {Brand} from "@/components/Brand";
import {IconAlert, IconCheck, IconClock} from "@/components/app/Icons";
import {GlassField} from "@/components/marketing/GlassField";
import styles from "./OnboardingStory.module.css";

/* ===========================================================================
   The sign-in story panel: what Rein does, shown rather than drawn.

   Three example payments play over the moving glass, each checked against the
   spender's own rules: one inside its limits and paid, one for a service not
   on its list and sent to the owner, who approves it, and one small payment
   that simply goes. That is the whole product in about ten seconds.

   ILLUSTRATIVE, and it says so to assistive technology: the moving cards are
   one labelled image, not live data. The services are Rein's real 0G services
   (ai-claude is not on the demo agent's list); the amounts are typical quotes.

   Motion: the story steps through React state (each change is a CSS transition,
   interruptible), only while on screen and in a visible tab. A pause button
   appears on keyboard focus, and anyone who asked for reduced motion sees the
   finished story, still.
   Without JavaScript it renders finished, too.
   =========================================================================== */

type Tone = "checking" | "ok" | "paid" | "over" | "owner";

interface Status {
  tone: Tone;
  label: string;
}

interface Payment {
  who: string;
  role: string;
  to: string;
  amount: string;
  /** First step this card is on screen. */
  from: number;
  /** The status at each step from `from` on; the last one holds. */
  statuses: Status[];
}

const CHECKING: Status = {tone: "checking", label: "Checking the rules"};

const PAYMENTS: Payment[] = [
  {
    who: "Research agent",
    role: "AI agent",
    to: "ai-chat",
    amount: "$0.01",
    from: 0,
    statuses: [CHECKING, {tone: "ok", label: "Within limits"}, {tone: "paid", label: "Paid"}],
  },
  {
    who: "Research agent",
    role: "AI agent",
    to: "ai-claude",
    amount: "$0.01",
    from: 2,
    statuses: [
      CHECKING,
      {tone: "over", label: "Not on its list"},
      {tone: "owner", label: "Held for the owner"},
      {tone: "paid", label: "Approved and settled"},
    ],
  },
  {
    who: "Ada",
    role: "Operations",
    to: "ai-image",
    amount: "$0.02",
    from: 6,
    statuses: [CHECKING, {tone: "paid", label: "Paid"}],
  },
];

/** Steps in one loop; the last two hold the finished story, then it starts again. */
const STEPS = 11;
/** The finished story: what reduced motion and the server render show. */
const FINISHED = 8;
const STEP_MS = 1_400;

function statusAt(payment: Payment, step: number): Status | null {
  if (step < payment.from) return null;
  return payment.statuses[Math.min(step - payment.from, payment.statuses.length - 1)] ?? null;
}

function StatusIcon({tone}: {tone: Tone}) {
  if (tone === "checking") return <span className={styles.pulse} aria-hidden="true" />;
  if (tone === "over") return <IconAlert />;
  if (tone === "owner") return <IconClock />;
  return <IconCheck />;
}

export function OnboardingStory() {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(FINISHED);
  const [paused, setPaused] = useState(false);
  const [moving, setMoving] = useState(false);

  // Runs only when motion is allowed, the panel is on screen, the tab is visible and nobody paused it.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => setMoving(visible && !document.hidden && !reduce.matches);
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      update();
    }, {threshold: 0.15});
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    reduce.addEventListener("change", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  const running = moving && !paused;
  const started = useRef(false);
  useEffect(() => {
    if (!running) return;
    // The first time it runs, the story starts from the beginning rather than its finished state.
    if (!started.current) {
      started.current = true;
      setStep(0);
    }
    const timer = window.setInterval(() => setStep((s) => (s + 1) % STEPS), STEP_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const leaving = step >= STEPS - 1;

  return (
    <section ref={ref} className={styles.story} aria-labelledby="onboarding-story" data-onboarding-story>
      <GlassField variant="panel" paused={!running} className={styles.glass} />
      <Link className={styles.brand} href="/" aria-label="Rein home"><Brand /></Link>
      <div className={styles.content}>
        <span className={styles.eyebrow}>Spending rules on Solana</span>
        <h2 id="onboarding-story">Agents that pay.<br />Limits that hold.</h2>
        <div
          className={styles.feed}
          role="img"
          aria-label="An example: three payments checked against each spender's rules. Two are paid within their limits; one is for a service not on the agent's list, goes to the owner and is approved. Illustrative, not live data."
          data-leaving={leaving}
        >
          {PAYMENTS.map((payment, i) => {
            const status = statusAt(payment, leaving ? FINISHED : step);
            return (
              <div key={i} className={styles.card} data-shown={status !== null && !leaving} aria-hidden="true">
                <span className={styles.avatar}>{payment.who.slice(0, 1)}</span>
                <span className={styles.what}>
                  <strong>{payment.who} <small>{payment.role}</small></strong>
                  <span>{payment.to}</span>
                </span>
                <span className={styles.side}>
                  <span className={styles.amount}>{payment.amount}</span>
                  {status ? (
                    <span key={status.label} className={styles.status} data-tone={status.tone}>
                      <StatusIcon tone={status.tone} />
                      {status.label}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        <p>One vault for your people<br />and your AI agents.</p>
      </div>
      {/* Kept for keyboard users (WCAG 2.2.2), shown only while focused: the panel carries no
          visible controls of its own. Reduced motion stops everything without it. */}
      <button type="button" className={styles.motion} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
        {paused ? "Play motion" : "Pause motion"}
      </button>
    </section>
  );
}
