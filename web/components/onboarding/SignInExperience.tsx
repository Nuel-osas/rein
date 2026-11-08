"use client";

// /onboarding and /auth/callback (/signin redirects to /onboarding). Privy runs the Google sign-in
// and creates an embedded Solana wallet; once the wallet exists, this sends the person where they
// were going (the return-to path the gate or an invite left) or to /dashboard when
// their team (the PDA ["team", wallet]) is on chain; with no team, to /teams/new unless they came
// from an invite. A failed read is not "no team": it offers the way on, where the gate retries.

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {PROGRAM_ID, connection} from "@/lib/chain";
import {pda, toTeam} from "@/lib/rein";
import {forgetReturnTo, isInvitePath, readReturnTo} from "@/lib/return-to";
import {useWallet} from "@/lib/wallet";
import {OnboardingScreen, type OnboardingState} from "./OnboardingScreen";

export function SignInExperience() {
  const {configured, ready, authenticated, address, label, signIn, disconnect, error} = useWallet();
  const router = useRouter();
  const [next, setNext] = useState<{href: string; label: string} | null>(null);
  // Read once, on arrival: ?next= on the URL, or what the gate or an invite remembered before Google.
  const [returnTo] = useState(() => readReturnTo());

  useEffect(() => {
    setNext(null);
    if (!authenticated || !address) return;
    let stop = false;
    let team: string;
    try {
      team = pda.team(new PublicKey(address)).toBase58();
    } catch {
      return;
    }
    connection()
      .getAccountInfo(new PublicKey(team), "confirmed")
      .then((info) => {
        if (stop) return;
        const found = info && info.owner.equals(PROGRAM_ID) ? toTeam(team, info) : null;
        // An account at the team address that is not a Rein team is unknown, never "no team".
        if (info && !found) return setNext({href: returnTo ?? "/dashboard", label: "Continue"});
        const dest = found
          ? {href: returnTo ?? "/dashboard", label: returnTo ? "Continue" : `Open ${found.name}`}
          : returnTo && isInvitePath(returnTo)
            ? {href: returnTo, label: "Continue to your invite"}
            : {href: "/teams/new", label: "Create your team"};
        setNext(dest);
        forgetReturnTo();
        router.replace(dest.href);
      })
      .catch(() => {
        // Unknown, not "no team": no automatic redirect, and never to Create a team.
        if (!stop) setNext({href: returnTo ?? "/dashboard", label: "Continue"});
      });
    return () => {
      stop = true;
    };
  }, [authenticated, address, router, returnTo]);

  const state: OnboardingState = !configured ? "unavailable" : !ready ? "loading" : authenticated ? "signed-in" : "signed-out";
  return (
    <OnboardingScreen
      state={state}
      name={label ?? undefined}
      address={address}
      next={next}
      error={error}
      onLogin={signIn}
      onLogout={() => void disconnect()}
    />
  );
}
