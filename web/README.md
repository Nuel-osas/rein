# web (`@rein/web`)

The Rein web app: Next 16.4.3 and React 19.3.1, deployed at https://rein-navy.vercel.app. Sign-in
is Google only, through Privy (`loginMethods: ['google']` in [lib/wallet.tsx](lib/wallet.tsx)),
and each person's Privy embedded Solana wallet signs their Rein transactions. The server holds the
fee sponsor, the demo keys, the claim pool and the 0G compute gateway. UI screens are adapted from
an earlier web app with its author's agreement ([docs/PROVENANCE.md](../docs/PROVENANCE.md)).

## Pages

Routes under [app/](app). Own-team routes are gated by
`app/(app)/(own)/layout.tsx`: signed out goes to `/onboarding` with
a return path; signed in with no team goes to `/teams/new`. Each own-team page re-exports the
matching `/app/[team]/…` page, so both URL sets render the same screen. Every `/app/[team]/…`
screen is readable by anyone, wallet or not.

| Route | What it is |
|---|---|
| `/` | Landing; reads the demo team live |
| `/demo` | Public demo: run the agent on the demo team, approve or decline its Pending payments, no sign-in |
| `/docs`, `/docs/[...slug]` | Documentation rendered from markdown in [content/docs](content/docs) |
| `/security`, `/privacy`, `/terms` | Security checks with devnet links; privacy and terms |
| `/onboarding` | Google sign-in through Privy, then the return path or `/dashboard` |
| `/signin` | Redirects to `/onboarding`, keeping a safe `?next=` |
| `/auth/callback` | The same sign-in component as `/onboarding` |
| `/dashboard` | Home: vault balance, team summary, the $0.30 claim card, Get started checklist and tour |
| `/spenders`, `/spenders/new`, `/spenders/[id]`, `/spenders/[id]/edit` | Team: people and agents together, add, detail, edit policy |
| `/agents/new`, `/agents/[key]` | Add an agent, agent detail (same form and detail screens) |
| `/approvals` | Pending payments for the owner to approve or decline |
| `/activity`, `/activity/[id]` | Payment history and a receipt per payment |
| `/pay` | Pay a registered service by hand |
| `/compute`, `/compute/[intent]` | 0G compute: a service picker (Chat, Image, Voice, Claude, GPT, Video) with the right input per kind, the trust level on each card, the assistant, purchases, and one run's payment and result (text, image, transcript or clip) or refund |
| `/settings` | Team settings, including the owner's withdraw |
| `/teams/new` | Where a signed-in person with no team lands: one sponsored transaction, `create_team` plus `add_spender` for the Rein agent with the starter policy ([components/app/rein/TeamSetup.tsx](components/app/rein/TeamSetup.tsx)); also `/app/teams/new` |
| `/invite/[token]` | Invite link; decoded in the browser, nothing stored, works signed out |
| `/app` | Your teams |
| `/app/[team]`, `/app/[team]/…` | Public mirror of every own-team screen above for any team address |

Redirects in [next.config.ts](next.config.ts) (307): `/agents` to `/spenders`, `/assistant` to
`/compute`, and the same under `/app/[team]`. Security headers there set `frame-ancestors 'self'`,
`X-Frame-Options`, `nosniff` and a referrer policy.

## Server routes

Every route is under [app/api](app/api). Rate limits come from
[lib/server/limit.ts](lib/server/limit.ts): in memory, per server instance, keyed by IP unless
noted.

