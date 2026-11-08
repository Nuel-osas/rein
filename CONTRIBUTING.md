# Contributing

How changes reach `main` in this repository, what to run before pushing, and which environment
variables exist. Read [SECURITY.md](SECURITY.md) before touching anything that signs or moves money.

## Setup

```bash
pnpm install          # root, web, agent and zg-compute (pnpm workspace)
cd web && pnpm dev    # http://127.0.0.1:4291
```

Program work needs the Solana CLI and Anchor 0.31. Keys for local runs live in `~/.config/rein/`
(see [SECURITY.md](SECURITY.md#key-handling)); never inside the repository.

## Branches, commits and pull requests

These are the conventions the history follows; `git log --graph --oneline` shows them.

| Rule | Real examples from this repo |
|---|---|
| Branch from an up-to-date `main` as `<scope>/<topic>`, one theme per branch | program/policy-vault, agent/groq-buyer, web/console, compute/gateway, compute/claim, docs/zg-constants, web/strip-down |
| Commit subject: lowercase scope, a colon, then one sentence saying what behaviour changed | `program: test every rule and stop against a seeded validator`, `compute: stop the faucet minting test USDC for any team but the demo team`, `web: serve team data from one shared cached read instead of a poller per browser` |
| Commit body: why, and the alternative that was rejected | `Rejected: a per-team daily mint cap, which still lets anyone create teams and drain the 0G budget.` (d9e1330) |
| Scopes in use | `program`, `agent`, `web`, `compute`, `scripts`, `docs`, `repo` |
| Every change reaches `main` through a pull request merged with a merge commit | `Merge pull request #15 from Nuel-osas/web/cached-reads` |
| No AI attribution trailers (`Co-Authored-By`, "Generated with") in commits or PRs | none in the history |
| A merged branch is closed; later work on the same feature gets a new branch from `main` | web/remove-vault then web/strip-down |

PR description: What changed, Why, How it was verified (commands, tests, transaction signatures),
Still open. "It compiles" is not verification.

## Before you push

Run what you touched. Report failures with their output and skipped steps as skipped.

| Area | Commands |
|---|---|
| Program | `anchor build`; `REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules` against a local validator seeded with `pnpm seed`. If the IDL changed, copy it to `idl/` and `web/lib/idl/` |
| Agent | `cd agent && pnpm typecheck && pnpm test` |
| Web | `cd web && pnpm typecheck && pnpm test && pnpm build` |
| zg-compute | `cd zg-compute && pnpm typecheck && pnpm test` |
| Docs | `pnpm docs:check` (links, line references and paths in every `.md` and `llms.txt`) |
| Secrets | Scan the staged diff for keys before every push, for example `git diff --cached \| grep -nE '\[[0-9]{1,3}(,[0-9]{1,3}){31,}\]\|sk-\|0x[0-9a-fA-F]{64}'` |

Line references in docs (`programs/rein/src/lib.rs#L186`) go stale when code moves. Re-run `pnpm docs:check` after
any code change and fix what it reports.

## Rules that are not negotiable

- Fail closed: missing, malformed, expired or paused input is refused, never defaulted.
- A failed read is unknown (`null`), never 0.
- Money stays in integer base units (`bigint`, `u64`) end to end; format only for display.
- An ambiguous transaction status is pending, never failed, so nobody pays twice.
- Every new address or chain constant goes in [docs/CONSTANTS.md](docs/CONSTANTS.md) with how it
  was verified.
- Never print, commit or share a private key or API key. Env var names are fine; values are not.

## Environment variables

Names only. Where each is read is in the package READMEs ([web](web/README.md),
[agent](agent/README.md)).

| Area | Names |
|---|---|
| Public (browser) | `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CLUSTER`, `NEXT_PUBLIC_DEMO_TEAM` |
| Sign-in | `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY` |
| Chain | `REIN_RPC_URL`, `REIN_CLUSTER`, `REIN_PROGRAM_ID`, `REIN_ADMIN_KEYPAIR` |
| Server keys | `REIN_SPONSOR_SECRET`, `REIN_DEMO_OWNER_SECRET`, `REIN_DEMO_AGENT_SECRET`, `REIN_MINT_AUTHORITY_SECRET`, `REIN_POOL_SECRET`, `REIN_GATEWAY_SECRET`, `REIN_KEYS_DIR`, `REIN_ALLOW_KEY_FILES` |
| Store | `REDIS_URL`, `DATABASE_URL`, `REIN_ALLOW_MEMORY_STORE` |
| Agent | `GROQ_API_KEY`, `REIN_AGENT_MODEL`, `REIN_AGENT_SEED`, `REIN_AGENT_SECRET`, `REIN_TEAM`, `REIN_GATEWAY_URL` |
| Compute | `GATEWAY_SECRET`, `COMPUTE_ENABLED`, `COMPUTE_DAILY_BUDGET_USD`, `ZG_LEDGER_FLOOR_USD`, `ZG_PRIVATE_KEY`, `ZG_ROUTER_API_KEY`, `ZG_MAX_LEDGER_ZG`, `COMPUTE_FAKE_UPSTREAM`, `COMPUTE_FAKE_FAIL` |
| Claim | `CLAIM_TOTAL_CAP` |

## Documentation

The index is [docs/README.md](docs/README.md). When code and [docs/CONSTANTS.md](docs/CONSTANTS.md)
disagree about an address, CONSTANTS wins and the code is the bug. Write plainly, with tables and
exact values, and never invent a number, address or transaction.
