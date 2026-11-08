import type {ReactNode} from "react";

import {IconCheck, IconShield} from "./Icons";
import {Section} from "./Section";
import styles from "./RefusalFlow.module.css";

/* ===========================================================================
   What happens between an agent being asked and the money moving.

   The page's claim is that the agent proposes and only the program authorizes.
   That is an assertion until somebody can see the checks, count them, and see
   which ones are allowed to say no. So this is a diagram of a Rein payment in
   the order the code runs it: the agent's tool call (agent/src/tools.ts), the
   sponsor (web/app/api/sponsor/route.ts), then the program, where Anchor
   checks the accounts (the registry entry, the payee, the payment record's
   address) before the body of `pay` checks the policy. Every stage ends with a
   line saying what it refuses, and three of the five answer with something
   rather than "nothing".

   WHY THE CONNECTORS ARE SVG AND EVERYTHING ELSE IS NOT

   Every word here is real DOM text in an ordered list, so it is selectable,
   searchable, wraps at the reader's font size, and reads in order to a screen
   reader without a parallel description that can drift from the picture.

   The SVG does the one job HTML cannot: drawing the path. The arrows between
   stages are fixed 20px glyphs sitting in the gap, rotated 90deg in the stacked
   layout. The fork below is drawn with `<line>` under
   `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"`, so
   stretching it to the width of the outcomes grid moves the arms to exactly 25%
   and 75% of it, where the two panels are centred, and the strokes stay 1px.

   NO MOTION AT ALL, and that is a decision rather than an omission. The only
   honest thing to animate here is a token travelling the rail, and it would
   have to pick an ending: run it to Paid and the diagram says holds are the
   unusual case, run it to Held and it says the opposite.
   =========================================================================== */

type Stage = {
  key: string;
  name: string;
  body: ReactNode;
  /** What this stage refuses, completing the sentence "Refuses ...". Every stage has one. */
  refuses: ReactNode;
  /** Whether a payment can actually leave the rail here. A flag, so the glyph never depends on the copy. */
  exits: boolean;
  /** The policy's hold is the amber ending, so its mark is amber as well. */
  amber?: true;
};

const STAGES: readonly Stage[] = [
  {
    key: "task",
    name: "The task",
    body: (
      <>
        <span className={styles.quote}>
          “We need the premium historical order-book dataset today. Buy it at its list price.”
        </span>{" "}
        Typed by you to the agent.
      </>
    ),
    refuses: <>nothing. Nothing has been looked at yet.</>,
    exits: false,
  },
  {
    key: "agent",
    name: "The agent",
    body: (
      <>
        Its three tools are <code>list_services</code>, <code>check_budget</code> and{" "}
        <code>pay</code>, and the last takes a service id, an amount and a memo. There is no address
        field, and an extra field is dropped, not used.
      </>
    ),
    refuses: <>nothing. It proposes, and that is all it does.</>,
    exits: false,
  },
  {
    key: "sponsor",
    name: "The sponsor",
    body: (
      <>
        It pays the fee and the record’s rent, so the agent holds no SOL. From a browser, the relay
        co-signs only Rein’s instructions, with itself only as fee payer.
      </>
    ),
    refuses: <>another program, the sponsor in any other seat, a missing signature. Nothing sent.</>,
    exits: true,
  },
  {
    key: "registry",
    name: "The registry",
    body: (
      <>
        The service id must have an account on chain, and the payee must be the one it names. The
        payment record’s address comes from the spender and the intent.
      </>
    ),
    refuses: <>an unregistered service, any other payee, an intent already used. No money moved.</>,
    exits: true,
  },
  {
    key: "policy",
    name: "The policy",
    body: (
      <>
        A paused team or spender, a revoked one, an expired policy or a suspended service is
        refused. Then the cap, the allowance, the count and the allowed services.
      </>
    ),
    refuses: <>a stop outright, and holds anything over a limit. No money moved.</>,
    exits: true,
    amber: true,
  },
];

/**
 * The rail arrow. One square glyph, rotated by CSS in the stacked layout, so
 * there is never a second copy of it to keep pointing the right way.
 */
function ArrowGlyph({className}: {className?: string}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <path d="M4 12h14" />
      <path d="m13 7 5 5-5 5" />
    </svg>
  );
}

/**
 * The mark on a layer that can refuse: a branch leaving the rail and ending in
 * a dot.
 *
 * A dot rather than a cross, and no triangle anywhere. This page argues that a
 * refused request is the account doing its job, and a glyph borrowed from an
 * error dialog would contradict the sentence sitting next to it. The colour is
 * `currentColor`, so the amber foot on the policy layer tints the mark too.
 */
function ExitGlyph({className}: {className?: string}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <path d="M6 3v9a4 4 0 0 0 4 4h5" />
      <circle cx="17" cy="16" fill="currentColor" r="2" stroke="none" />
    </svg>
  );
}