| Route | Method | Purpose | Auth | Limit |
|---|---|---|---|---|
| [/api/sponsor](app/api/sponsor/route.ts) | GET | The sponsor's public key | none | none |
| [/api/sponsor](app/api/sponsor/route.ts) | POST | Checks a partly signed transaction, co-signs as fee payer and sends it. Only Rein instructions (plus compute-budget and one own token account create); the sponsor may appear only as fee payer or `payer` of `pay`, `create_team`, `add_spender` | Privy token optional; an invalid one is refused | 30/min per user, else 20/min per IP |
| [/api/claim](app/api/claim/route.ts) | GET | Pool balance, claims taken, and with a token whether this user claimed | optional Privy token | 60/min |
| [/api/claim](app/api/claim/route.ts) | POST | 0.30 test USDC once per Privy user and once per wallet into the vault of the team the user's wallet owns | Privy token required; wallet must own the team | 10/min per IP and 5/min per user |
| [/api/agent](app/api/agent/route.ts) | POST | Runs the buying agent and streams one JSON event per line. Without `team`, the demo team | demo: none; own team: Privy token of the owner | 6 per 10 min (IP for demo, user for own team) |
| [/api/agent/key](app/api/agent/key/route.ts) | GET | A team's agent public key, derived on the server from `REIN_AGENT_SEED` | none | 60/min |
| [/api/demo](app/api/demo/route.ts) | POST | Approve or decline a demo-team Pending payment with the demo owner key, or reset the demo vault to 500 | none (demo team only) | 30/min, reset 4/min |
| [/api/faucet](app/api/faucet/route.ts) | POST | Mints up to 100 test USDC into the demo team's vault only | none (demo team only) | 3 per 10 min |
| [/api/services](app/api/services/route.ts) | GET | The service registry, cached 60 s and shared | none | none |
| [/api/team/[team]/state](app/api/team/[team]/state/route.ts) | GET | The team view's data from the shared cache; `?fresh=1` skips the freshness window | none | 120/min; fresh 20/min |
| [/api/compute/catalog](app/api/compute/catalog/route.ts) | GET | Every compute service with its kind, trust level ("TEE verified" or "Relayed, no TEE"), whether this server is configured for it, and a live price | none | 60/min |
| [/api/compute/quote](app/api/compute/quote/route.ts) | POST | Prices one 0G run (a prompt, or for `ai-voice` an audio clip whose sha256 is bound into the intent) and returns the intent to pay it under. Nothing moves | none | 30 per 10 min |
| [/api/compute/buy](app/api/compute/buy/route.ts) | POST | Quotes a run and pays it with the team's Rein agent key under its policy (the Compute page's direct buy, for every kind); the caller then calls `/api/compute/run` | as `/api/agent`: demo team none, own team the owner's Privy token | 6 per 10 min (IP for demo, user for own team) |
| [/api/compute/run](app/api/compute/run/route.ts) | POST | Runs a paid quote once after reading the Payment PDA from chain; refunds if the run cannot happen. For `ai-video` it starts the clip job and answers 202 running | none (the payment is the capability) | 60 per 10 min |
| [/api/compute/result/[intent]](app/api/compute/result/[intent]/route.ts) | GET | A stored result (7 days) or its refund. For a started `ai-video` job each call reads the job's status once and, when it is done, stores the clip | the unguessable HMAC intent | 120 per 10 min |
| [/api/compute/result/[intent]/blob](app/api/compute/result/[intent]/blob/route.ts) | GET | The image of an `ai-image` run or the MP4 of an `ai-video` run, from Postgres `compute_results`, served only as the type its bytes show | the unguessable HMAC intent | 120 per 10 min |

Compute logic lives in [lib/server/compute/core.ts](lib/server/compute/core.ts) with every outside
effect injected; [lib/server/compute/wire.ts](lib/server/compute/wire.ts) wires the real chain
reads, store, refund and backend. The services are in
[lib/server/compute/catalog.ts](lib/server/compute/catalog.ts), and each picks its own backend:
`ai-chat`, `ai-image` and `ai-voice` run on the 0G Compute SDK through `@rein/zg-compute`
([lib/server/compute/backend.ts](lib/server/compute/backend.ts)) with the gateway's 0G wallet,
whether or not the Router key is set (the Router's private mode returned no `tee_verified` on
2026-11-09, so a Router chat could not be called verified); `ai-claude`, `ai-gpt` and `ai-video`
run only on the 0G Router (0G Private Computer, [lib/server/compute/router.ts](lib/server/compute/router.ts)),
relayed with no TEE. `ai-video` is a job: `run` starts it (Router `POST /v1/videos`) and each
result read checks it once, so no request waits for a clip (the routes cap at 60 s; the project's
Vercel default is 300 s on the Hobby plan with Fluid compute). A server without
`ZG_ROUTER_API_KEY` shows "Needs 0G Private Computer key" for the Router services and refunds a
paid run in full. Nothing is faked: a paid run that cannot happen is refunded.

## How chain reads are cached

Browsers do not poll the RPC. They read `/api/team/[team]/state` and `/api/services`, served by
[lib/server/team-cache.ts](lib/server/team-cache.ts):

