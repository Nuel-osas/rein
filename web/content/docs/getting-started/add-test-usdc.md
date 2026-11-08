---
description: Fund your team's vault with test USDC.
---

# Add test USDC

Rein runs on devnet with a test USDC mint that Rein controls, so the demo can top itself up. It is not Circle's USDC and it is not real money.

## From the claim card

1. Open your team's **Home**.
2. On the claim card, press **Claim your $0.30 of AI compute**. Once per Google account, the team's owner gets 0.30 test USDC from Rein's claim pool, straight into the team's vault.

The server refuses a second claim from the same account. If it does not answer, Rein says so and asks you to check the balance before trying again, so nobody claims twice by accident.

## From anywhere else

The vault is a plain SPL token account, the associated token account of the test mint and the team's address. Any wallet or program holding the test token can send to it. The vault address is linked from **Home**, next to the vault balance.

{% hint style="danger" %}
Send only Rein's test USDC mint (`Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14`) on devnet. Any other token sent to the vault cannot be spent by Rein.
{% endhint %}

## Taking money out

Only the owner can withdraw. **Withdraw** under **Settings** moves an amount from the vault to an account the owner names.
