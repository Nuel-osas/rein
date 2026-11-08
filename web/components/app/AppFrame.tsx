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
import {IconAdd, IconAgent, IconApprovals, IconBank, IconHistory, IconHome, IconNini, IconSettings, IconSignOut, IconSpenders, type IconProps} from "./Icons";
import {NETWORK_NAME} from "./network-copy";
import {TestnetStrip, TestnetTag} from "./TestnetMark";
import {WalletButton} from "./WalletButton";
import a11y from "./a11y.module.css";
import styles from "./AppShell.module.css";

type Item = {href: string; label: string; short: string; icon: ComponentType<IconProps>; badge?: boolean; exact?: boolean};
type Section = {label: string | null; items: Item[]};

function sectionsFor(base: string): Section[] {
  return [
    {
      label: null,
      items: [
        {href: base, label: "Home", short: "Home", icon: IconHome, exact: true},
        {href: `${base}/approvals`, label: "Approvals", short: "Approvals", icon: IconApprovals, badge: true},
        {href: `${base}/activity`, label: "Activity", short: "Activity", icon: IconHistory},
      ],
    },
    {
      label: "Team",
      items: [
        {href: `${base}/spenders`, label: "Spenders", short: "Spenders", icon: IconSpenders},
        {href: `${base}/agents`, label: "Agents", short: "Agents", icon: IconAgent},
        {href: `${base}/assistant`, label: "Assistant", short: "Assistant", icon: IconNini},
      ],
    },
    {label: "Money", items: [{href: `${base}/money`, label: "Vault", short: "Vault", icon: IconBank}]},
  ];
}

function active(pathname: string, item: Item): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function labelFor(pathname: string, base: string | null): string {
  if (!base) return pathname.startsWith("/app/teams/new") ? "New team" : "Teams";
  if (pathname.startsWith(`${base}/pay`)) return "New payment";
  if (pathname.startsWith(`${base}/settings`)) return "Settings";
  for (const s of sectionsFor(base)) for (const i of s.items) if (active(pathname, i)) return i.label;
  return "Home";
}

export function AppFrame({team, children}: {team: string | null; children: ReactNode}) {
  const pathname = usePathname() ?? "/app";
  const base = team ? `/app/${team}` : null;
  const sections = base ? sectionsFor(base) : [];
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
            {base ? (
              sections.map((section) => <Group key={section.label ?? "places"} section={section} pathname={pathname} waiting={waiting} />)
            ) : (
              <ul className={styles.navList}>
                <li>
                  <Link href="/app" className={styles.navLink} aria-current={pathname === "/app" ? "page" : undefined}>
                    <IconHome size="nav" />
                    <span className={styles.navLabel}>Your teams</span>
                  </Link>
                </li>
              </ul>
            )}
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
          {[sections[0].items[0], sections[0].items[1], {href: `${base}/pay`, label: "Pay", short: "Pay", icon: IconAdd}, sections[0].items[2], sections[1].items[0]].map((item: Item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={styles.bottomLink} aria-current={active(pathname, item) ? "page" : undefined}>
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

function Group({section, pathname, waiting}: {section: Section; pathname: string; waiting: number | null}) {
  const id = useId();
  const list = (
    <ul className={styles.navList} aria-labelledby={section.label ? id : undefined}>
      {section.items.map((item) => {
        const Icon = item.icon;
        const current = active(pathname, item);
        return (
          <li key={item.href}>
            <Link href={item.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
              <Icon size="nav" />
              <span className={styles.navLabel}>{item.label}</span>
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
