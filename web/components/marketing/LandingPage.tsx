import Link from "next/link";
import {type CSSProperties, type ReactNode, useId} from "react";
import {BrandMark} from "@/components/Brand";
import {ArrowGlyph, Drawing, type DrawingName, PlusGlyph} from "./Drawings";
import {APP_HREF, APP_ROUTES, DEMO_HREF} from "./routes";
import {HERO_ORG_SUMMARY, HeroOrg} from "./HeroOrg";
import {LandingGlass, LandingMotion, LandingVault, MotionToggle, RevealText} from "./LandingMotion";
import styles from "./LandingPage.module.css";
import {LiveFacts, LiveNews} from "./LiveFacts";

/* ===========================================================================
   The landing page.

   Eight parts, in order: the hero over the moving glass; how it works; one payment
   step by step; the capabilities, one row at a time; a dark
   framed call to action; the policy layer, revealed word by word; questions;
   and the site footer (SiteFooter).

   A server component. The copy, the drawings and the answers that depend on
   the network are rendered here and never shipped as JavaScript; only the
   motion is (`LandingMotion.tsx`). Every motion is opt-in after hydration and
   skipped for anyone who asked for reduced motion: the server HTML is the
   whole page, fully visible.
   =========================================================================== */

/* --- Content ---------------------------------------------------------------- */

const STEPS: ReadonlyArray<{title: string; body: string; drawing: DrawingName}> = [
  {title: "A key that holds no money", body: "An agent is a keypair with nothing in it. The USDC stays in the team vault, and every payment is checked against the agent’s own Spender account.", drawing: "vault"},
  {title: "Services, never addresses", body: "pay takes a registered service. The payee must match the on-chain registry, so a prompt-injected agent cannot name an address.", drawing: "nodes"},
  {title: "Over a limit, it waits for you", body: "pay files a Pending payment in the same transaction. Your approve re-checks the hard stops and settles it in one transaction.", drawing: "shield"},
];

/** Cumulative spend across one example period, in dollars, against a $2,000 allowance. */
const SPEND = [0, 60, 120, 260, 300, 470, 520, 700, 760, 940, 1080, 1200, 1300, 1440];
const ALLOWANCE = 2000;

const ROWS = [
  {
    id: "agents",
    tag: "Agents",
    title: ["Agents pay", "inside the rules"],
    body: "Give an AI agent its own key, allowance, per-payment cap, payment count, expiry and list of services. The Rein program checks every payment it signs, and the key holds no money of its own.",
  },
  {
    id: "people",
    tag: "People",
    title: ["One shared", "vault"],
    body: "The team’s test USDC sits in one vault owned by a program address, not a person. Teammates pay from their own wallets, each under a policy only the owner can change.",
  },
  {id: "control", tag: "Control", title: ["An exception is", "your decision"], body: "Over a limit, the payment is filed on chain as Pending and the money stays put. Approve it and it settles in one transaction; decline it and nothing moves."},
  {id: "receipts", tag: "Receipts", title: ["One intent,", "one payment"], body: "Each payment is an account at an address derived from the spender and its intent, so the same intent can never be paid twice, and every one is on the explorer."},
  {
    id: "solana",
    tag: "Solana",
    title: ["Settled on", "Solana"],
    body: "A payment lands in under a second and costs a fraction of a cent. A separate fee payer covers it, so people and agents never need to hold SOL.",
  },
] as const;



const STATEMENT =
  "Agents can already hold money. What nobody could do was trust them with it. Rein moves that trust out of the prompt and into a Solana program: a key that holds nothing, rules checked on every payment, and a person who decides anything outside them.";

const REASONS: ReadonlyArray<{title: string; body: string; drawing: DrawingName}> = [
  {title: "Limits before money moves", body: "The program checks the allowance, cap, payment count, expiry, services and the team pause on every payment.", drawing: "shield"},
  {title: "Known services only", body: "The payee comes from the service registry. An agent can name a service, never an address.", drawing: "nodes"},
  {title: "Access you can take back", body: "Pause a spender or revoke it. A revoke bumps its generation, so nothing it filed before can settle.", drawing: "receipt"},
];

