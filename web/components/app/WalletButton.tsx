"use client";

// Sign in, then the account. Signed out it is one "Sign in" button that opens Privy (Google). Signed
// in it is the account menu: who, the embedded Solana wallet's address, and sign out. Without a
// Privy app id it says sign-in is not configured.

import {useEffect, useRef, useState} from "react";
import {explorer, short} from "@/lib/chain";
import {useWallet} from "@/lib/wallet";
import btn from "./Button.module.css";
import styles from "./WalletButton.module.css";

export function WalletButton({compact = false, label = "Sign in"}: {compact?: boolean; label?: string}) {
  const {configured, ready, authenticated, address, label: who, signIn, disconnect, error} = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const size = compact ? btn.small : btn.block;
  if (!configured) {
    return (
      <span className={`${btn.button} ${btn.secondary} ${size} ${btn.unavailable}`} aria-disabled="true" title="This deployment has no Privy app id">
        Sign-in is not configured
      </span>
    );
  }
  if (!ready) {
    return (
      <span className={`${btn.button} ${btn.secondary} ${size} ${btn.unavailable}`} aria-busy="true">
        Checking session…
      </span>
    );
  }
  if (!authenticated) {
    return (
      <div className={styles.wrap}>
        <button type="button" className={`${btn.button} ${btn.primary} ${size}`} onClick={signIn}>
          {label}
        </button>
        {error && !compact ? <p className={styles.error}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button type="button" className={`${btn.button} ${btn.secondary} ${size}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        {address ? short(address, 4) : "Creating wallet…"}
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <p className={styles.title}>Signed in</p>
          {who ? <p className={styles.who}>{who}</p> : null}
          {address ? (
            <>
              <p className={styles.address}>{address}</p>
              <div role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    void navigator.clipboard?.writeText(address).then(() => setCopied(true));
                  }}
                >
                  <span className={styles.blank} aria-hidden="true" />
                  <span>{copied ? "Copied" : "Copy address"}</span>
                </button>
              </div>
              <div role="none">
                <a role="menuitem" className={styles.item} href={explorer("address", address)} target="_blank" rel="noreferrer">
                  <span className={styles.blank} aria-hidden="true" />
                  <span>View on explorer ↗</span>
                </a>
              </div>
            </>
          ) : (
            <p className={styles.foot}>Privy is creating your Solana wallet.</p>
          )}
          <div role="none">
            <button type="button" role="menuitem" className={styles.item} onClick={() => void disconnect()}>
              <span className={styles.blank} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
          <p className={styles.foot}>An embedded Solana wallet from Privy. A sponsor pays the fees, so it needs no SOL.</p>
        </div>
      ) : null}
    </div>
  );
}

/** An inline "Sign in to …" for an action that needs a signed-in person. */
export function SignInPrompt({action, note}: {action: string; note?: string}) {
  const {configured, authenticated} = useWallet();
  if (authenticated) return null;
  return (
    <div className={styles.prompt}>
      <p>{configured ? `Sign in to ${action}.` : `Sign-in is not configured here, so you cannot ${action}.`}{note ? ` ${note}` : ""}</p>
      {configured ? (
        <div className={styles.promptButton}>
          <WalletButton compact label={`Sign in to ${action}`} />
        </div>
      ) : null}
    </div>
  );
}
