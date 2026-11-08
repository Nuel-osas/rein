---
description: What stops a bad payment in Rein, and where each check lives.
---

# Security model

Rein is built so that the thing proposing a payment, a person, the app or an AI agent, is never the thing that authorizes it. The program authorizes, and it checks the same rules whoever is asking.

## The guarantees

### The payee must match the registry

`pay` takes a registered service, never an address. The payee token account must equal the one in the service's registry account, or the program refuses with `WrongPayee`. A service id that is not registered has no account, and the transaction fails. An agent cannot be talked into paying a stranger, because no tool and no instruction lets it name one.

### Limits file, stops refuse

Over a limit (cap, allowance, count, or a service outside the list), a payment is filed as Pending and no money moves until the owner decides. A stop (paused team, paused or revoked spender, expired policy, suspended service) refuses the payment outright.

### Approval never overrides a stop

At approval time the program checks the stops again. If the spender was paused, revoked or re-granted since the payment was filed, if the policy has expired, or if the service was suspended or its payee changed, the payment is refused for good. The owner's approval waives a budget. It does not waive a stop.

### Intent-seeded payments

A payment record's address is derived from (spender, intent). The same intent cannot be paid or filed twice, so a retry after a timeout cannot double-pay.

### Only the owner moves money out

The vault's authority is the team's program address. Money leaves it only through `pay`, `approve` and `withdraw`, and only the owner can approve or withdraw.

### The sponsor pays fees, nothing else

The sponsor co-signs only transactions made of Rein's user instructions and capped fee settings, and its key may appear only as the fee payer and the rent payer. It cannot be used to sign for anything else. See [The sponsor](../how-it-works/the-sponsor.md).

### Unknown is never zero

A balance or a result the app cannot read is shown as unknown, never as zero or failed. An unconfirmed payment is shown as pending with its signature, so nobody pays twice. Money stays in integer base units end to end.

## Checked on chain

Each guarantee above that a transaction can show was run on devnet: an agent with 0 SOL paying inside its policy, a payment over the cap filed and then approved, a made-up service refused, and an attacker's payee refused. The transactions are in [Evidence](../resources/evidence.md).

## What this does not protect

* **A stolen owner wallet.** Whoever controls the owner's Google account controls the team.
* **A leaked agent key.** It can spend up to that agent's policy, no more. Revoke the agent and the key is useless, and nothing it filed before the revoke can be approved.
* **The registry admin.** The admin chooses which services exist and who they pay. On devnet the admin is the deployer's CLI wallet.

More in [Still open](still-open.md).
