"use client";

// The sign-in gate for the signed-in person's own team, at Nuntio's top-level routes (/dashboard,
// /spenders, …). Nuntio's AppShell does the same job: it reads the Privy session, then the person's
// account, and mounts the app only for somebody signed in. Rein's "account" is the team PDA
// ["team", <embedded Solana wallet>] (lib/rein.ts), read straight from chain:
//
//   session still loading       -> "Checking your session…"
//   signed out                  -> /onboarding?next=<this path> (a client redirect; the path is
//                                  also kept in sessionStorage because Google sign-in leaves the page)
//   wallet not created yet      -> "Creating your Solana wallet…"
//   team found                  -> the page, framed on the top-level routes; /teams/new -> /dashboard
//   no team on chain            -> /teams/new
//   chain read failed (unknown) -> a retry state. Never "no team": that would send somebody who
//                                  owns a team to create a second one.
//
// The public /app/<team>/… views do not pass through here; they stay readable without sign-in.

import Link from "next/link";
import {usePathname, useRouter} from "next/navigation";
import {useEffect, useMemo, useState, type ReactNode} from "react";
import {PublicKey} from "@solana/web3.js";
import {Brand} from "@/components/Brand";
import {PROGRAM_ID, connection} from "@/lib/chain";
import {pda, toTeam} from "@/lib/rein";
import {onboardingHref, rememberReturnTo} from "@/lib/return-to";
import {useWallet} from "@/lib/wallet";
import {AppFrame} from "./AppFrame";
import {Button} from "./Button";
import {TeamScope} from "./rein/context";
import {EmptyState} from "./ui";
import styles from "./OwnTeamGate.module.css";

type Status = "found" | "missing" | "unknown";

/** Only an absent account is "missing". A failed read, or an account that is not a Rein team, is unknown. */
async function teamStatus(team: string): Promise<Status> {
  try {
    const info = await connection().getAccountInfo(new PublicKey(team), "confirmed");
    if (info === null) return "missing";
    return info.owner.equals(PROGRAM_ID) && toTeam(team, info) ? "found" : "unknown";
  } catch {
    return "unknown";
  }
}

function under(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function Wait({label}: {label: string}) {
  return (
    <div className={styles.wait} data-theme="dark" data-app="">
      <div className={styles.box}>
        <Link href="/" className={styles.brand} aria-label="Rein home">
          <Brand />
        </Link>
        <p className={styles.status} role="status">
          <span aria-hidden="true" />
          {label}
        </p>
      </div>
    </div>
  );
}

export function OwnTeamGate({children}: {children: ReactNode}) {
  const {ready, authenticated, address} = useWallet();
  const pathname = usePathname() ?? "/dashboard";
  const router = useRouter();
  const [read, setRead] = useState<{team: string; path: string; status: Status} | null>(null);
  const [attempt, setAttempt] = useState(0);

  const team = useMemo(() => {
    try {
      return address ? pda.team(new PublicKey(address)).toBase58() : null;
    } catch {
      return null;
    }
  }, [address]);

  const mine = read && read.team === team ? read : null;
  const found = mine?.status === "found";
  const onNew = under(pathname, "/teams/new");

  // The team read. Until a team is found it is read again on every page, so a team created on
  // /teams/new is found on the next one instead of bouncing its owner back to the form.
  useEffect(() => {
    if (!team || found) return;
    let stop = false;
    void teamStatus(team).then((status) => {
      if (!stop) setRead({team, path: pathname, status});
    });
    return () => {
      stop = true;
    };
  }, [team, found, pathname, attempt]);

  // A "missing" from a read made on another page is not trusted for this one.
  const fresh = mine !== null && (mine.status !== "missing" || mine.path === pathname);
  const redirect = !ready
    ? null
    : !authenticated
      ? "signin"
      : !fresh
        ? null
        : mine.status === "missing" && !onNew
          ? "/teams/new"
          : mine.status === "found" && onNew
            ? "/dashboard"
            : null;

  useEffect(() => {
    if (!redirect) return;
    if (redirect === "signin") {
      const path = `${window.location.pathname}${window.location.search}`;
      rememberReturnTo(path);
      router.replace(onboardingHref(path));
      return;
    }
    router.replace(redirect);
  }, [redirect, router]);

  if (!ready) return <Wait label="Checking your session…" />;
  if (!authenticated) return <Wait label="Opening sign-in…" />;
  if (!team) return <Wait label="Creating your Solana wallet…" />;
  if (redirect === "/teams/new") return <Wait label="You have no team yet. Opening Create a team…" />;
  if (redirect === "/dashboard") return <Wait label="Your wallet already owns a team. Opening it…" />;

  if (mine?.status === "found") {
    return (
      <AppFrame team={team} own>
        <TeamScope team={team} base="">
          {children}
        </TeamScope>
      </AppFrame>
    );
  }

  if (mine?.status === "unknown") {
    return (
      <AppFrame team={null} own>
        <EmptyState
          as="h1"
          title="Could not read your team"
          body="The network did not answer, so Rein does not know yet whether your wallet owns a team. Nothing was changed. Try again in a moment."
          action={
            <Button
              variant="primary"
              onClick={() => {
                setRead(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        />
      </AppFrame>
    );
  }

  if (mine?.status === "missing" && fresh) return <AppFrame team={null} own>{children}</AppFrame>;
  return <Wait label="Looking up your team…" />;
}
