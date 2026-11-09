"use client";

// "Setting up your team": a signed-in person with no team gets one in one sponsored transaction,
// [create_team, add_spender], signed by their Privy embedded wallet. The team is named from their
// Google name (or "My team"); the Rein agent (key from GET /api/agent/key) is granted the gateway
// catalog's services (ai-chat on 0G today) at 0.30 per 30 days, 0.05 a run, 20 runs, for 30 days.
//
// A self-contained component, so whichever page a no-team person lands on (/app/teams/new here, the
// top-level /teams/new in the routes lane) can render it. It runs once per wallet per page load. An
// unreadable chain never sends; a refused setup offers a retry and the `fallback` (the manual form);
// an unconfirmed one watches for the team instead of sending again. Done, it goes to `next`.

import {useRouter} from "next/navigation";
import {useCallback, useEffect, useState, type ReactNode} from "react";
import {PublicKey} from "@solana/web3.js";
import {AGENT_LABEL, fetchAgentKey, fetchCatalog, grantable, readComputeServices, starterPolicy, teamNameFor} from "@/lib/agent-setup";
import {PROGRAM_ID, connection} from "@/lib/chain";
import {ixs, pda, readConfig, toTeam} from "@/lib/rein";
import {errorText, useWallet} from "@/lib/wallet";
import {Button} from "../Button";
import {PageHeader} from "../PageHeader";
import {SignInPrompt} from "../WalletButton";
import {StatusLine, type Status} from "./bits";
import styles from "./rein.module.css";

/** One setup per wallet per page load, even when React runs effects twice. */
const started = new Set<string>();

async function teamOnChain(team: string): Promise<{name: string} | null | "unknown"> {
  try {
    const info = await connection().getAccountInfo(new PublicKey(team), "confirmed");
    return info && info.owner.equals(PROGRAM_ID) ? toTeam(team, info) : null;
  } catch {
    return "unknown";
  }
}

type Phase = "checking" | "working" | "failed" | "done";

export function TeamSetup({next = "/dashboard", fallback}: {next?: string; fallback?: ReactNode}) {
  const {authenticated, address, publicKey, payer, label, send} = useWallet();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<Status>(null);

  const run = useCallback(async () => {
    if (!publicKey || !payer) return;
    const team = pda.team(publicKey).toBase58();
    const fail = (text: string, tx?: string | null) => {
      setPhase("failed");
      setStatus({tone: "bad", text, tx});
    };
    setPhase("working");
    try {
      setStatus({tone: "wait", text: "Reading the Rein registry, the compute catalog and your agent’s key…"});
      const conn = connection();
      const [existing, config, agent, catalog] = await Promise.all([teamOnChain(team), readConfig(conn), fetchAgentKey(team), fetchCatalog()]);
      if (existing === "unknown") return fail("Could not read the chain, so nothing was sent. Your team, if you have one, is unchanged.");
      if (existing) {
        setPhase("done");
        setStatus({tone: "ok", text: `You already have ${existing.name}. Opening it…`});
        router.replace(next);
        return;
      }
      if (!config) return fail("Could not read the Rein config from chain, so the token is unknown. Nothing was sent.");
      if (!agent.ok) return fail(agent.missing ? `${agent.error} Nothing was sent.` : agent.error);
      if (!catalog.ok) return fail(`Compute is not configured on this deployment yet: ${catalog.error} Nothing was sent.`);
      // Only services registered and active in the registry are granted; the catalog also lists ones it cannot sell yet.
      const ids = grantable(catalog).map((s) => s.id);
      const registered = await readComputeServices(conn, ids);
      const missing = registered ? registered.rows.filter((r) => !r.service).map((r) => r.id) : [];
      const name = teamNameFor(label);
      setStatus({
        tone: "wait",
        text: `Creating ${name} and giving the Rein agent $0.30 a month for AI compute…${missing.length ? ` (${missing.join(", ")} is not registered on chain yet; the agent may buy it once it is.)` : ""}`,
      });
      const sent = await send([
        ixs.createTeam({payer, owner: publicKey, mint: config.mint, name}),
        ixs.addSpender({
          payer,
          owner: publicKey,
          authority: agent.key,
          kind: "agent",
          label: AGENT_LABEL,
          policy: starterPolicy(Math.floor(Date.now() / 1000)),
          // Registry PDAs by id: the program stores addresses, so a service registered later is already allowed.
          services: ids.map((id) => pda.service(id).toBase58()),
        }),
      ]);
      if (sent.status === "confirmed") {
        setPhase("done");
        setStatus({tone: "ok", text: `${name} is live, with the Rein agent on a $0.30-a-month compute budget. Opening it…`, tx: sent.signature});
        router.replace(next);
        return;
      }
      if (sent.status === "failed") return fail(`The network refused the setup: ${sent.error ?? "unknown reason"}. Nothing was created.`, sent.signature);
      // Unknown: watch for the team instead of sending again.
      setStatus({tone: "wait", text: "Sent, not confirmed yet. Waiting for your team to appear on chain; do not close this page.", tx: sent.signature});
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const t = await teamOnChain(team);
        if (t && t !== "unknown") {
          setPhase("done");
          router.replace(next);
          return;
        }
      }
      setStatus({tone: "wait", text: "Still not confirmed. Check again in a minute before trying again.", tx: sent.signature});
    } catch (e) {
      fail(errorText(e));
    }
  }, [publicKey, payer, label, send, router, next]);

  useEffect(() => {
    if (!authenticated || !address || !payer || started.has(address)) return;
    started.add(address);
    void run();
  }, [authenticated, address, payer, run]);

  return (
    <div className={styles.section}>
      <PageHeader
        kind="teams"
        title="Setting up your team"
        description="One transaction creates your team and its vault, and gives your Rein agent a $0.30-a-month compute budget you can change any time. The sponsor pays the fee; you need no SOL."
      />
      {!authenticated ? (
        <SignInPrompt action="set up your team" note="Google sign-in gives you a Solana wallet." />
      ) : (
        <div className={styles.panel}>
          <StatusLine status={status ?? {tone: "wait", text: address ? "Getting your wallet ready to sign…" : "Creating your Solana wallet…"}} />
          {phase === "failed" ? (
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void run()}>
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {phase === "failed" && fallback ? fallback : null}
    </div>
  );
}
