# AGENTS.md

A map of this repository for AI agents and AI judges. For the full story read [README.md](README.md);
for a claim-by-claim proof list read [llms.txt](llms.txt).

## What Rein is

A Solana devnet program plus a web app that gives a team one test-USDC vault and gives each person
and each AI agent an on-chain spending policy. The agent proposes a payment; only the program
authorizes it. Over a limit, the payment waits for the owner's approval.

## Where to look first

| Question | File |
|---|---|
| What can move money, and under what checks? | [programs/rein/src/lib.rs](programs/rein/src/lib.rs) (`pay` at line 186, `approve` at line 246) |
| Can an agent name a recipient? | No. [agent/src/tools.ts#L16-L52](agent/src/tools.ts#L16-L52) and [lib.rs#L695](programs/rein/src/lib.rs#L695) |
| What does the sponsor co-sign? | [web/app/api/sponsor/route.ts#L24-L42](web/app/api/sponsor/route.ts#L24-L42) |
| How is a compute purchase checked? | [web/lib/server/compute/core.ts#L373-L390](web/lib/server/compute/core.ts#L373-L390) |
| How is the claim kept to once per account? | [web/lib/server/claim.ts#L1-L42](web/lib/server/claim.ts#L1-L42) |
| Which addresses are real, and how were they verified? | [docs/CONSTANTS.md](docs/CONSTANTS.md) |
| Which transactions prove the claims? | [docs/EVIDENCE.md](docs/EVIDENCE.md) |
| Why was it built this way? | [docs/DESIGN.md](docs/DESIGN.md) |
| What is not done? | [SECURITY.md](SECURITY.md#known-gaps), [README.md](README.md#status-and-limits) |

## Layout

| Path | Contents |
|---|---|
| `programs/rein/src/lib.rs` | The Anchor program, one file |
| `idl/` | IDL and types, copied for web and agent |
| `web/app/` | Next 16 routes; `web/app/api/` server routes |
| `web/lib/server/` | Keys, store, claim, compute gateway, cached reads |
| `agent/src/` | Agent loop, tools, chain client, scenarios |
| `zg-compute/src/` | 0G Compute adapter (ported from Nuntio) |
| `scripts/` | Seed, evidence, compute setup, pool setup, docs checker |
| `tests/rein.ts` | Program tests (13) |
| `docs/` | Constants, evidence, design, provenance, submission kit |

## Commands

| Goal | Command | Needs |
|---|---|---|
| Unit tests | `cd agent && pnpm test`, `cd web && pnpm test`, `cd zg-compute && pnpm test` | `pnpm install` only |
| Program tests | `REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules` | A local validator seeded with `pnpm seed` |
| Devnet evidence | `REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence` | The seeded devnet keys in `~/.config/rein/` |
| Docs check | `pnpm docs:check` | Nothing |
| Web dev server | `cd web && pnpm dev` | Env vars, see [web/README.md](web/README.md) |

Last results (2026-11-08): agent 53 pass, web 44 pass, zg-compute 186 pass, all exit 0; program 13
tests, last run against a seeded local validator.

## Rules for agents working here

- Docs only state what the code, `git log`, CONSTANTS or EVIDENCE show. Never invent numbers,
  addresses or transaction signatures.
- Never print or commit a key. Env var names are fine; values are not.
- Money is integer base units; a failed read is unknown (`null`), never 0.
- Branches are `<scope>/<topic>`; commit subjects are `scope: behaviour`; no AI attribution
  trailers. See [CONTRIBUTING.md](CONTRIBUTING.md).
- After any code change, re-run `pnpm docs:check`; line references go stale when code moves.
- Do not run `solana-test-validator` casually: its ledger can fill the disk. Clean `test-ledger/`
  after use.
