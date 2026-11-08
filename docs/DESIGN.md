# Design

How Rein is built, what state each part owns, how it fails, and why each choice was made. The
rejected alternatives are quoted from the commit bodies (`git log --format=%B`), with the commit.

## Architecture

| Part | Runs where | Owns | Trusts |
|---|---|---|---|
| Program ([programs/rein](../programs/rein/README.md)) | Solana devnet | `Config`, `Service`, `Team`, `Spender`, `Payment` accounts and every vault | Nothing off chain |
| Web app ([web](../web/README.md)) | Vercel (Next 16) | Nothing durable on chain; server routes hold keys and the store | The program for money, Privy for identity |
| Agent ([agent](../agent/README.md)) | Inside `/api/agent` or the CLI | Its conversation only | The program for every payment outcome |
| Compute gateway (`web/lib/server/compute/`) | Inside the web app | Quotes, run locks, results, refund records (Redis), `compute_runs` (Postgres), the gateway token account | The `Payment` account it reads itself |
| 0G adapter ([zg-compute](../zg-compute/README.md)) | Inside the web app, server only | The 0G wallet's ledger and provider sub-accounts | 0G's TEE signatures, verified per run |
| Claim pool (`web/lib/server/claim.ts`) | Inside the web app | `claims` rows (Postgres), race locks (Redis), the pool token account | Privy for who, the chain for team ownership |
| Sponsor (`web/app/api/sponsor/route.ts`) | Inside the web app | The fee payer key | Nothing it did not check in the transaction |

## Data flow

1. **Reads.** Browsers read `/api/team/[team]/state`, served from one cached copy per team
   ([web/lib/server/team-cache.ts](../web/lib/server/team-cache.ts)): fresh for 6 s, one refresher
   at a time through a Redis lock, parts that fail keep their last good value and are named
   `stale`, parts that never read stay `null` (unknown). The registry is cached for 60 s.
2. **Writes by people.** The browser builds a Rein instruction, the Privy embedded wallet signs it
   with the sponsor as fee payer, and `/api/sponsor` checks, co-signs and sends it.
3. **Writes by agents.** `/api/agent` runs the agent with a server-held or derived agent key; the
   agent signs `pay` and the server's sponsor key pays the fee.
