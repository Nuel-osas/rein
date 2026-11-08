"use client";

// "Get started" at the top of Home, for the owner only: six first steps, each ticked from real
// state (the claim card's own claimed state, the team's spenders and payments, and one flag the
// agent's page sets in this browser). A step that could not be read shows "—" and is not counted.
// "Hide" puts it away in this browser; it also goes away by itself once all six are done.

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {findReinAgent} from "@/lib/agent-setup";
import {budgetSeenKey, getStartedSteps, hiddenKey, progressOf, readFlag, writeFlag, type Step} from "@/lib/get-started";
import {pda} from "@/lib/rein";
import a11y from "../a11y.module.css";
import {useTeamPage} from "./context";
import styles from "./GetStarted.module.css";

export function GetStarted({claimed}: {claimed: boolean | null}) {
  const t = useTeamPage();
  // null until this browser's flags are read, so a hidden card never flashes in.
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [budgetSeen, setBudgetSeen] = useState<boolean | null>(null);
  const aiChat = useMemo(() => pda.service("ai-chat").toBase58(), []);

  useEffect(() => {
    setHidden(readFlag(hiddenKey(t.address)) === true);
    setBudgetSeen(readFlag(budgetSeenKey(t.address)));
  }, [t.address]);

  if (!t.isOwner || hidden !== false) return null;
  const steps = getStartedSteps({
    base: t.base,
    claimed,
    budgetSeen,
    agentAddress: findReinAgent(t.spenders, null)?.address ?? null,
    spenders: t.spenders,
    payments: t.payments,
    aiChatService: aiChat,
  });
  if (progressOf(steps).complete) return null;
  return (
    <GetStartedCard
      steps={steps}
      onHide={() => {
        writeFlag(hiddenKey(t.address));
        setHidden(true);
      }}
    />
  );
}

/** The card itself, from steps alone, so it renders the same in a preview as on Home. */
export function GetStartedCard({steps, onHide}: {steps: Step[]; onHide: () => void}) {
  const {done, total} = progressOf(steps);
  return (
    <section className={styles.card} aria-labelledby="get-started-title">
      <div className={styles.head}>
        <h2 className={styles.title} id="get-started-title">
          Get started
        </h2>
        <span className={styles.count}>
          {done} of {total} done
        </span>
        <button type="button" className={styles.hide} onClick={onHide}>
          Hide
        </button>
      </div>
      <div className={styles.bar} role="progressbar" aria-label="Get started" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} done`}>
        <span className={styles.fill} style={{inlineSize: `${(done / total) * 100}%`}} />
      </div>
      <ol className={styles.list}>
        {steps.map((s) => (
          <li key={s.id} className={styles.item} data-state={s.done === true ? "done" : s.done === null ? "unknown" : "todo"}>
            <span className={styles.mark} aria-hidden="true">
              {s.done === true ? "✓" : s.done === null ? "—" : ""}
            </span>
            <StepLabel step={s} />
            <span className={a11y.srOnly}>{s.done === true ? ", done" : s.done === null ? ", not known yet" : ", to do"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepLabel({step}: {step: Step}) {
  if (!step.href) return <span className={styles.label}>{step.label}</span>;
  // An in-page anchor (the claim card further down Home) is a plain link, not a route change.
  if (step.href.startsWith("#")) {
    return (
      <a href={step.href} className={styles.label}>
        {step.label}
      </a>
    );
  }
  return (
    <Link href={step.href} className={styles.label}>
      {step.label}
    </Link>
  );
}
