---
description: The fee payer behind /api/sponsor, and the checks it runs before it signs anything.
---

# The sponsor

Nobody using Rein needs SOL. A sponsor key on the server pays every transaction fee and the rent of the accounts a payment creates. On devnet the sponsor is [`hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF`](https://explorer.solana.com/address/hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF?cluster=devnet).

## How a sponsored action works

1. The app builds the transaction with the sponsor as fee payer.
2. Your wallet signs its part.
3. The app posts the transaction to `/api/sponsor`.
4. The sponsor checks it, adds its signature as fee payer, and sends it.

The sponsor's signature makes it the fee payer. It does not make it an authority: money in a vault still moves only under the program's rules, signed by the spender or the owner.

## What the sponsor checks

It refuses the request unless every one of these holds:

* **Only Rein.** Every instruction is one of Rein's user instructions: `pay`, `approve`, `decline`, `cancel`, `create_team`, `add_spender`, `set_policy`, `set_services`, `set_spender_status`, `revoke`, `set_paused`, `withdraw`. There must be at least one.
* **Nothing else but fee settings.** Compute-budget instructions are allowed, with a capped unit limit (400,000) and a capped price. Any other program is refused.
* **One token account, your own.** For a withdraw, it will also create the signer's own token account for the registry's test USDC, once, and nothing else.
* **The sponsor only where it belongs.** Its key may appear only as the fee payer, as the `payer` of `pay`, `create_team` or `add_spender` (which pay rent), and as the payer of that one token account. Anywhere else, the request is refused.
* **Small and complete.** At most 6 instructions, a body under 4 KB, and every required signature present and valid.

## Limits per user

* A request with a valid sign-in session is limited per signed-in user: 30 a minute.
* A request with no session is limited per IP address: 20 a minute.
* A request with a session that fails verification is refused, and asked to sign in again.

The limits are kept in memory on each server instance, so they stop one visitor hammering the route; they are not a global quota. See [Still open](../security/still-open.md).

## When the result is unknown

If the sponsor sends a transaction and cannot confirm it, it reports the signature as pending, not failed. The app tells you to check before trying again, so nobody pays twice.
