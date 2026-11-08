---
description: The words Rein uses, in one place.
---

# Glossary

| Term | Meaning |
|---|---|
| Team | An account the program owns, at `["team", owner]`. Holds the vault and the running totals |
| Owner | The wallet that created the team. The only one that can change spenders, approve, decline, pause or withdraw |
| Vault | The team's token account for test USDC. Its authority is the team's program address, so only the program moves money out |
| Spender | A person or an AI agent on a team, at `["spender", team, authority]` |
| Authority | The key that signs a spender's payments: a person's wallet, or an agent's keypair |
| Policy | A spender's limits: allowance, period, cap per payment, payments per period, expiry |
| Allowance | The most a spender may pay in one period |
| Cap | The most one payment may be |
| Period | How long an allowance lasts. Periods roll on schedule from the grant |
| Stop | A condition that refuses a payment outright and that no approval overrides: paused team, paused or revoked spender, expired policy, suspended service |
| Generation | A counter that goes up each time a revoked spender is granted again. A payment filed under an old generation cannot be approved |
| Service | A registry entry at `["service", id]` with a payee and a list price |
| Registry | The set of service accounts, managed by the config's admin |
| Payee | The token account a service is paid into. Only the registry sets it |
| Intent | A string of 1 to 32 characters that names one payment. The payment record's address is derived from (spender, intent), so it is used once |
| Pending | A payment over a limit, waiting for the owner. No money has moved |
| Paid | Settled when filed, inside the policy |
| Settled | Approved by the owner and paid |
| Declined, Cancelled | Closed by the owner, or by the filer, with no money moved |
| Refused | Approved, but a stop applied by then. Final |
| Sponsor | The server key that pays fees and rent so nobody needs SOL |
| Base units | Integer token amounts. Test USDC has 6 decimals: 1 USDC is 1,000,000 base units |
| Devnet | Solana's public test network. Nothing on it is real money |
