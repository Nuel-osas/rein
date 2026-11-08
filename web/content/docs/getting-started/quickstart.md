---
description: From sign-in to a first payment on Solana devnet, with test USDC.
---

# Quickstart

This guide takes you from nothing to a first payment on [rein-navy.vercel.app](https://rein-navy.vercel.app). Everything runs on Solana devnet with test USDC, so nothing you do here costs real money. To look around first without signing in, open the [live demo](try-the-live-demo.md).

{% stepper %}
{% step %}
### Sign in

Open the app and press **Continue with Google**. Rein creates a Solana wallet for you the first time you sign in. There is no seed phrase to write down and nothing to install, and you never need SOL: a sponsor pays every network fee.

More: [Sign in and your wallet](sign-in-and-your-wallet.md).
{% endstep %}

{% step %}
### Create your team

If your wallet does not own a team yet, Rein takes you to **Create your team**. Give it a name of up to 32 characters. One transaction creates the team account and its vault, and your wallet becomes the owner.

More: [Create a team](create-a-team.md).
{% endstep %}

{% step %}
### Add test USDC

Open **Money**. Under **Add test USDC**, enter an amount up to 100 and confirm. The devnet faucet mints test USDC straight into your team's vault.

More: [Add test USDC](add-test-usdc.md).
{% endstep %}

{% step %}
### Add a spender

Open **Spenders** or **Agents** and add one. A person is added by their Solana wallet address. For an agent, Rein can generate a keypair for you and shows its key once. Set the allowance, the period, the cap per payment, the number of payments, the expiry and the services it may pay.

More: [Spenders and policies](../using-rein/spenders-and-policies.md).
{% endstep %}

{% step %}
### Pay, or approve

A spender pays a registered service from **Pay**, or an agent pays through its `pay` tool. Inside the policy it settles at once. Over a limit it is filed as Pending and appears under **Approvals**, where you approve or decline it.

More: [Make a payment](../using-rein/make-a-payment.md) and [Approvals](../using-rein/approvals.md).
{% endstep %}
{% endstepper %}
