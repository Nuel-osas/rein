"use client";

// Our own connect button over wallet-adapter: the list is whatever wallet-standard detects
// (Phantom, Solflare, Backpack and others appear by themselves), plus install links for the three
// common ones when none is present.

import {useEffect, useRef, useState} from "react";
import {short} from "@/lib/chain";
import {useWallet} from "@/lib/wallet";
import btn from "./Button.module.css";
import styles from "./WalletButton.module.css";

export function WalletButton({compact = false, label = "Connect wallet"}: {compact?: boolean; label?: string}) {
  const {address, wallets, connect, disconnect, connecting, error} = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (address) setOpen(false);
  }, [address]);

  if (address) {
    return compact ? (
      <button type="button" className={`${btn.button} ${btn.secondary} ${btn.small}`} onClick={() => void disconnect()} title="Disconnect">
        {short(address, 4)}
      </button>
    ) : null;
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={`${btn.button} ${btn.primary} ${compact ? btn.small : btn.block}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        {connecting ? "Connecting…" : label}
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <p className={styles.title}>Choose a Solana wallet</p>
          {wallets.map((w) => (
            <div key={w.name} role="none">
              {w.installed ? (
                <button type="button" role="menuitem" className={styles.item} onClick={() => connect(w.name)}>
                  {w.icon ? <img src={w.icon} alt="" width={20} height={20} /> : <span className={styles.blank} />}
                  <span>{w.name}</span>
                  <span className={styles.note}>Detected</span>
                </button>
              ) : (
                <a role="menuitem" className={styles.item} href={w.url} target="_blank" rel="noreferrer">
                  {w.icon ? <img src={w.icon} alt="" width={20} height={20} /> : <span className={styles.blank} />}
                  <span>{w.name}</span>
                  <span className={styles.note}>Install ↗</span>
                </a>
              )}
            </div>
          ))}
          <p className={styles.foot}>Rein never sees your key. A separate fee payer covers fees, so you need no SOL.</p>
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
