"use client";

// /signin and /auth/callback. Privy runs the Google sign-in and creates an embedded Solana wallet;
// once the wallet exists, this sends the person to their team (the PDA ["team", wallet]) if it is on
// chain, or to create one. A failed read is not "no team": it offers the team list instead.

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {PROGRAM_ID, connection} from "@/lib/chain";
import {pda, toTeam} from "@/lib/rein";
import {useWallet} from "@/lib/wallet";
import {OnboardingScreen, type OnboardingState} from "./OnboardingScreen";

export function SignInExperience() {
  const {configured, ready, authenticated, address, label, signIn, disconnect, error} = useWallet();
  const router = useRouter();
  const [next, setNext] = useState<{href: string; label: string} | null>(null);

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
        const dest = found ? {href: `/app/${team}`, label: `Open ${found.name}`} : {href: "/app/teams/new", label: "Create your team"};
        setNext(dest);
        router.replace(dest.href);
      })
      .catch(() => {
        if (!stop) setNext({href: "/app", label: "Open your teams"});
      });
    return () => {
      stop = true;
    };
  }, [authenticated, address, router]);

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
