"use client";

// Nuntio's global account, cards, payments abroad and identity check run on a fiat partner. Rein has
// no fiat backend, so these pages keep Nuntio's layout and say so plainly: no balance, no card, no
// form that pretends to send anything. Each says in one line what it would be on Rein.

import Link from "next/link";
import type {ComponentType} from "react";
import {ButtonLink} from "../Button";
import {IconCard, IconGlobal, IconSendAbroad, IconShield, type IconProps} from "../Icons";
import {PageHeader} from "../PageHeader";
import {StatusPill} from "../ui";
import {useTeamPage} from "../rein/context";
import styles from "../pages/global.module.css";

export type GlobalPageId = "account" | "cards" | "send" | "verify";

type Copy = {
  path: string;
  tab: string;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  would: string;
  action: {label: string; path: string};
};

const PAGES: Record<GlobalPageId, Copy> = {
  account: {
    path: "global",
    tab: "Account",
    title: "Global account",
    description: "A USD account outside the chain, for cards and payments abroad.",
    icon: IconGlobal,
    would: "On Rein it would be a ramp into the team vault: bank money in as USDC and back out, with the owner approving anything over a limit.",
    action: {label: "Open the vault", path: "money"},
  },
  cards: {
    path: "global/cards",
    tab: "Cards",
    title: "Cards",
    description: "Virtual USD cards for online spending.",
    icon: IconCard,
    would: "On Rein a card would be a Spender with its own policy, so every card payment meets the same allowance, cap and owner approval as any other.",
    action: {label: "See the spenders", path: "spenders"},
  },
  send: {
    path: "global/send",
    tab: "Send abroad",
    title: "Send abroad",
    description: "Pay bank accounts and mobile wallets abroad.",
    icon: IconSendAbroad,
    would: "On Rein a payout would be a service in the registry, so the bank or wallet is fixed by the registry admin and never typed by a spender.",
    action: {label: "See the services", path: "recipients"},
  },
  verify: {
    path: "global/verify",
    tab: "Verify",
    title: "Verify",
    description: "An identity check, once, before any fiat moves.",
    icon: IconShield,
    would: "On Rein it would be the ramp provider's identity check (KYC) for the owner, with Rein keeping none of the documents.",
    action: {label: "Back to the global account", path: "global"},
  },
};

const ORDER: GlobalPageId[] = ["account", "cards", "send", "verify"];

export function GlobalScreen({page}: {page: GlobalPageId}) {
  const t = useTeamPage();
  const c = PAGES[page];
  const Icon = c.icon;
  const labelId = `global-${page}-label`;

  return (
    <div className={styles.page}>
      <PageHeader kind="global" title={c.title} description={c.description} />

      <nav aria-label="Global account pages">
        <ul className={styles.tabs}>
          {ORDER.map((id) => (
            <li key={id}>
              <Link href={`${t.base}/${PAGES[id].path}`} className={styles.tab} aria-current={id === page ? "page" : undefined}>
                {PAGES[id].tab}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.stack}>
        <section className={styles.frame} aria-labelledby={labelId}>
          <h2 className={styles.label} id={labelId}>
            {c.title}
          </h2>
          <div className={styles.status}>
            <StatusPill tone="neutral" label="Not on Rein yet" />
          </div>
          <p className={styles.offerTitle}>Rein has no fiat backend</p>
          <p className={styles.line}>{c.would}</p>

          {page === "account" ? (
            <ul className={styles.benefits}>
              <li className={styles.benefit}>
                <IconCard size="card" />
                <p className={styles.benefitTitle}>Cards, if it existed</p>
                <p className={styles.benefitText}>Cards that spend under a policy. None are issued: there is no card provider behind Rein.</p>
              </li>
              <li className={styles.benefit}>
                <IconSendAbroad size="card" />
                <p className={styles.benefitTitle}>Payments abroad, if it existed</p>
                <p className={styles.benefitText}>Bank and mobile-money payouts as registered services. None can be sent: there is no payout partner behind Rein.</p>
              </li>
            </ul>
          ) : (
            <ul className={styles.benefits}>
              <li className={styles.benefit}>
                <Icon size="card" />
                <p className={styles.benefitTitle}>Nothing to show</p>
                <p className={styles.benefitText}>No balance, card or payout exists here, so this page shows none. Nothing has been asked of you and no money moved.</p>
              </li>
            </ul>
          )}

          <aside className={styles.separate} aria-label="Where money is held">
            <p className={styles.separateLabel}>What Rein does hold</p>
            <p className={styles.separateText}>Test USDC in the team vault on Solana, which only the Rein program can move, under each spender&apos;s policy.</p>
          </aside>

          <div className={styles.actions}>
            <ButtonLink href={`${t.base}/${c.action.path}`}>{c.action.label}</ButtonLink>
          </div>
        </section>
      </div>
    </div>
  );
}
