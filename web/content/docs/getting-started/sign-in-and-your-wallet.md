---
description: Google sign-in, the Solana wallet Rein creates for you, and why you never need SOL.
---

# Sign in and your wallet

## Sign in with Google

Rein has one way in: **Continue with Google**. Sign-in is provided by Privy, which also creates an embedded Solana wallet for every user the first time they sign in. There is no seed phrase and no browser extension.

Once you are signed in, Rein looks up the team your wallet owns. If it finds one, it opens it. If not, it opens **Create your team**. If the chain cannot be read at that moment, Rein says so and offers your team list instead of guessing that you have no team.

## Your wallet

Your wallet is a normal Solana address. It signs everything you do in Rein: creating a team, adding a spender, approving a payment. Your team's vault is not your wallet. It is a token account owned by the team's own program address, and only the program can move money out of it. See [Teams and the vault](../using-rein/teams-and-the-vault.md).

## You never need SOL

Every action goes through Rein's sponsor at `/api/sponsor`. Your wallet signs its part, the sponsor checks the transaction, adds its signature as the fee payer and sends it. The sponsor also pays the rent of the accounts a payment creates. See [The sponsor](../how-it-works/the-sponsor.md).

{% hint style="info" %}
Everything here is Solana devnet and test USDC. Your wallet holds no real money, and Rein never asks you to fund it.
{% endhint %}
