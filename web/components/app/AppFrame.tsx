"use client";

// The app's frame: a sidebar above 64rem (brand, the seven places, a "Coming soon" group and the
// account), a top bar and a bottom bar below it with the same seven places. Two ways in, one frame:
//   - public, /app/<team>/…: every link stays under that team, so a link to the demo team opens
//     the whole app for anyone, signed in or not;
//   - own (`own`), the signed-in person's own team at Nuntio's top-level routes: /dashboard,
//     /spenders, /approvals and so on, behind the sign-in gate (OwnTeamGate).

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useId, type ComponentType, type ReactNode} from "react";
import {Brand} from "@/components/Brand";
import {short} from "@/lib/chain";
import {isLive} from "@/lib/rein";
import {useNow, useTeam} from "@/lib/team";
import {useWallet} from "@/lib/wallet";
import {IconAdd, IconApprovals, IconCard, IconCompute, IconHistory, IconHome, IconMetrics, IconPayments, IconSendAbroad, IconSettings, IconSignOut, IconSpenders, IconSwitch, type IconProps} from "./Icons";
import {NETWORK_NAME} from "./network-copy";
import {TestnetStrip, TestnetTag} from "./TestnetMark";
import {WalletButton} from "./WalletButton";
import a11y from "./a11y.module.css";
import styles from "./AppShell.module.css";

type Item = {href: string; label: string; short: string; icon: ComponentType<IconProps>; badge?: boolean; exact?: boolean; also?: string[]};
type Section = {label: string | null; items: Item[]};
type Soon = {label: string; icon: ComponentType<IconProps>};

/**
 * The seven places, in the order the team asked for. Team is people and agents together, so an
 * agent's page (/agents/new, /agents/<key>) lights Team too. Compute holds the assistant.
 */
function placesFor(base: string, home: string): Item[] {
  return [
    {href: home, label: "Home", short: "Home", icon: IconHome, exact: true},
    {href: `${base}/spenders`, label: "Team", short: "Team", icon: IconSpenders, also: [`${base}/agents`]},
    {href: `${base}/approvals`, label: "Approvals", short: "Approve", icon: IconApprovals, badge: true},
    {href: `${base}/activity`, label: "Activity", short: "Activity", icon: IconHistory},
    {href: `${base}/pay`, label: "Pay", short: "Pay", icon: IconPayments},
    {href: `${base}/compute`, label: "Compute", short: "Compute", icon: IconCompute},
    {href: `${base}/settings`, label: "Settings", short: "Settings", icon: IconSettings},
  ];
}

/** Shown greyed with a "Soon" tag. Not links: there is no page behind them yet. */
const SOON: Soon[] = [
  {label: "Metrics", icon: IconMetrics},
  {label: "Cards", icon: IconCard},
  {label: "Send abroad", icon: IconSendAbroad},
];

/** The no-team view: the teams you can open. Creating one is the primary row above it. */
const TEAMS: Section = {label: "Teams", items: [{href: "/app", label: "Your teams", short: "Teams", icon: IconSwitch, exact: true}]};

function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function matches(pathname: string, item: Item): boolean {
  if (item.exact) return pathname === item.href;
  return under(pathname, item.href) || (item.also ?? []).some((h) => under(pathname, h));
}

/** The one row a path belongs to: the closest match. */
function currentItem(pathname: string, items: Item[]): Item | null {
  let best: Item | null = null;
  for (const i of items) if (matches(pathname, i) && (best === null || i.href.length > best.href.length)) best = i;
  return best;
}

function labelFor(pathname: string, items: Item[], team: boolean): string {
  if (!team) return pathname.startsWith("/app/teams/new") || pathname.startsWith("/teams/new") ? "New team" : "Teams";
  return currentItem(pathname, items)?.label ?? "Home";
}

/**
 * `team` null is the no-team view. `own` puts the frame on the top-level routes of the signed-in
 * person's own team (links "" + /spenders, Home at /dashboard) instead of /app/<team>/….
 */
export function AppFrame({team, own = false, children}: {team: string | null; own?: boolean; children: ReactNode}) {
  const pathname = usePathname() ?? (own ? "/dashboard" : "/app");
  // "" is a real base (own team): test against null, never truthiness.
  const base = team ? (own ? "" : `/app/${team}`) : null;
  const home = team ? (own ? "/dashboard" : `/app/${team}`) : "/app";
  const places = base !== null ? placesFor(base, home) : [];
  const newTeam = own ? "/teams/new" : "/app/teams/new";
  const current = currentItem(pathname, base !== null ? places : TEAMS.items)?.href ?? null;
  const t = useTeam(team);
  const now = useNow();
  const waiting = t.payments ? t.payments.filter((p) => isLive(p, now)).length : null;
  const {address, authenticated, label: who, disconnect} = useWallet();

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

          {base === null ? (
            <Link href={newTeam} className={styles.primaryRow} aria-current={pathname.startsWith(newTeam) ? "page" : undefined}>
              <IconAdd size="nav" />
              <span className={styles.navLabel}>Create a team</span>
            </Link>
          ) : null}

          <nav aria-label="Sections" className={styles.sidebarNav}>
            {base !== null ? <Group section={{label: null, items: places}} current={current} waiting={waiting} /> : <Group section={TEAMS} current={current} waiting={null} />}
          </nav>

          <div className={styles.sidebarBase}>
            {base !== null ? <SoonGroup /> : null}
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
              <span className={styles.crumb}>{labelFor(pathname, places, base !== null)}</span>
              <div className={`${styles.network} ${styles.networkNote}`}>
                <span className={styles.networkDot} aria-hidden="true" />
                <span>{NETWORK_NAME}: test USDC only, nothing here is real money.</span>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>

      {base !== null ? (
        <nav className={styles.bottombar} aria-label="Sections" data-count={places.length}>
          {places.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={styles.bottomLink} aria-current={item.href === current ? "page" : undefined}>
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

function Group({section, current, waiting}: {section: Section; current: string | null; waiting: number | null}) {
  const id = useId();
  const list = (
    <ul className={styles.navList} aria-labelledby={section.label ? id : undefined}>
      {section.items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link href={item.href} className={styles.navLink} aria-current={item.href === current ? "page" : undefined}>
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

/** Greyed rows with a "Soon" tag, at the foot of the sidebar. Plain text, never a link or a button. */
function SoonGroup() {
  const id = useId();
  return (
    <div className={`${styles.navGroup} ${styles.soonGroup}`}>
      <h2 className={styles.navHeading} id={id}>
        Coming soon
      </h2>
      <ul className={styles.navList} aria-labelledby={id}>
        {SOON.map(({label, icon: Icon}) => (
          <li key={label}>
            <span className={`${styles.navLink} ${styles.navSoon}`} aria-disabled="true">
              <Icon size="nav" />
              <span className={styles.navLabel}>{label}</span>
              <span className={styles.soonTag}>Soon</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
