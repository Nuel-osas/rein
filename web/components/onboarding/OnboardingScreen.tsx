import Link from "next/link";
import {Brand} from "@/components/Brand";
import {IconArrowLeft, IconArrowRight, IconCheck, IconShield} from "@/components/app/Icons";
import {NETWORK_NAME} from "@/components/app/network-copy";
import {explorer} from "@/lib/chain";
import {OnboardingStory} from "./OnboardingStory";
import styles from "./Onboarding.module.css";

export type OnboardingState = "loading" | "signed-out" | "signed-in" | "unavailable";

/** First sign-in with no team: the one-transaction setup, as it goes. */
export type SetupView = {tone: "wait" | "ok" | "bad"; text: string; tx?: string | null; retry?: () => void};

/** Presentation only. The sign-in page decides the state and where a signed-in person goes. */
export function OnboardingScreen({state, onLogin, onLogout, error, name, address, next, setup}: {
  state: OnboardingState;
  onLogin?: () => void;
  onLogout?: () => void;
  error?: string | null;
  name?: string;
  /** The person's Solana wallet, once Privy has it. */
  address?: string | null;
  /** Where a signed-in person goes next, once their team has been looked up. */
  next?: {href: string; label: string} | null;
  /** Shown instead of `next` while a first sign-in sets up the team. */
  setup?: SetupView | null;
}) {
  const signedIn = state === "signed-in";
  const settingUp = signedIn && !!setup;
  const unavailable = state === "unavailable";
  return <main className={styles.page} data-onboarding="split" data-theme="dark">
    <OnboardingStory />
    <section className={styles.panel} aria-labelledby="onboarding-title">
      <header className={styles.header}>
        <Link className={styles.mobileBrand} href="/" aria-label="Rein home"><Brand /></Link>
        <Link className={styles.back} href="/"><IconArrowLeft />Back to home</Link>
      </header>
      <div className={styles.panelContent}>
        {/* One traced frame holds the whole decision: the heading, the way in, and what the money is. */}
        <div className={styles.frame}>
          <div className={styles.frameHead}>
            <p className={styles.label}>{settingUp ? "First sign-in" : signedIn ? "Signed in" : unavailable ? "Unavailable" : "Sign in"}</p>
            {signedIn && !settingUp ? <span className={styles.successMark} aria-hidden="true"><IconCheck size="card" /></span> : null}
            <h1 id="onboarding-title">{settingUp ? "Setting up your team" : signedIn ? "You’re signed in." : unavailable ? "Sign-in unavailable" : "Welcome to Rein."}</h1>
            <p className={styles.description}>
              {settingUp
                ? "One transaction creates your team and its vault, and gives your Rein agent a $0.30-a-month compute budget you can change any time. The sponsor pays the fee."
                : signedIn
                ? name ?? "Your Solana wallet is ready."
                : unavailable
                  ? "Explore the live demo while sign-in is unavailable."
                  : "One shared vault, with rules for every spender and agent."}
            </p>
          </div>
          <div className={styles.frameBody}>
            {state === "loading" ? (
              <div className={styles.loading} role="status"><span />Checking your session…</div>
            ) : unavailable ? (
              <Link className={styles.primary} href="/demo"><span>See how it works</span><IconArrowRight /></Link>
            ) : signedIn ? (
              <>
                {address ? <p className={styles.wallet}>Solana wallet <code>{address.slice(0, 4)}…{address.slice(-4)}</code></p> : null}
                {setup ? (
                  <div className={styles.setup} data-tone={setup.tone} role="status">
                    <p className={styles.setupText}>{setup.tone === "wait" ? <span className={styles.setupDot} aria-hidden="true" /> : null}{setup.text}</p>
                    {setup.tx ? <a className={styles.setupLink} href={explorer("tx", setup.tx)} target="_blank" rel="noreferrer">View transaction ↗</a> : null}
                    {setup.tone === "bad" ? (
                      <div className={styles.setupActions}>
                        {setup.retry ? <button className={styles.primary} onClick={setup.retry}><span>Try again</span><IconArrowRight /></button> : null}
                        <Link className={styles.setupLink} href="/app/teams/new">Create a team by hand instead</Link>
                      </div>
                    ) : null}
                  </div>
                ) : next ? (
                  <Link className={styles.primary} href={next.href}><span>{next.label}</span><IconArrowRight /></Link>
                ) : (
                  <div className={styles.loading} role="status"><span />{address ? "Looking up your team…" : "Creating your Solana wallet…"}</div>
                )}
                <button className={styles.switchAccount} onClick={onLogout}>Use a different account</button>
              </>
            ) : (
              <div className={styles.methods}>
                <button className={styles.primary} onClick={() => onLogin?.()}><GoogleMark /><span>Continue with Google</span><IconArrowRight /></button>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
              </div>
            )}
          </div>
          <div className={styles.frameFoot}>
            <p className={styles.provider}><IconShield />Secure sign-in with Privy</p>
            <p className={styles.disclosure}>{NETWORK_NAME} · Test USDC, not real money</p>
            {/* Said once, here, before anybody signs anything: the sponsor pays every fee. */}
            <p className={styles.risk}>Rein gives you a Solana wallet and a sponsor pays every network fee, so you never need SOL.</p>
          </div>
        </div>
      </div>
      <footer className={styles.footer}><span><i />{NETWORK_NAME}</span><Link href="/security">Our safeguards <IconArrowRight /></Link></footer>
    </section>
  </main>;
}

/**
 * Google's "G" in one colour, the button's own ink, so the page keeps to black, white and purple.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
