---
description: The Anchor program on Solana devnet: its accounts, its instructions, and the rules it enforces.
---

# The program

Rein's rules live in one Anchor program, `programs/rein`, deployed on devnet at [`F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`](https://explorer.solana.com/address/F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe?cluster=devnet). The web app and the agent only prepare transactions. The program decides.

## Accounts

| Account | Address seeds | What it holds |
|---|---|---|
| Config | `["config"]` | The registry's admin, the token teams hold, and how many services are registered |
| Service | `["service", id]` | A service's id, label, payee, payee token account, list price, and whether it is active |
| Team | `["team", owner]` | Owner, token, vault, name, paused, and running totals |
| Spender | `["spender", team, authority]` | Kind, label, status, generation, policy, allowed services, and what was spent and counted this period |
| Payment | `["payment", spender, intent]` | Who filed it, the service and payee, amount, intent, memo, reasons, status, deadline, and its number in the team |

## Instructions

| Instruction | Who signs | What it does |
|---|---|---|
| `init_config` | Registry admin | Creates the registry once per deployment |
| `register_service`, `set_service_active` | Registry admin | Lists a service with its payee, or suspends and reactivates it |
| `create_team` | Owner | Creates the team and its vault |
| `set_paused` | Owner | Pauses or resumes the whole team |
| `withdraw` | Owner | Moves money from the vault to an account the owner names |
| `add_spender` | Owner | Grants a person or an agent a policy, or grants a revoked one again with a new generation |
| `set_policy`, `set_services` | Owner | Changes a spender's limits or its services |
| `set_spender_status`, `revoke` | Owner | Pauses or resumes a spender, or revokes it |
| `pay` | Spender | Pays a registered service, or files the payment as Pending |
| `approve`, `decline` | Owner | Decides a Pending payment |
| `cancel` | Owner or the filer | Withdraws a Pending payment |

## The rules

| Rule | Where it is enforced |
|---|---|
| Inside the policy, a payment settles at once | `pay` |
| Over the cap, the allowance, the count, or outside the allowed services: filed as Pending, with every reason recorded | `pay`, `over_limits` |
| An approval waives a budget, never a stop. Revoked, re-granted, expired or suspended at approval time means refused for good | `approve` |
| A paused team, a paused or revoked spender, or an expired policy refuses outright | `pay` |
| Only the owner approves, declines, withdraws or changes policies. The filer can cancel its own pending payment | account constraints |
| The payee must be the token account the registry names | `pay` and `approve` account constraints |
| An intent is paid or filed at most once | the payment record's address is derived from (spender, intent) |

## Why Solana

| What Rein does | The Solana feature it rests on |
|---|---|
| An agent is a keypair that holds no money and no SOL. The program checks it against its own Spender account | Accounts and program addresses: the policy is state the program owns |
| Spenders never hold SOL | A transaction's fee payer is a separate signer from its authority |
| Over a limit, `pay` files a Pending payment, and the owner's approval settles it in one more transaction | Sub-second confirmation and fees under a cent make a per-payment approval loop practical |
| An intent is paid or filed at most once, even if an agent retries | A record's address derived from (spender, intent) cannot be created twice |
| `pay` takes a service, never an address | The payee token account must equal the one in the on-chain registry |
| Anyone can top up a team | The vault is a plain SPL token account |

## Tests

The repository has 13 program tests covering every rule and stop, run against a local validator:

```bash
pnpm seed
REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules
```