/**
 * The mark on a layer that cannot refuse: the rail carrying straight on.
 *
 * It is the same opening stroke as the branch above it and then no branch,
 * which is the whole difference between the two stages and the three. Quieter
 * ink, because "nothing leaves here" is the unremarkable case.
 */
function PassGlyph({className}: {className?: string}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <path d="M6 3v18" />
    </svg>
  );
}

export function RefusalFlow() {
  return (
    <Section
      id="payment-path"
      eyebrow="The payment path"
      title="Five steps between a task and a payment."
      lede="The agent names a service and states an amount. That is the whole of its power. Everything after it is a check the agent cannot reach, and three of them can refuse on their own. Being held is not an error, which is why one of the two endings is amber and neither is red."
    >
      <figure className={styles.flow}>
        {/* The shape of the picture, for somebody who is getting it as a list.
            The stages themselves are real list items below, so this says what
            the arrows say and nothing the text already says. */}
        <p className={styles.srOnly}>
          Five stages in order, then two endings. The sponsor, the registry and the policy can each
          refuse on their own, and no stage trusts the answer of the one before it.
        </p>

        {/* One frosted panel holding five wells. The wells are sunken rather
            than raised because a check is laid into the machine, not stacked on
            top of it, and because a white card on a near white glass panel has
            no edge left to find in the light scheme. */}
        <div className={styles.plinth}>
          <ol className={styles.stages}>
            {STAGES.map((stage, index) => (
              <li className={styles.stage} key={stage.key}>
                {index > 0 ? <ArrowGlyph className={styles.connector} /> : null}

                <div className={styles.stageBody}>
                  {/* Head and text are separate boxes so the middle widths can
                      set them side by side. A full-width cell at 900px ran the
                      body to about 110 characters a line, which is well past
                      the 60 to 75 a line anybody reads comfortably. */}
                  <div className={styles.stageHead}>
                    <span className={`eyebrow figure ${styles.index}`} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className={styles.stageName}>{stage.name}</h3>
                  </div>
                  <p className={styles.stageText}>{stage.body}</p>
                </div>

                <p className={`${styles.foot} ${stage.amber ? styles.footHeld : ""}`}>
                  {stage.exits ? (
                    <ExitGlyph className={styles.mark} />
                  ) : (
                    <PassGlyph className={`${styles.mark} ${styles.markPass}`} />
                  )}
                  <span>
                    <span className={styles.footLabel}>Refuses</span> {stage.refuses}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </div>

        <p className={`eyebrow ${styles.forkLabel}`}>Two endings</p>

        {/* Wide layout: the fork, stretched to the width of the outcomes grid. */}
        <svg
          aria-hidden="true"
          className={styles.rake}
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 100 40"
        >
          <line
            className={styles.rakeStem}
            vectorEffect="non-scaling-stroke"
            x1="50"
            x2="50"
            y1="0"
            y2="20"
          />
          <line
            className={styles.rakeStem}
            vectorEffect="non-scaling-stroke"
            x1="25"
            x2="75"
            y1="20"
            y2="20"
          />
          <line
            className={styles.rakePaid}
            vectorEffect="non-scaling-stroke"
            x1="25"
            x2="25"
            y1="20"
            y2="40"
          />
          <line
            className={styles.rakeHeld}
            vectorEffect="non-scaling-stroke"
            x1="75"
            x2="75"
            y1="20"
            y2="40"
          />
        </svg>

        {/* Narrow layout: the two endings stack, so a fork would have both arms
            landing on the first panel. One arrow instead, which points at the
            thing that is actually next. */}
        <ArrowGlyph className={styles.stem} />

        <ul className={styles.endings}>
          <li className={`${styles.ending} ${styles.paid}`}>
            <span className={`${styles.badge} ${styles.badgePaid}`}>
              <IconCheck />
              Paid
            </span>
            <p className={styles.endingHead}>
              <span className="figure">0.40</span> USDC to web-search.
            </p>
            <p className={styles.endingBody}>
              Settled from the team’s vault in the same transaction, to the payee the registry names.
              The record keeps the amount, the intent and the memo.
            </p>
          </li>

          <li className={`${styles.ending} ${styles.held}`}>
            <span className={`${styles.badge} ${styles.badgeHeld}`}>
              <IconShield />
              Held for the owner
            </span>
            <p className={`${styles.endingHead} ${styles.endingHeadHeld}`}>
              Nothing moved, and nothing failed.
            </p>
            <p className={styles.endingBody}>
              Filed as Pending with every reason it went over. The owner has 24 hours to approve it,
              which settles it in one transaction, or to decline it. Neither answer leaves a payment
              half done.
            </p>
          </li>
        </ul>

        <figcaption className={styles.caption}>
          A diagram of the path a payment takes, not a screenshot. No step here trusts the answer of
          the one before it.
        </figcaption>
      </figure>
    </Section>
  );
}