4. **Compute.** Quote, pay, run, deliver or refund; see the sequence diagram in the
   [README](../README.md#how-it-works).
5. **Claim.** Verify the Privy user, check chain and Postgres, lock in Redis, record the signature,
   then broadcast.

## State and where it lives

| State | Where | Lifetime |
|---|---|---|
| Policies, spend this period, payment records | Program accounts | Forever (payments are never closed) |
| Team view cache | Redis (`KEEP_SEC` 300 s) or process memory | Minutes |
| Compute quote | Redis `quote:<intent>` | 25 hours |
| Compute result | Redis `result:<intent>` | 7 days |
| Refund record | Redis `refund:<intent>`, `due:<intent>` | 30 days |
| Compute run history | Postgres `compute_runs` | Durable |
| Claims | Postgres `claims` (unique per user and per wallet), Redis locks | Durable |
| Keys | Env vars in production, `~/.config/rein/` locally | Operator-managed |

## Failure handling

| Failure | Behaviour | Code |
|---|---|---|
| A chain read fails | Unknown (`null`), shown as unknown, never 0; routes refuse to act | [team-cache.ts](../web/lib/server/team-cache.ts), [claim.ts#L1-L11](../web/lib/server/claim.ts#L1-L11) |
| A transaction's fate is unknown | Pending under its recorded signature; never resent automatically | [claim.ts#L234](../web/lib/server/claim.ts#L234), [wire.ts#L94-L99](../web/lib/server/compute/wire.ts#L94-L99) |
| Redis missing in production | No store; the route answers 503 | [store.ts#L142-L143](../web/lib/server/store.ts#L142-L143) |
| Malformed config value | Budget becomes 0, floor becomes huge, cap becomes null: everything refuses | [core.ts#L76-L94](../web/lib/server/compute/core.ts#L76-L94), [claim.ts#L45-L46](../web/lib/server/claim.ts#L45-L46) |
| A paid compute run cannot happen | Full refund, once | [core.ts#L350-L357](../web/lib/server/compute/core.ts#L350-L357) |
| A payment over a limit | Filed Pending, not reverted | [lib.rs#L236-L240](../programs/rein/src/lib.rs#L236-L240) |

## Decisions, and what was rejected

| Decision | Why | Rejected alternative (commit) |
|---|---|---|
| The pause is an account state and the intent is the `Payment` PDA seed | NEAR's yield/resume has no Solana equivalent | Porting Bursar's NEAR flow literally (86e4e89) |
| Explicit account metas in IDL order for writes | Every instruction stays readable and the sponsor can check it | "Anchor's Program client for writes" (7754d8f) |
| Google sign-in only, through Privy's embedded Solana wallet | The brief narrowed sign-in to Google with an embedded wallet | "keeping wallet-adapter beside Privy for external wallets" (0df3fae) |
| The agent package is built with the app through a pnpm workspace | A web-only deploy must install the agent's dependencies | "A relative import" (84591f9) |
| Each team's agent key is derived from `REIN_AGENT_SEED` and the team | No per-team secret is stored anywhere | "generating and storing a keypair per team (one more secret store to guard and back up)" (6ecd3d7) |
| The compute gateway reads the `Payment` itself | A client could lie about an address or amount | "trusting a payment address or amount sent by the client, and auto-retrying a refund whose preflight failed (an operator decides)" (ff3f66a) |
| Port an existing, tested 0G adapter whole | It already handled pricing, funding and verification | "rewriting a smaller adapter from scratch in the time box, and stripping voice/image/video, which are woven through backend.ts" (9d223c2) |
| Price each quote from 0G's live worst case x 1.5 | 0G prices follow its USD rate and move | "a fixed per-token catalog ... and keeping the fake available in production behind the flag" (1619240) |
| Add 0G Private Computer (Router) as a backend | One key, no wallet, no ledger that needs 3 0G to open; the SDK stays as fallback | not stated (bcd33b6) |
| The faucet tops up only the demo team | Otherwise anyone could mint test USDC and buy real 0G compute | "a per-team daily mint cap, which still lets anyone create teams and drain the 0G budget" (d9e1330) |
| The claim pays from a pre-funded pool | The pool balance is a hard cap and the mint key stays cold | "minting from the mint authority per claim, which would make that key hot and leave no cap" (ac31faa); "topping up on every run ... would turn the cap into a suggestion" (62d74a9) |
| The pool was cut to 6 test USDC by burning 43.9 | Sized to a $5 0G budget; a burn leaves no second balance to track | sending the excess elsewhere (7ab4af9) |
| A Redis/Postgres store that fails closed in production | Per-instance memory would reset counters, locks and refund records and could double-spend | "falling back to [memory] in production" (87884e3) |
| The signed-in agent route needs a Privy session for a team | A team sent without a session could be anyone's | "trusting a team sent without a session, and falling back to the demo agent's key for other teams" (2c56337) |
| The agent's compute client is in-process for the web | One deployment, and the package imports no web code | "an HTTP-only client ... and importing web code" (c3ff35c) |
| One shared cached read per team | Devnet's public RPC rate-limits `getProgramAccounts` per IP; a poller per browser failed in production | a poller per browser (2a53cf4) |
| Top-level routes re-export the `/app/[team]` pages | Privy keeps the session in the browser, so the server cannot tell who is signed in | "A server redirect" (9750717) |
| Invites carry `{team, label}` in the link, no server storage | One owner adds spenders by address | "A server-side request queue ... would add storage and a trust point for no gain" (fd45b29) |
| Pages that duplicated others or described things Rein does not do were deleted | Nothing keeps compiling, shipping or being linked by accident | hiding them (a73c14a) |
| Privacy and terms written from the code | They must describe what the code does | "a template ... would claim practices the code does not have" (f8af49d) |

## What is not designed yet

Closing decided `Payment` accounts to reclaim rent, global rate limits, a mainnet token and a
multisig upgrade authority. See [SECURITY.md](../SECURITY.md#known-gaps).