| Behaviour | Code |
|---|---|
| A team read is fresh for 6 s (`FRESH_MS`) and kept 300 s (`KEEP_SEC`) in Redis, else in memory | [lib/server/team-cache.ts#L17](lib/server/team-cache.ts#L17), [L18](lib/server/team-cache.ts#L18) |
| One refresh at a time per team: in-process, then across instances with a Redis `SET NX` lock | [lib/server/team-cache.ts#L74](lib/server/team-cache.ts#L74) |
| A part that fails to read keeps its last good value and is named in `stale`; a part that never read stays null (unknown, never zero) | [lib/server/team-cache.ts#L47](lib/server/team-cache.ts#L47) |
| The registry is cached 60 s | [lib/server/team-cache.ts#L97](lib/server/team-cache.ts#L97) |

The server's RPC is `REIN_RPC_URL` when set, else `NEXT_PUBLIC_RPC_URL`, else the public devnet
endpoint ([lib/server/send.ts#L12](lib/server/send.ts#L12), [lib/chain.ts#L12](lib/chain.ts#L12)).

## Environment variables

Names only. Server keys are JSON byte arrays in env; outside production, or with
`REIN_ALLOW_KEY_FILES=1`, they can also come from files in ~/.config/rein
([lib/server/keys.ts#L36](lib/server/keys.ts#L36)).

| Group | Variables | Read in |
|---|---|---|
| Public | `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CLUSTER`, `NEXT_PUBLIC_DEMO_TEAM`, `NEXT_PUBLIC_PRIVY_APP_ID` | [lib/chain.ts](lib/chain.ts), [lib/wallet.tsx](lib/wallet.tsx) |
| Privy | `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY` | [lib/server/privy.ts](lib/server/privy.ts) |
| Chain | `REIN_RPC_URL` | [lib/server/send.ts](lib/server/send.ts) |
| Keys | `REIN_SPONSOR_SECRET`, `REIN_DEMO_OWNER_SECRET`, `REIN_MINT_AUTHORITY_SECRET`, `REIN_DEMO_AGENT_SECRET`, `REIN_POOL_SECRET`, `REIN_GATEWAY_SECRET`, `REIN_KEYS_DIR`, `REIN_ALLOW_KEY_FILES` | [lib/server/keys.ts](lib/server/keys.ts) |
| Store | `REDIS_URL`, `DATABASE_URL`, `REIN_ALLOW_MEMORY_STORE` | [lib/server/store.ts](lib/server/store.ts) |
| Agent | `GROQ_API_KEY`, `REIN_AGENT_SEED`, `REIN_AGENT_MODEL` (read by `@rein/agent` inside the route) | [app/api/agent/route.ts](app/api/agent/route.ts), [lib/server/agent-key.ts](lib/server/agent-key.ts), [../agent/src/agent.ts](../agent/src/agent.ts) |
| Compute | `GATEWAY_SECRET`, `COMPUTE_ENABLED`, `COMPUTE_DAILY_BUDGET_USD`, `ZG_LEDGER_FLOOR_USD`, `ZG_PRIVATE_KEY`, `ZG_ROUTER_API_KEY`, `ZG_MAX_LEDGER_ZG`, `COMPUTE_CLAUDE_MODEL`, `COMPUTE_GPT_MODEL`, `COMPUTE_VIDEO_MODEL`, `COMPUTE_RELAYED_MAX_TOKENS`, `COMPUTE_FAKE_UPSTREAM`, `COMPUTE_FAKE_FAIL` (the two fake flags are dev only) | [lib/server/compute/core.ts](lib/server/compute/core.ts), [lib/server/compute/wire.ts](lib/server/compute/wire.ts) |
| Claim | `CLAIM_TOTAL_CAP` | [lib/server/claim.ts](lib/server/claim.ts) |

In production a missing `REDIS_URL` makes the store null and the compute and claim routes answer
503 rather than fall back to memory ([lib/server/store.ts](lib/server/store.ts)).

## Commands

```bash
pnpm dev         # next dev on 127.0.0.1, port 4291 unless PORT is set
pnpm test        # tsx --test lib/server/compute/*.test.ts lib/server/*.test.ts lib/*.test.ts
pnpm typecheck
pnpm build
```

Tests re-run 2026-11-09: 67 tests in 18 suites, 67 pass, 0 fail, exit 0. `pnpm typecheck` and
`pnpm build` were not run for this document. There is no lint script.

| File | Tests |
|---|---|
| [lib/server/compute/core.test.ts](lib/server/compute/core.test.ts) | 25 |
| [lib/server/compute/router.test.ts](lib/server/compute/router.test.ts) | 7 |
| [lib/server/team-cache.test.ts](lib/server/team-cache.test.ts) | 5 |
| [lib/get-started.test.ts](lib/get-started.test.ts) | 7 |
