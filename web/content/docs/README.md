---
description: Spending rules for teams and their AI agents, enforced by a Solana program.
---

# Welcome to Rein

Rein is a team vault on Solana. The team keeps test USDC in one vault, and every spender on it, a person or an AI agent, pays under its own policy: an allowance for each period, a cap on each payment, a number of payments, an expiry date and a list of the services it may pay. The Rein program checks every payment against that policy when it is sent.

> The agent proposes a payment. Only the program authorizes it.

Over a limit, a payment does not fail. The program files it as Pending, with every reason it went over, and no money moves until the team's owner decides. One tap on **Approve** and it settles in the same transaction.

## Who it is for

Small teams whose people and AI agents buy inference, data and API credits. You fund one vault, give each spender a budget, and decide anything outside those budgets yourself.

## Live on Solana devnet

| App | Network | Money |
|---|---|---|
| [rein-navy.vercel.app](https://rein-navy.vercel.app) | Solana devnet | Test USDC from a mint Rein controls. Not real money |

{% hint style="warning" %}
Rein runs on devnet only, with test USDC. Nothing in it is real money, and the program has not been independently audited. See [Still open](security/still-open.md).
{% endhint %}

## What you can do

* **Sign in with Google.** You get a Solana wallet with no seed phrase, and a sponsor pays every network fee, so you never hold SOL. [Sign in and your wallet](getting-started/sign-in-and-your-wallet.md).
* **Create a team.** Your wallet owns it, and its vault is a token account owned by the team's address. [Create a team](getting-started/create-a-team.md).
* **Add test USDC.** Up to 100 at a time from the devnet faucet. [Add test USDC](getting-started/add-test-usdc.md).
* **Give every spender a policy.** People and agents alike. The program enforces it on every payment. [Spenders and policies](using-rein/spenders-and-policies.md).
* **Pay a registered service.** You name a service, never an address. [Make a payment](using-rein/make-a-payment.md).
* **Approve what goes over.** Over a limit, the payment waits for you. [Approvals](using-rein/approvals.md).
* **Run an AI agent.** It has its own keypair, holds no money and no SOL, and has three tools, none of which takes an address. [Agents overview](ai-agents/overview.md).

## Where to start

* New here: [Quickstart](getting-started/quickstart.md).
* Want to see it without signing in: [Try the live demo](getting-started/try-the-live-demo.md).
* Want to know how it is built: [The program](how-it-works/the-program.md).
* Want to check the claims yourself: [Evidence](resources/evidence.md) and [Devnet addresses](reference/devnet-addresses.md).
* Want to know what can go wrong: [Security model](security/security-model.md) and [Still open](security/still-open.md).
