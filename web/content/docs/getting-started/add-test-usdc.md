---
description: Fund your team's vault with test USDC from the devnet faucet.
---

# Add test USDC

Rein runs on devnet with a test USDC mint that Rein controls, so the demo can top itself up. It is not Circle's USDC and it is not real money.

## From the faucet

1. Open your team and go to **Money**.
2. Under **Add test USDC**, enter an amount. The faucet gives at most 100 USDC at a time.
3. Confirm. The faucet mints the amount straight into your team's vault.

The faucet is rate-limited: a few requests per visitor every ten minutes. If the faucet does not answer, Rein says so and asks you to check the balance before trying again, so nobody tops up twice by accident.

## From anywhere else

The vault is a plain SPL token account, the associated token account of the test mint and the team's address. Any wallet or program holding the test token can send to it. The vault address is shown under **Money**.

{% hint style="danger" %}
Send only Rein's test USDC mint (`Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14`) on devnet. Any other token sent to the vault cannot be spent by Rein.
{% endhint %}

## Taking money out

Only the owner can withdraw. **Withdraw** under **Money** moves an amount from the vault to an account the owner names.
