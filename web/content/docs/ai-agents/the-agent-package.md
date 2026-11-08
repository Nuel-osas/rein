---
description: The agent/ workspace package, its Groq model, and how to run it against a team.
---

# The agent package

The agent lives in the repository's `agent/` folder, a workspace package named `@rein/agent`. The web app uses the same package to run the demo agent, so the browser demo and the command line are the same code.

## How it works

1. It sends the task to a model on Groq, `openai/gpt-oss-120b` by default, with a system prompt that explains the policy and the three tools.
2. The model calls `list_services`, `check_budget` and `pay`. Each call is carried out against the chain, and the result goes back to the model.
3. Each `pay` builds the program's `pay` instruction with a fresh intent, has the agent's key sign it, and has the sponsor's key sign as fee payer.
4. It stops when the model gives a final answer, or after 12 model turns.

Amounts are parsed into base units as integers (at most 6 decimals) and never pass through a floating-point number. A result the agent cannot confirm is reported as unconfirmed, with its signature, and not retried.

## Run it

```bash
pnpm install
export GROQ_API_KEY=...            # your Groq key
export REIN_RPC_URL=https://api.devnet.solana.com
export REIN_TEAM=<your team address>
export REIN_AGENT_SECRET='[...]'   # the agent's key, as a JSON byte array
export REIN_SPONSOR_SECRET='[...]' # a key with devnet SOL, to pay fees
pnpm --filter @rein/agent agent research
```

Instead of a scenario name you can pass a task in plain words: `pnpm --filter @rein/agent agent "find three sources on validator client diversity"`.

| Variable | Required | What it is |
|---|---|---|
| `GROQ_API_KEY` | Yes | Your Groq API key |
| `REIN_RPC_URL` | Yes | The cluster's RPC URL |
| `REIN_TEAM` | Yes | The team the agent is a spender on |
| `REIN_AGENT_SECRET` | No | The agent's key. Without it, `~/.config/rein/demo-agent.json` |
| `REIN_SPONSOR_SECRET` | No | The fee payer's key. Without it, `~/.config/rein/sponsor.json` |
| `REIN_AGENT_MODEL` | No | Another Groq model id |
| `REIN_PROGRAM_ID` | No | Another deployment of the program |

## Scenarios

| Name | What it should show |
|---|---|
| `research` | Buys two or three cheap services, each inside the policy, and they settle at once |
| `overspend` | Tries a service priced above its cap. The payment is filed as Pending and the owner must approve it |
| `injection` | Does the real task and refuses the injected transfer, because it cannot name an address. An unregistered service id is refused on chain with a failed transaction |

## Tests

```bash
pnpm --filter @rein/agent test
```

The package's tests cover amounts, budgets, intents, payment building, reasons and error decoding.
