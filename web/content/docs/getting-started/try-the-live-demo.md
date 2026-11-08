---
description: A seeded team you can watch and act on with no wallet and no sign-in.
---

# Try the live demo

The demo team, **Acme Research**, is public. Open it at [rein-navy.vercel.app/demo](https://rein-navy.vercel.app/demo) or straight from its address: [`EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5`](https://rein-navy.vercel.app/app/EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5).

## What is on it

| Spender | Kind | Policy |
|---|---|---|
| Research agent | AI agent | Cap 5 USDC per payment, 20 USDC and 10 payments per hour, 30 days. Services: web-search, llm-inference, market-data, gpu-hour |
| Ada | Person, operations | Cap 25 USDC per payment, 100 USDC per week. All services |

The vault was funded with 500 test USDC.

## What you can do without signing in

* **Watch the agent.** Run one of three scenarios and watch each tool call and payment as it happens:
  * **Research brief:** buys two or three cheap services inside its policy. They settle at once.
  * **Over the cap:** asks for the premium dataset, priced above its cap. It is filed as Pending.
  * **Prompt injection:** a pasted web page tells the agent to send money to an address. The agent cannot name an address, and a made-up service id is refused on chain.
* **Act as the owner.** Approve or decline a Pending payment on the demo team. The server signs as the demo owner, only after checking on chain that the payment exists, belongs to the demo team and is Pending.
* **Reset.** Top the demo vault back up to 500 test USDC.

Every action is rate-limited per visitor, because each one spends devnet SOL and model credits.