const WALK_FLOWS: ReadonlyArray<{
  id: string;
  title: string;
  meta: string;
  steps: ReadonlyArray<{title: string; body: string; drawing: DrawingName}>;
}> = [
  {
    id: "inside",
    title: "Inside the policy",
    meta: "One transaction",
    steps: [
      {title: "The agent signs pay", body: "pay(\u201cai-chat\u201d, $0.01, intent) for one 0G answer. Its key signs; the sponsor pays the fee.", drawing: "exchange"},
      {title: "The program checks", body: "Allowance, cap, count, expiry, services, pause, and the payee against the registry.", drawing: "shield"},
      {title: "USDC moves", body: "The vault pays the service in the same transaction and the Payment account reads Paid.", drawing: "vault"},
    ],
  },
  {
    id: "over",
    title: "Over a limit",
    meta: "Held until you decide",
    steps: [
      {title: "The agent overspends", body: "It buys ai-claude, which is not on its list. pay files a Pending payment and moves nothing.", drawing: "exchange"},
      {title: "You see it at once", body: "The reasons are decoded on the payment: over the cap, over the allowance, not on its list.", drawing: "receipt"},
      {title: "Approve, and it lands", body: "approve re-checks the hard stops and settles in one transaction, in under a second.", drawing: "vault"},
    ],
  },
];

const WALK_INTRO =
  "Every payment is one transaction against one program. Inside the policy it settles at once. Outside it, the payment waits on chain, and the only key that can release it is the owner’s.";

const WALK_FACTS = "Solana devnet · Test USDC · A separate fee payer, so spenders hold no SOL · Every figure read from chain";



const FAQ = [
  ["What is Rein?", "Rein gives teams and their AI agents spending rules on Solana. A team keeps test USDC in a vault owned by a program address, and every person and agent pays under a policy the program enforces."],
  ["Is this real money?", "No. Rein runs on Solana devnet with test USDC. The transactions are real and on chain; the balances are test funds."],
  ["Can an agent spend without limits?", "No. Its key holds no money and can only sign pay against its own Spender account. The program checks the allowance, cap, payment count, expiry, services and the team pause before anything moves."],
  ["What stops a prompt-injected agent?", "pay takes a registered service, never an address, and the payee account must match the on-chain service registry. An agent talked into paying someone else has no way to name them."],
  ["What happens over a limit?", "pay files a Pending payment account in the same transaction and moves nothing. The owner can approve it for a day; approval re-checks the hard stops and settles in one transaction."],
  ["Can the same payment go through twice?", "No. A payment’s address is derived from the spender and its intent, so a retried intent finds the account already there and the program refuses it."],
  ["Do I need SOL or a wallet?", "To look around, no: the demo team is public and the demo signs approvals on the server. To run your own team, any Solana wallet works (Phantom, Solflare, Backpack), and a separate fee payer covers the fees, so you need no SOL."],
  ["Is Rein audited?", "No. It is a hackathon build on devnet. The demo’s owner actions are signed by a disclosed server-side key."],
] as const;

/* --- Helpers ----------------------------------------------------------------- */

/** Stagger index for a revealed group. Read by the CSS as a transition delay. */
const order = (i: number) => ({"--i": i}) as CSSProperties;

const money = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});

/* --- Pieces ------------------------------------------------------------------- */

type Tone = "primary" | "dark" | "light";

/**
 * A two-part action: a label block and, beside it, a square arrow tile. The
 * primary's tile is the brand purple. `arrow={false}` is the plain secondary.
 * The app is entered with a plain anchor, so the wallet bundle is not
 * prefetched from the landing page; other pages navigate client-side.
 */
function Action({href, tone, children, arrow = true, wide = false}: {href: string; tone: Tone; children: ReactNode; arrow?: boolean; wide?: boolean}) {
  const inner = (
    <>
      <span className={styles.actionLabel}>{children}</span>
      {arrow ? (
        <span className={styles.actionTile}>
          <ArrowGlyph />
        </span>
      ) : null}
    </>
  );
  const props = {className: styles.action, "data-tone": tone, "data-wide": wide || undefined};
  return href.startsWith("/") && !APP_ROUTES.has(href) ? (
    <Link href={href} {...props}>
      {inner}
    </Link>
  ) : (
    <a href={href} {...props}>
      {inner}
    </a>
  );
}

