---
description: The team account, its vault, and what only the owner can do.
---

# Teams and the vault

## The team

A team lives at the program address `["team", owner]`. It records:

| Field | What it is |
|---|---|
| Owner | The wallet that created it. The only wallet that can change it |
| Mint | The token the team holds. On devnet, Rein's test USDC |
| Vault | The token account that holds the money |
| Name | 1 to 32 characters |
| Paused | When true, every payment and every approval is refused |
| Spenders, payments | How many spenders were ever granted, and how many payments were filed |
| Paid count, paid total | Payments that moved money, and how much, in base units |

## The vault

The vault is the associated token account of (test USDC mint, team address). Its authority is the team's program address, so no wallet can sign for it. Money leaves the vault only through the program, in three places:

* `pay`, when a payment is inside the spender's policy
* `approve`, when the owner approves a Pending payment
* `withdraw`, when the owner moves money to an account they name

Anyone can top the vault up, because it is a plain SPL token account.

## What only the owner can do

* Add a spender, change its policy or services, pause or resume it, revoke it
* Approve or decline a Pending payment
* Pause or resume the whole team (**Stop everything** under **Settings**)
* Withdraw from the vault

Each of these is checked by the program's account constraints, not by the app.

## Money is integers

Amounts are kept in token base units end to end. Test USDC has 6 decimals, so 1 USDC is `1000000`. The app formats them only for display, and a balance it cannot read is shown as unknown, never as zero.
