"use client";

// The app's frame: a sidebar above 64rem (brand, the one primary row, the places, the team group,
// settings and the account), a top bar and a bottom bar below it. Every destination is under one
// team, /app/<team>/…, so a link to the demo team opens the whole app for anyone, signed in or not.

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useId, type ComponentType, type ReactNode} from "react";
import {Brand} from "@/components/Brand";
import {short} from "@/lib/chain";
import {isLive} from "@/lib/rein";
import {useNow, useTeam} from "@/lib/team";
import {useWallet} from "@/lib/wallet";
import {IconAdd, IconAgent, IconApprovals, IconBank, IconCard, IconCompute, IconGlobal, IconHistory, IconHome, IconMetrics, IconNini, IconRecipients, IconSendAbroad, IconSettings, IconSignOut, IconSpenders, IconSwitch, IconUserAdd, type IconProps} from "./Icons";
import {NETWORK_NAME} from "./network-copy";
import {TestnetStrip, TestnetTag} from "./TestnetMark";
import {WalletButton} from "./WalletButton";
import a11y from "./a11y.module.css";
import styles from "./AppShell.module.css";

type Item = {href: string; label: string; short: string; icon: ComponentType<IconProps>; badge?: boolean; exact?: boolean; note?: string};
type Section = {label: string | null; items: Item[]};

/**
 * Nuntio's order and grouping (components/app/nav.ts there): the places, then MONEY, TEAM and BUILD,
 * then the teams. Recipients are the service registry in Rein, so that row says Services. The global
 * rows carry a quiet "not yet": Rein has no fiat backend, and the pages say so.
 */
function sectionsFor(base: string): Section[] {
  return [
    {
      label: null,
      items: [
        {href: base, label: "Home", short: "Home", icon: IconHome, exact: true},
        {href: `${base}/approvals`, label: "Approvals", short: "Approvals", icon: IconApprovals, badge: true},
        {href: `${base}/activity`, label: "Activity", short: "Activity", icon: IconHistory},
        {href: `${base}/metrics`, label: "Metrics", short: "Metrics", icon: IconMetrics},
      ],
    },
    {
      label: "Money",
      items: [
        {href: `${base}/money`, label: "Vault", short: "Vault", icon: IconBank},
        {href: `${base}/global`, label: "Global account", short: "Global", icon: IconGlobal, note: "not yet"},
        {href: `${base}/global/cards`, label: "Cards", short: "Cards", icon: IconCard, note: "not yet"},
        {href: `${base}/global/send`, label: "Send abroad", short: "Send abroad", icon: IconSendAbroad, note: "not yet"},
      ],
    },
    {
      label: "Team",
      items: [
        {href: `${base}/spenders`, label: "Spenders", short: "Spenders", icon: IconSpenders},
        {href: `${base}/recipients`, label: "Services", short: "Services", icon: IconRecipients},
        {href: `${base}/agents`, label: "Agents", short: "Agents", icon: IconAgent},
        {href: `${base}/assistant`, label: "Assistant", short: "Assistant", icon: IconNini},
      ],
    },
    {label: "Build", items: [{href: `${base}/compute`, label: "Compute", short: "Compute", icon: IconCompute}]},
  ];
}

/** Below the groups, in team and no-team views alike: the ways to another team. */
const TEAMS: Section = {
  label: "Teams",
  items: [
    {href: "/app", label: "Your teams", short: "Teams", icon: IconSwitch, exact: true},
    {href: "/app/teams/join", label: "Join a team", short: "Join", icon: IconUserAdd},
  ],
};

function matches(pathname: string, item: Item): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The one row a path belongs to: the closest match, so /global/cards is Cards, not Global account. */
function currentHref(pathname: string, sections: Section[]): string | null {
  let best: string | null = null;
  for (const s of sections) for (const i of s.items) if (matches(pathname, i) && (best === null || i.href.length > best.length)) best = i.href;
  return best;
}

function active(pathname: string, item: Item, current: string | null): boolean {
  return current !== null ? item.href === current : matches(pathname, item);
}

function labelFor(pathname: string, base: string | null): string {
  if (!base) {
    if (pathname.startsWith("/app/teams/new")) return "New team";
    if (pathname.startsWith("/app/teams/join")) return "Join a team";
    return "Teams";
  }
  if (pathname.startsWith(`${base}/pay`)) return "New payment";
  if (pathname.startsWith(`${base}/settings`)) return "Settings";
  if (pathname.startsWith(`${base}/global/verify`)) return "Verify";
  const sections = sectionsFor(base);
  const href = currentHref(pathname, sections);
  for (const s of sections) for (const i of s.items) if (i.href === href) return i.label;
  return "Home";
}

