---
description: Pay a registered service by name. The program decides whether it settles or waits.
---

# Make a payment

## You name a service, never an address

`pay` takes a service id from the on-chain registry, an amount and a memo. It does not take a destination address. The payee is whatever token account the registry names for that service, and the program refuses any other. See [The service registry](../how-it-works/the-service-registry.md).

## From the app

1. Open your team and go to **Pay**. You need to be a spender on the team.
2. Choose a **Service**. The list comes from the on-chain registry.
3. Enter the **Amount (USDC)** and a memo of up to 64 bytes.
4. Confirm. Rein shows **Your policy** beside the form, so you can see before sending whether it will settle or be filed.

## What happens

| Result | When | Money |
|---|---|---|
| Paid | Inside every limit of the policy | Moves from the vault to the service's payee in the same transaction |
| Pending | Over one or more limits | Does not move. The owner decides |
| Refused | A stop applies: team paused, spender paused or revoked, policy expired, service suspended | Does not move. The transaction fails |

## One intent, one payment

Every payment carries an *intent*, a string of 1 to 32 letters, digits, `-` and `_`. The payment record's address is derived from (spender, intent), so a second payment with the same intent cannot be created. If an agent or the app retries after a timeout, the retry cannot pay twice.

If the app cannot tell whether a payment landed, it shows it as pending and tells you to check before trying again. It never shows an unknown result as failed.

## Who pays the fee

The sponsor. It pays the transaction fee and the rent of the payment record, about 0.003 SOL each. The spender needs no SOL. See [The sponsor](../how-it-works/the-sponsor.md).
