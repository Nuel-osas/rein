"use client";

// /signin and /auth/callback. Privy runs the Google sign-in and creates an embedded Solana wallet;
// once the wallet exists, this sends the person to their team (the PDA ["team", wallet]) if it is on
// chain. With no team yet, it sets one up in one sponsored transaction, [create_team, add_spender]:
// the team named from their Google name and the Rein agent granted a starter compute budget. A failed
// read is not "no team": it offers the team list instead, and never sends.

import {useRouter} from "next/navigation";
import {useCallback, useEffect, useRef, useState} from "react";
import {PublicKey} from "@solana/web3.js";
import {AGENT_LABEL, COMPUTE_SERVICE_IDS, fetchAgentKey, readComputeServices, starterPolicy, teamNameFor} from "@/lib/agent-setup";
import {PROGRAM_ID, connection} from "@/lib/chain";
import {ixs, pda, readConfig, toTeam} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {OnboardingScreen, type OnboardingState, type SetupView} from "./OnboardingScreen";

/** One setup per wallet per page load, even when React runs the effect twice. */
const started = new Set<string>();

async function teamOnChain(team: string): Promise<{name: string} | null | "unknown"> {
  try {
    const info = await connection().getAccountInfo(new PublicKey(team), "confirmed");
    return info && info.owner.equals(PROGRAM_ID) ? toTeam(team, info) : null;
  } catch {
    return "unknown";
  }
}

export function SignInExperience() {
  const {configured, ready, authenticated, address, publicKey, label, payer, send, signIn, disconnect, error} = useWallet();
  const router = useRouter();
  const [next, setNext] = useState<{href: string; label: string} | null>(null);
  const [setup, setSetup] = useState<SetupView | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    setNext(null);
    setNeedsSetup(false);
    setSetup(null);
    if (!authenticated || !address) return;
    let stop = false;
    let team: string;
    try {
      team = pda.team(new PublicKey(address)).toBase58();
    } catch {
      return;
    }
    teamOnChain(team).then((found) => {
      if (stop) return;
      if (found === "unknown") return setNext({href: "/app", label: "Open your teams"});
      if (found) {
        setNext({href: `/app/${team}`, label: `Open ${found.name}`});
        router.replace(`/app/${team}`);
        return;
      }
      setNeedsSetup(true);
    });
    return () => {
      stop = true;
    };
  }, [authenticated, address, router]);

  const runSetup = useCallback(async () => {
    if (!publicKey || !payer || !address) return;
    const team = pda.team(publicKey).toBase58();
    const fail = (text: string, tx?: string | null) => setSetup({tone: "bad", text, tx, retry: () => void runSetup()});
    attempt.current++;
    try {
      setSetup({tone: "wait", text: "Reading the Rein registry and your agent’s key…"});
      const conn = connection();
      const [config, agent, services, existing] = await Promise.all([readConfig(conn), fetchAgentKey(team), readComputeServices(conn), teamOnChain(team)]);
      if (existing && existing !== "unknown") {
        router.replace(`/app/${team}`);
        return;
      }
      if (existing === "unknown") return fail("Could not read the chain, so nothing was sent. Your team, if one exists, is unchanged.");
      if (!config) return fail("Could not read the Rein config from chain, so the token is unknown. Nothing was sent.");
      if (!agent.ok) return fail(agent.missing ? `${agent.error} You can still create a team without the agent.` : agent.error);
      const missing = services ? services.rows.filter((r) => !r.service).map((r) => r.id) : [];
      const name = teamNameFor(label);
      setSetup({
        tone: "wait",
        text: `Creating ${name} and granting the Rein agent 0.05 test USDC a day for compute…${missing.length ? ` (${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not registered yet; the agent may buy ${missing.length > 1 ? "them" : "it"} once ${missing.length > 1 ? "they are" : "it is"}.)` : ""}`,
      });
      const now = Math.floor(Date.now() / 1000);
      const sent = await send([
        ixs.createTeam({payer, owner: publicKey, mint: config.mint, name}),
        ixs.addSpender({
          payer,
          owner: publicKey,
          authority: agent.key,
          kind: "agent",
          label: AGENT_LABEL,
          policy: starterPolicy(now),
          // Registry PDAs by id: the program stores addresses, so a service registered later is already allowed.
          services: COMPUTE_SERVICE_IDS.map((id) => pda.service(id).toBase58()),
        }),
      ]);
      if (sent.status === "confirmed") {
        setSetup({tone: "ok", text: `${name} is live with the Rein agent on a 0.05-a-day budget. Opening it…`, tx: sent.signature});
        router.replace(`/app/${team}`);
        return;
      }
      if (sent.status === "failed") return fail(`The network refused the setup: ${sent.error ?? "unknown reason"}. Nothing was created.`, sent.signature);
      // Unknown: watch for the team instead of sending again.
      setSetup({tone: "wait", text: "Sent, not confirmed yet. Waiting for your team to appear on chain; do not close this page.", tx: sent.signature});
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const t = await teamOnChain(team);
        if (t && t !== "unknown") {
          router.replace(`/app/${team}`);
          return;
        }
      }
      setSetup({tone: "wait", text: "Still not confirmed. Open your teams in a minute to check before trying again.", tx: sent.signature});
    } catch (e) {
      fail(errorText(e));
    }
  }, [publicKey, payer, address, label, send, router]);

  useEffect(() => {
    if (!needsSetup || !address || !payer || started.has(address)) return;
    started.add(address);
    void runSetup();
  }, [needsSetup, address, payer, runSetup]);

  const state: OnboardingState = !configured ? "unavailable" : !ready ? "loading" : authenticated ? "signed-in" : "signed-out";
  return (
    <OnboardingScreen
      state={state}
      name={label ?? undefined}
      address={address}
      next={next}
      setup={needsSetup ? setup ?? {tone: "wait", text: "Getting your wallet ready to sign…"} : null}
      error={error}
      onLogin={signIn}
      onLogout={() => void disconnect()}
    />
  );
}