export function AppFrame({team, children}: {team: string | null; children: ReactNode}) {
  const pathname = usePathname() ?? "/app";
  const base = team ? `/app/${team}` : null;
  const sections = base ? sectionsFor(base) : [];
  const current = currentHref(pathname, [...sections, TEAMS]);
  const t = useTeam(team);
  const now = useNow();
  const waiting = t.payments ? t.payments.filter((p) => isLive(p, now)).length : null;
  const {address, authenticated, label: who, disconnect} = useWallet();
  const home = base ?? "/app";

  return (
    <div className={styles.shell} data-theme="dark" data-app="">
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <TestnetStrip className={styles.testnetStrip} />
      <header className={styles.topbar}>
        <div className={styles.brandRow}>
          <Link href={home} className={styles.brand}>
            <Brand />
          </Link>
        </div>
        <WalletButton compact />
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={`${styles.sidebarHead} ${styles.brandRow}`}>
            <Link href="/" className={styles.brand} aria-label="Rein home">
              <Brand />
            </Link>
            <TestnetTag />
          </div>

          {base ? (
            <Link href={`${base}/pay`} className={styles.primaryRow} aria-current={pathname.startsWith(`${base}/pay`) ? "page" : undefined}>
              <IconAdd size="nav" />
              <span className={styles.navLabel}>New payment</span>
            </Link>
          ) : (
            <Link href="/app/teams/new" className={styles.primaryRow} aria-current={pathname.startsWith("/app/teams/new") ? "page" : undefined}>
              <IconAdd size="nav" />
              <span className={styles.navLabel}>Create a team</span>
            </Link>
          )}

          <nav aria-label="Sections" className={styles.sidebarNav}>
            {sections.map((section) => (
              <Group key={section.label ?? "places"} section={section} pathname={pathname} current={current} waiting={waiting} />
            ))}
            <Group section={TEAMS} pathname={pathname} current={current} waiting={null} />
          </nav>

          <div className={styles.sidebarBase}>
            {base ? (
              <Link href={`${base}/settings`} className={styles.navLink} aria-current={pathname.startsWith(`${base}/settings`) ? "page" : undefined}>
                <IconSettings size="nav" />
                <span className={styles.navLabel}>Settings</span>
              </Link>
            ) : null}
            <div className={styles.sidebarFoot}>
              {authenticated ? (
                <>
                  <span className={styles.accountLink} title={address ?? undefined}>
                    <span className={styles.accountAvatar} aria-hidden="true">
                      {(who ?? address ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                    <span className={styles.identity}>
                      <span className={styles.identityName}>{who ?? short(address, 4)}</span>
                      <span className={styles.identityNote}>{address ? `${short(address, 4)}${t.team?.owner === address ? " · owner" : ""}` : "Creating wallet…"}</span>
                    </span>
                  </span>
                  <button type="button" className={styles.signOut} onClick={() => void disconnect()} aria-label="Sign out" title="Sign out">
                    <IconSignOut size="nav" />
                  </button>
                </>
              ) : (
                <WalletButton />
              )}
            </div>
          </div>
        </aside>

        <main id="main" className={styles.main}>
          <div className={styles.inner}>
            <div className={styles.crumbs}>
              <span className={styles.crumb}>{labelFor(pathname, base)}</span>
              <div className={`${styles.network} ${styles.networkNote}`}>
                <span className={styles.networkDot} aria-hidden="true" />
                <span>{NETWORK_NAME}: test USDC only, nothing here is real money.</span>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>

      {base ? (
        <nav className={styles.bottombar} aria-label="Sections">
          {[sections[0].items[0], sections[0].items[1], {href: `${base}/pay`, label: "Pay", short: "Pay", icon: IconAdd}, sections[0].items[2], {href: `${base}/spenders`, label: "Spenders", short: "Spenders", icon: IconSpenders}].map((item: Item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={styles.bottomLink} aria-current={matches(pathname, item) ? "page" : undefined}>
                <Icon size="nav" />
                {item.short}
                {item.badge && waiting ? (
                  <>
                    <span className={styles.bottomDot} aria-hidden="true" />
                    <span className={a11y.srOnly}>{`, ${waiting} waiting`}</span>
                  </>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

function Group({section, pathname, current, waiting}: {section: Section; pathname: string; current: string | null; waiting: number | null}) {
  const id = useId();
  const list = (
    <ul className={styles.navList} aria-labelledby={section.label ? id : undefined}>
      {section.items.map((item) => {
        const Icon = item.icon;
        const here = active(pathname, item, current);
        return (
          <li key={item.href}>
            <Link href={item.href} className={styles.navLink} aria-current={here ? "page" : undefined}>
              <Icon size="nav" />
              <span className={styles.navLabel}>{item.label}</span>
              {item.note ? <span className={styles.navNote}>{item.note}</span> : null}
              {item.badge && waiting ? (
                <span className={styles.navCount}>
                  {waiting}
                  <span className={a11y.srOnly}> waiting</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  if (!section.label) return list;
  return (
    <div className={styles.navGroup}>
      <h2 className={styles.navHeading} id={id}>
        {section.label}
      </h2>
      {list}
    </div>
  );
}
