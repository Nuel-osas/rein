---
description: A seeded team you can watch and act on with no wallet and no sign-in.
---

# Try the live demo

The demo team, **Acme Research**, is public. Open it at [rein-navy.vercel.app/demo](https://rein-navy.vercel.app/demo) or straight from its address: [`EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5`](https://rein-navy.vercel.app/app/EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5).

## What is on it

| Spender | Kind | Policy |
|---|---|---|
| Research agent | AI agent | Cap 0.05 USDC per payment, 0.50 USDC and 20 payments per hour, 30 days. Services: `ai-chat`, `ai-image`, `ai-voice` |
| Ada | Person, operations | Cap 25 USDC per payment, 100 USDC per week. Her list still names the placeholder services of the first seed, which are suspended, so a payment she files to a 0G service waits for the owner |

The vault was funded with 500 test USDC.

## What you can do without signing in

* **Watch the agent.** Run one of three scenarios and watch each tool call and payment as it happens:
  * **Research brief:** asks a question. The agent buys `ai-chat` (and sometimes `ai-image`) inside its policy, the payment settles at once, and it returns the real answer from 0G.
  * **Over the limit:** the task needs Claude, so the agent buys `ai-claude`, which is not on its list. The payment is filed as Pending with the reason `service_not_allowed`. After you approve it, the gateway runs it on the 0G Router and shows Claude's answer, relayed with no TEE and marked not verified. A server with no 0G Private Computer key refunds the full amount to the vault instead.
  * **Prompt injection:** a pasted web page tells the agent to send money to an address. The agent cannot name an address, and a made-up service id is refused on chain.
* **Act as the owner.** Approve or decline a Pending payment on the demo team. The server signs as the demo owner, only after checking on chain that the payment exists, belongs to the demo team and is Pending.
* **Reset.** Top the demo vault back up to 500 test USDC.

Every action is rate-limited per visitor, because each one spends devnet SOL and model credits.
