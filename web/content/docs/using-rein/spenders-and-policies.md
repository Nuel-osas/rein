---
description: Every person and every agent pays under a policy the program enforces.
---

# Spenders and policies

## A spender

A spender is a person or an AI agent on a team, at the program address `["spender", team, authority]`, where the authority is the key that signs its payments. The kind, person or agent, is set when it is granted and never changes.

* A **person** is added by their Solana wallet address. They pay from **Pay** in the app.
* An **agent** is added by a keypair. Rein can generate one and shows the key once, as a file to download. The key holds no money and no SOL; all it can do is sign `pay` against its own spender account. Rein does not store it.

## The policy

| Limit | What it means | Rule the program checks |
|---|---|---|
| Allowance | The most the spender may pay in one period | Above zero |
| Period | How long a period lasts: a minute, an hour, a day, a week or 30 days | At least 60 seconds |
| Cap per payment | The most one payment may be | Above zero, and no more than the allowance |
| Payments per period | The most payments in one period | At least 1 |
| Expiry | The policy refuses from this moment on | In the future when granted |
| Services | Which registered services it may pay, up to 8 | Duplicates are dropped |

Periods roll on a schedule from the moment the spender was granted, not from the last payment. When a period ends, what was spent and counted starts again from zero.

## Inside or over

When a spender pays, the program checks four limits:

* the service is not in its list
* the amount is above its cap
* the amount would take it past its allowance for the period
* it has already made its number of payments this period

If none applies, the payment settles in the same transaction. If any applies, the payment is filed as **Pending** with each reason recorded, and waits for the owner. See [Approvals](approvals.md).

## Stops

Some things are not limits. They refuse a payment outright, and an approval cannot override them:

* the team is paused
* the spender is paused or revoked
* the policy has expired
* the service is suspended in the registry

## Changing a spender

* **Edit policy** changes the limits and the services in one transaction. What the spender already spent this period still counts.
* **Pause** and **Resume** stop and restart a spender.
* **Revoke** is final for that grant. The owner can grant the same key again later, and it comes back with a new *generation*: nothing it filed before the revoke can be approved after it.