/** The dotted rule that opens a section, with its small square. */
function Rule({tone = "light"}: {tone?: "light" | "dark"}) {
  return <div className={styles.rule} data-tone={tone} aria-hidden="true" />;
}

/** The three column guides of a light section, behind its content. */
function Guides() {
  return (
    <div className={styles.guides} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * One period's spending against its allowance. Drawn in from the left by a wipe
 * (`data-wipe`) with a scan line at its head (`data-scan`), both moved by
 * `useDrawings` (`LandingMotion.tsx`); the server HTML is the finished chart.
 */
function SpendChart() {
  const w = 400, h = 200, top = 24;
  const id = `ch${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const y = (v: number) => h - (v / ALLOWANCE) * (h - top);
  const points = SPEND.map((v, i) => `${i ? "L" : "M"}${((i / (SPEND.length - 1)) * w).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const last = SPEND[SPEND.length - 1]!;
  return (
    <div className={styles.chart} aria-hidden="true">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" x="-10" y="-10" width={w + 20} height={h + 20}>
            <rect data-wipe="" className={styles.chartWipe} x="-10" y="-10" width={w + 11} height={h + 20} fill="#fff" />
          </mask>
        </defs>
        {SPEND.map((_, i) => (
          <line
            key={i}
            x1={(i / (SPEND.length - 1)) * w}
            x2={(i / (SPEND.length - 1)) * w}
            y1={top}
            y2={h}
            className={styles.chartGrid}
            style={order(i)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line x1="0" x2={w} y1={y(ALLOWANCE)} y2={y(ALLOWANCE)} className={styles.chartLimit} vectorEffect="non-scaling-stroke" />
        <path d={points} mask={`url(#${id})`} className={styles.chartLine} vectorEffect="non-scaling-stroke" />
        <line data-scan={w} x1="0" x2="0" y1={top - 8} y2={h} className={styles.chartScan} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={styles.chartLimitLabel}>Allowance $2,000</span>
      <span className={styles.chartDot} style={{insetBlockStart: `${(y(last) / h) * 100}%`}} />
    </div>
  );
}

/* --- The page ----------------------------------------------------------------- */

export function LandingPage() {
  // `LandingMotion` is the root: one stop for every loop on the page, the glass included
  // (WCAG 2.2.2), and the scroll-driven motion over everything rendered here.
  return (
    <LandingMotion className={styles.landing}>
      {/* --- 1. Hero ---------------------------------------------------------- */}
      <section className={styles.hero} data-tone="dark" aria-labelledby="hero-title">
        <LandingGlass className={styles.heroGlass} />
        {/* For keyboard users (WCAG 2.2.2), shown only while focused. Reduced motion stops it all without this. */}
        <MotionToggle className={styles.glassControl} />

        <div className={styles.heroMain}>
          <h1 id="hero-title">
            Spending rules
            <br />
            for teams and
            <br />
            their AI agents.
          </h1>
          <p className={styles.heroSub}>
            <span>The agent asks. The program answers.</span> One vault on Solana where every person and every AI agent pays under its own limits, and anything over them waits for you.
          </p>
          <div className={styles.heroActions}>
            <Action href={APP_HREF} tone="primary">
              Open the app
            </Action>
            <Action href={DEMO_HREF} tone="dark" arrow={false} wide>
              Try the live demo
            </Action>
          </div>
        </div>

        <HeroOrg className={styles.heroOrg} />
        <p className={styles.srOnly}>{HERO_ORG_SUMMARY}</p>

        <div className={styles.heroFoot}>
          <p className={styles.builtOn}>
            <span>Built on</span> <b className={styles.chainMark}>Solana</b>
            <small>Devnet. Test USDC only.</small>
          </p>
          <LiveNews className={styles.news} metaClass={styles.newsMeta} titleClass={styles.newsTitle}>
            <span className={styles.newsTile}>
              <ArrowGlyph />
            </span>
          </LiveNews>
        </div>
      </section>

      {/* --- 2. How it works -------------------------------------------------- */}
      <section className={`${styles.light} ${styles.how}`} id="how-it-works" data-tone="light" aria-labelledby="how-title">
        <Guides />
        <div className={styles.inner}>
          <Rule />
          <div className={styles.howGrid}>
            {[1, 2, 3].map((row) => (
              <span key={row} className={styles.rowLines} style={{gridRow: row}} aria-hidden="true" />
            ))}
            <div className={styles.howLead} data-reveal="">
              <p className={styles.tag}>How it works</p>
              <h2 id="how-title">
                Rules before
                <br />
                money moves
              </h2>
            </div>
            <p className={styles.howCopy} data-reveal="">
              The rules live in a Solana program, not in a prompt. Every payment is checked against the spender’s policy before a cent leaves the vault.
            </p>
            <div className={styles.chartCard} data-reveal="" data-draw="" style={order(1)}>
              <div className={styles.chartHead}>
                <span>Spent this period</span>
                <strong>
                  {/* The figure counts up with the line; assistive technology reads the total once. */}
                  <span className={styles.srOnly}>{money.format(SPEND[SPEND.length - 1]!)}</span>
                  <span aria-hidden="true" data-count={SPEND.join(" ")}>
                    {money.format(SPEND[SPEND.length - 1]!)}
                  </span>
                </strong>
              </div>
              <SpendChart />
              <p className={styles.chartNote}>Example: $1,440 of a $2,000 monthly allowance, $560 left.</p>
              <Action href={APP_HREF} tone="primary" wide>
                Open the app
              </Action>
            </div>
            <ol className={styles.steps}>
              {STEPS.map((step, i) => (
                <li key={step.title} className={styles.step} data-reveal="" style={order(i + 2)}>
                  <span className={styles.num} data-ordinal="">
                    {`0${i + 1}`}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <Drawing name={step.drawing} className={styles.stepDrawing} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* --- 3. One payment, step by step ----------------------------------- */}
      <section className={`${styles.light} ${styles.walk}`} id="walk" data-tone="light" aria-labelledby="walk-title">
        <Guides />
        <div className={styles.inner}>
          <Rule />
          <div className={styles.walkHead}>
            <div className={styles.walkLead} data-reveal="">
              <p className={styles.tag}>One payment, step by step</p>
              <h2 id="walk-title">
                Paid now,
                <br />
                or held for you.
              </h2>
            </div>
            <div className={styles.walkIntro} data-reveal="" style={order(1)}>
              <p>{WALK_INTRO}</p>
              <div className={styles.walkActions}>
                <Action href={DEMO_HREF} tone="primary">
                  Watch it live
                </Action>
                <Action href="#trust" tone="light" arrow={false}>
                  Read the security model
                </Action>
              </div>
            </div>
          </div>

          <div className={styles.flows}>
            {WALK_FLOWS.map((flow) => (
              <div key={flow.id} className={styles.flow}>
                <div className={styles.flowHead}>
                  <h3 id={`walk-${flow.id}`}>{flow.title}</h3>
                  <p className={styles.flowMeta}>{flow.meta}</p>
                </div>
                <ol className={styles.flowSteps} aria-labelledby={`walk-${flow.id}`}>
                  {flow.steps.map((step, i) => (
                    <li key={step.title} className={styles.flowStep} data-reveal="" style={order(i)}>
                      <div className={styles.station}>
                        <Drawing name={step.drawing} className={styles.stationDrawing} quiet />
                      </div>
                      <span className={styles.num} data-ordinal="">
                        {`0${i + 1}`}
                      </span>
                      <h4>{step.title}</h4>
                      <p>{step.body}</p>
                      {/* The way on to the next step: across on a wide screen, down on a phone. */}
                      {i < flow.steps.length - 1 ? (
                        <span className={styles.flowLink} aria-hidden="true">
                          <ArrowGlyph />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <p className={styles.walkFacts}>{WALK_FACTS}</p>
        </div>
      </section>

      {/* --- 4. Capabilities, one row at a time ------------------------------- */}
      <section className={styles.props} id="features" aria-labelledby="props-title">
        <div className={styles.propsHead} data-tone="light">
          <Guides />
          <div className={styles.inner} data-reveal="">
            <Rule />
            <p className={styles.tag}>Core capabilities</p>
            <h2 id="props-title">
              One account for
              <br />
              agents and people
            </h2>
          </div>
        </div>
        <div className={styles.propsBody} data-tone="dark">
          <div className={styles.propsGrid}>
            {/* The row in the middle of the screen is marked by `LandingMotion` once the page is live. */}
            <ol className={styles.propRows}>
              {ROWS.map((row) => (
                <li key={row.id} id={row.id} className={styles.prop} data-row="">
                  <p className={styles.propTag}>{row.tag}</p>
                  <h3>
                    {row.title[0]}
                    <br />
                    {row.title[1]}
                  </h3>
                  <p className={styles.propBody}>{row.body}</p>
                </li>
              ))}
            </ol>
            <div className={styles.propVisual} aria-hidden="true">
              <div className={styles.factStack}>
                <Drawing name="phone" className={styles.factDrawing} />
                <LiveFacts factClass={styles.fact} noteClass={styles.factNote} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- 5. Dark framed call to action ------------------------------------ */}
      <section className={styles.cta} data-tone="dark" aria-labelledby="cta-title">
        <div className={styles.ctaFrame}>
          <div className={styles.ctaPanel} data-reveal="">
            <BrandMark className={styles.ctaMark} />
            <LandingVault className={styles.ctaDrawing} />
            <h2 id="cta-title">
              A budget for every agent.
              <br />
              <span>Enforced on Solana.</span>
            </h2>
            <div className={styles.ctaActions}>
              <Action href={APP_HREF} tone="primary">
                Open the app
              </Action>
              <Action href="#how-it-works" tone="dark" arrow={false}>
                See how it works
              </Action>
            </div>
          </div>
        </div>
      </section>

      {/* --- 6. The policy layer ---------------------------------------------- */}
      <section className={styles.statement} id="trust" aria-labelledby="statement-title">
        <div className={styles.statementTop} data-tone="dark">
          <div className={styles.inner}>
            <Rule tone="dark" />
            <div className={styles.statementHead}>
              <h2 className={styles.tag} id="statement-title">
                The policy layer
              </h2>
              <Action href={DEMO_HREF} tone="dark">
                See it refuse a payment
              </Action>
            </div>
            <RevealText text={STATEMENT} className={styles.statementText} />
          </div>
        </div>
        <div className={styles.reasonsWrap} data-tone="light">
          <div className={styles.inner}>
            <ul className={styles.reasons}>
              {REASONS.map((reason, i) => (
                <li key={reason.title} data-reveal="" style={order(i)}>
                  <Drawing name={reason.drawing} className={styles.reasonDrawing} quiet />
                  <div>
                    <h3>{reason.title}</h3>
                    <p>{reason.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Drawing name="chain" marked className={styles.reasonsArt} />
            <p className={styles.disclosure}>
              Solana devnet prototype · Not independently audited · The demo&apos;s owner actions are signed by a disclosed server key.
            </p>
          </div>
        </div>
      </section>

      {/* --- 7. Questions ------------------------------------------------------ */}
      <section className={`${styles.light} ${styles.faq}`} id="faq" data-tone="light" aria-labelledby="faq-title">
        <Guides />
        <div className={styles.inner}>
          <Rule />
          <div className={styles.faqHead}>
            <h2 id="faq-title">FAQ</h2>
            <div className={styles.faqMore}>
              <p>Got more questions?</p>
              <Action href={DEMO_HREF} tone="light">
                Try the live demo
              </Action>
            </div>
          </div>
          <div className={styles.faqList} data-reveal="">
            {FAQ.map(([q, a], i) => (
              <details key={q} className={styles.faqItem}>
                <summary>
                  <span className={styles.num} data-ordinal="">
                    {`0${i + 1}`}
                  </span>
                  <span className={styles.question}>{q}</span>
                  <span className={styles.toggle} aria-hidden="true">
                    <PlusGlyph />
                  </span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </LandingMotion>
  );
}
