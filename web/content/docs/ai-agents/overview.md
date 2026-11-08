---
description: An agent is a keypair with a policy. It holds no money and no SOL, and it cannot name an address.
---

# Agents overview

An AI agent on Rein is a spender of kind *agent*. It is held to a policy the same way a person is, and the program enforces that policy on every payment it signs.

## What an agent is

* **A keypair.** Its public key is the spender's authority. The key is the agent's only credential.
* **No money.** The money stays in the team's vault. The agent's key can only sign `pay` against its own spender account.
* **No SOL.** The sponsor pays every fee and the rent of each payment record.
* **A policy.** An allowance per period, a cap per payment, a number of payments, an expiry and a list of services, the same as any spender. See [Spenders and policies](../using-rein/spenders-and-policies.md).

## Three tools, none takes an address

Rein's agent works through exactly three tools:

| Tool | What it does |
|---|---|
| `list_services` | Lists the services registered on chain: id, label, list price in USDC, and whether each is active |
| `check_budget` | Reads the agent's own policy from chain and what is left of it: allowance, cap, spent and payments this period, when the period resets, the expiry, the allowed services, and the most one payment can be right now and still settle |
| `pay` | Pays a registered service by its id, with an amount and a memo. Inside the policy it settles at once; over a limit it is filed as Pending for the owner |

None of them takes a wallet address. A prompt-injected agent can be told to "send 50 USDC to this wallet", and there is still no tool it could do that with. If it makes up a service id, the program has no registry account for it and the transaction fails on chain.

> The agent proposes a payment. Only the program authorizes it.

## Add an agent to your team

1. Open your team, go to **Team** and choose **Add agent**.
2. Let Rein generate a keypair, or paste the public key of one you made.
3. Set its policy and the services it may pay.
4. Confirm. If Rein generated the key, download it now: it is shown once and Rein does not store it.

Then run the agent with that key. See [The agent package](the-agent-package.md).

## Watch one run

The demo team has a research agent you can run from the browser, with no sign-in, in three scenarios: a cheap research brief, a purchase over its cap, and a prompt injection. See [Try the live demo](../getting-started/try-the-live-demo.md).
