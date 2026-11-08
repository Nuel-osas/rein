# Rein

**Spending rules for teams and their AI agents, enforced by a Solana program.**

A team shares one USDC vault. Every person and every AI agent on it pays under a policy the
program enforces:

- an allowance per period
- a cap on each payment
- a limit on the number of payments
- an expiry date
- a list of the services it may pay

Over a limit, the payment waits for the owner. One tap on Approve and it settles in the same
transaction, in under a second.

> The agent proposes a payment. Only the program authorizes it.

Built for MLH's [Solana Hackathon](https://www.mlh.com/events/solana-hackathon) (Nov 6 to 8, 2026).
Rein is the Solana version of Bursar, our NEAR build of the same rules. See
[`docs/PROVENANCE.md`](docs/PROVENANCE.md).

| | |
|---|---|
| Live app | LIVE_URL |
| Demo team (no wallet needed) | LIVE_URL/app/DEMO_TEAM |
| Program (devnet) | [`F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`](https://explorer.solana.com/address/F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe?cluster=devnet) |
| On-chain evidence | [`docs/EVIDENCE.md`](docs/EVIDENCE.md) |

## Why it needs Solana

| What Rein does | The Solana feature it rests on |
|---|---|
| An agent is a keypair that holds no money and no SOL. The program checks it against its own Spender account | Accounts and PDAs: the policy is state the program owns, not a setting in a wallet provider |
| Spenders never hold SOL. A sponsor pays every fee and the rent of each payment record | A transaction's fee payer is a separate signer from its authority |
| Over a limit, `pay` does not revert. It files a Pending payment in the same transaction, and the owner's approval settles it in one more | Sub-second confirmation and fees under a cent make a per-payment approval loop practical |
| An intent is paid or filed at most once, even if an agent retries | The payment record's address is derived from (spender, intent), so a second one cannot be created |
| `pay` takes a service, never an address. A prompt-injected agent cannot name a payee | The payee token account must equal the one in the on-chain Service registry |
| Anyone can top up a team: it is a plain token account owned by the team's PDA | SPL tokens compose: any wallet or program can send to the vault |

## The rules

| Rule | Where it is enforced |
|---|---|
| Inside the policy, a payment settles at once | `pay` |
| Over the cap, the allowance, the count, or outside the allowed services: filed as Pending, with every reason recorded | `pay`, `over_limits` |
| An approval waives a budget, never a stop. Revoked, re-granted, expired or suspended at approval time means refused for good | `approve` |
| A paused team, a paused or revoked spender, or an expired policy refuses outright | `pay` |
| Only the owner approves, declines, withdraws or changes policies. The filer can cancel its own pending payment | account constraints |
| A failed read is unknown, never zero. Money is integer base units end to end | the web app and agent |

## Check it yourself

```bash
pnpm install
# the four claims on devnet, each with an explorer link (needs a funded CLI wallet and a seeded cluster)
REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence
# every rule and stop, against a local validator seeded with `pnpm seed`
REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules
```

## Repository

| Path | What it is |
|---|---|
| `programs/rein` | The Anchor program: teams, spenders, the service registry, pay, approve, decline, cancel |
| `idl/` | The program's IDL and TypeScript types, used by the web app and the agent |
| `web/` | Next.js app: landing, a public view of any team, owner console, demo actions, sponsor relay |
| `agent/` | The AI agent: a Groq-hosted model with three tools, `list_services`, `check_budget`, `pay`. None takes an address |
| `scripts/` | `seed.ts` sets up a cluster; `evidence.ts` proves the claims on chain |
| `tests/` | 13 program tests covering every rule and stop |
| `docs/` | Constants, evidence, provenance, submission kit |

## Still open

- Devnet only. Mainnet would use Circle USDC and hand the upgrade key to a multisig.
- Payment records are never closed, so their rent is not reclaimed.
- Period rollover is not covered by a test (the shortest period is 60 seconds).
- The sponsor relay rate-limits per IP in memory; a determined visitor could still spend its devnet SOL.
